/**
 * Native probe for the two redirect-time primitives .NET runs before
 * CreateProcess: an inheritable anonymous pipe (CreatePipe with a null security
 * descriptor, so the restricted token's default DACL applies) and the
 * non-inheritable copy of the parent read end
 * (DuplicateHandle(GetCurrentProcess(), read, GetCurrentProcess(), parent, 0,
 * FALSE, DUPLICATE_SAME_ACCESS)).
 *
 * It runs inside the confined child the runner spawns, reports every native
 * return code and GetLastError, and closes every handle it created on both the
 * success and the failure path. Koffi's module path is argv[2] because the
 * confined child does not resolve the repository's node_modules by itself.
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const koffi = require(process.argv[2])

const kernel32 = koffi.load('kernel32.dll')
const PVOID = koffi.pointer('void')
const PPVOID = koffi.pointer(PVOID)
const PUINT32 = koffi.pointer('uint32')
const SECURITY_ATTRIBUTES = koffi.struct('DSH_SECURITY_ATTRIBUTES', {
  nLength: 'uint32',
  lpSecurityDescriptor: PVOID,
  bInheritHandle: 'int',
})

const bind = (name, result, args) => kernel32.func('__stdcall', name, result, args)
const getLastError = bind('GetLastError', 'uint32', [])
const createPipe = bind('CreatePipe', 'int', [PPVOID, PPVOID, koffi.pointer(SECURITY_ATTRIBUTES), 'uint32'])
const duplicateHandle = bind('DuplicateHandle', 'int', [PVOID, PVOID, PVOID, PPVOID, 'uint32', 'int', 'uint32'])
const closeHandle = bind('CloseHandle', 'int', [PVOID])
const getHandleInformation = bind('GetHandleInformation', 'int', [PVOID, PUINT32])
const getCurrentProcess = bind('GetCurrentProcess', PVOID, [])
const readFile = bind('ReadFile', 'int', [PVOID, PVOID, 'uint32', PUINT32, PVOID])
const writeFile = bind('WriteFile', 'int', [PVOID, PVOID, 'uint32', PUINT32, PVOID])

const HANDLE_FLAG_INHERIT = 1
const DUPLICATE_SAME_ACCESS = 0x00000002
const ERROR_INVALID_HANDLE = 6
const ERROR_BROKEN_PIPE = 109
const PAYLOAD = Buffer.from('dsh-native-redirect-probe\n')
// Manual fail-path injection: DSH_WINDOWS_ACL_PROBE_INJECT=duplicate makes the
// DuplicateHandle call receive a handle the process does not own, and =close
// performs one real CloseHandle of an unowned handle after the round-trip. Both
// produce genuine native errors, so the cleanup and reporting paths run against
// a real failure instead of a synthetic one.
const INJECT = process.env.DSH_WINDOWS_ACL_PROBE_INJECT ?? ''
const UNOWNED_HANDLE = 0xdeadn

const report = {
  createPipe: null,
  duplicate: null,
  inheritable: {},
  write: null,
  read: null,
  eof: null,
  closes: [],
  closedObservations: {},
  leakedHandles: [],
  injected: null,
  failure: null,
}

/** Handles still owned by this probe, closed in reverse creation order. */
const owned = []

/**
 * Read one handle's inheritance flag.
 * @param handle - native handle to inspect.
 * @returns the HANDLE_FLAGS value, or null when the query failed.
 */
function inheritFlag(handle) {
  const flagsSlot = koffi.alloc('uint32', 1)
  try {
    const ok = getHandleInformation(handle, flagsSlot)
    if (ok === 0) return { ok: 0, error: getLastError(), inherit: null }
    return { ok: 1, error: 0, inherit: (koffi.decode(flagsSlot, 'uint32') & HANDLE_FLAG_INHERIT) === HANDLE_FLAG_INHERIT ? 1 : 0 }
  } finally {
    koffi.free(flagsSlot)
  }
}

/**
 * Close one owned handle and record the native result.
 *
 * A handle leaves the owned list only after CloseHandle succeeded; a failed
 * close stays tracked so the final report names it instead of hiding it.
 * @param handle - native handle to close.
 */
function release(handle) {
  const index = owned.indexOf(handle)
  if (index < 0) return
  const code = closeHandle(handle)
  report.closes.push({ handle: String(handle), code, error: code === 0 ? getLastError() : 0 })
  if (code !== 1) return
  owned.splice(index, 1)
  // Observation only: a handle this probe closed must be rejected as invalid.
  // It says nothing about handles the process never owned.
  const flagsSlot = koffi.alloc('uint32', 1)
  try {
    report.closedObservations[String(handle)] = { ok: getHandleInformation(handle, flagsSlot), error: getLastError() }
  } finally {
    koffi.free(flagsSlot)
  }
}

/** Close every handle this probe still owns, in reverse creation order. */
function releaseAll() {
  for (const handle of [...owned].reverse()) release(handle)
  report.leakedHandles = owned.map(handle => String(handle))
}

/**
 * Record the first unexpected native result and stop the probe body.
 * @param where - the primitive whose contract failed.
 * @param code - 0 on failure, 1 on success.
 */
function requireSuccess(where, code) {
  if (code !== 0) return
  throw Object.assign(new Error(`${where} failed with Win32 ${getLastError()}`), { native: true })
}

/**
 * Run the two primitives and the pipe round-trip.
 * @returns true when every step met its contract.
 */
function probe() {
  const attributes = koffi.alloc(SECURITY_ATTRIBUTES, 1)
  const readSlot = koffi.alloc(PVOID, 1)
  const writeSlot = koffi.alloc(PVOID, 1)
  const parentSlot = koffi.alloc(PVOID, 1)
  const countSlot = koffi.alloc('uint32', 1)
  try {
    // The .NET shape: a null security descriptor and bInheritHandle = TRUE.
    koffi.encode(attributes, SECURITY_ATTRIBUTES, {
      nLength: SECURITY_ATTRIBUTES.size,
      lpSecurityDescriptor: null,
      bInheritHandle: 1,
    })
    const pipeCode = createPipe(readSlot, writeSlot, attributes, 0)
    const pipeError = pipeCode === 1 ? 0 : getLastError()
    report.createPipe = { code: pipeCode, error: pipeError }
    requireSuccess('CreatePipe', pipeCode)
    const readEnd = koffi.decode(readSlot, PVOID)
    const writeEnd = koffi.decode(writeSlot, PVOID)
    owned.push(readEnd, writeEnd)
    report.inheritable.created = { read: inheritFlag(readEnd), write: inheritFlag(writeEnd) }

    // The .NET parent copy: same access, current process on both sides, not inherited.
    const duplicateSource = INJECT === 'duplicate' ? UNOWNED_HANDLE : readEnd
    const duplicateCode = duplicateHandle(
      getCurrentProcess(), duplicateSource, getCurrentProcess(), parentSlot, 0, 0, DUPLICATE_SAME_ACCESS,
    )
    const duplicateError = duplicateCode === 1 ? 0 : getLastError()
    report.duplicate = { code: duplicateCode, error: duplicateError }
    requireSuccess('DuplicateHandle', duplicateCode)
    const parentEnd = koffi.decode(parentSlot, PVOID)
    owned.push(parentEnd)
    report.inheritable.parentCopy = inheritFlag(parentEnd)

    const written = writeFile(writeEnd, PAYLOAD, PAYLOAD.length, countSlot, null)
    const writtenError = written === 1 ? 0 : getLastError()
    report.write = { code: written, error: writtenError, bytes: written === 1 ? koffi.decode(countSlot, 'uint32') : 0 }
    requireSuccess('WriteFile', written)
    // Close the only writer so the parent read end reaches EOF.
    release(writeEnd)

    const chunk = Buffer.alloc(PAYLOAD.length)
    const readCode = readFile(parentEnd, chunk, chunk.length, countSlot, null)
    const readError = readCode === 1 ? 0 : getLastError()
    const readBytes = readCode === 1 ? koffi.decode(countSlot, 'uint32') : 0
    report.read = {
      code: readCode,
      error: readError,
      bytes: readBytes,
      matches: readCode === 1 && chunk.subarray(0, readBytes).equals(PAYLOAD),
    }
    requireSuccess('ReadFile', readCode)

    const eofChunk = Buffer.alloc(1)
    const eofCode = readFile(parentEnd, eofChunk, eofChunk.length, countSlot, null)
    report.eof = { code: eofCode, error: eofCode === 1 ? 0 : getLastError() }
    if (INJECT === 'close') {
      const injectedCode = closeHandle(UNOWNED_HANDLE)
      report.injected = { close: { code: injectedCode, error: getLastError(), succeeds: false } }
    }
    return true
  } catch (error) {
    report.failure = { message: error instanceof Error ? error.message : String(error), native: error.native === true }
    return false
  } finally {
    releaseAll()
    koffi.free(attributes)
    koffi.free(readSlot)
    koffi.free(writeSlot)
    koffi.free(parentSlot)
    koffi.free(countSlot)
  }
}

const completed = probe()
const failures = []
if (!completed) {
  // A native primitive or the pipe round-trip failed: keep the failure and the
  // native error code in the report and never exit successfully.
  failures.push(report.failure === null ? 'the native probe did not complete' : `native failure: ${report.failure.message}`)
}
if (completed) {
  if (report.inheritable.created.read.inherit !== 1) failures.push('created read end is not inheritable')
  if (report.inheritable.created.write.inherit !== 1) failures.push('created write end is not inheritable')
  if (report.inheritable.parentCopy.inherit !== 0) failures.push('parent copy is inheritable')
  if (report.read.matches !== true) failures.push('pipe round-trip bytes differ')
  if (report.eof.code !== 0 || report.eof.error !== ERROR_BROKEN_PIPE) failures.push('pipe EOF was not reported')
  if (report.injected !== null) failures.push('an injected native failure was reported, not tolerated')
}
if (report.closes.length === 0) failures.push('no created handle was closed')
for (const entry of report.closes) {
  if (entry.code !== 1) failures.push(`CloseHandle ${entry.handle} failed with Win32 ${entry.error}`)
}
if (report.leakedHandles.length > 0) failures.push(`handles left open: ${report.leakedHandles.join(', ')}`)
for (const [handle, entry] of Object.entries(report.closedObservations)) {
  if (entry.ok !== 0 || entry.error !== ERROR_INVALID_HANDLE) {
    failures.push(`closed handle ${handle} is still visible to GetHandleInformation`)
  }
}
report.ok = completed && failures.length === 0
report.failures = failures
process.stdout.write(`${JSON.stringify(report)}\n`)
process.exitCode = report.ok ? 0 : 1
