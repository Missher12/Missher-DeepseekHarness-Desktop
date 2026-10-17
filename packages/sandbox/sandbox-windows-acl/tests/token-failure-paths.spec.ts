/**
 * Restricted-token failure-path tests with minimal stub binding tables: every
 * checked Win32 call in the token
 * pipeline — open, logon-SID scan, well-known SID creation, default-DACL
 * merge, restricted-token creation — has a failing counterpart, and each
 * failure closes or frees what it created before throwing. Pure stubs — no
 * real Win32 calls, so these run on every platform; the real-FFI round-trip
 * lives in acl.spec.ts (win32 only).
 */

import { Win32Error } from '@deepseek-ai/dsh-win32-process'
import { describe, expect, it, vi } from 'vitest'
import koffi from 'koffi'

import { allocBytes, isNullPtr } from '../src/ffi.ts'
import type { NativePtr, Win32Bindings } from '../src/ffi.ts'
import {
  createRestrictedToken, findLogonSid, findUserSid, makeWellKnownSid, openCurrentProcessToken,
  restrictTokenIntegrity, setTokenDefaultDaclGrant,
} from '../src/token.ts'
import * as abi from '../src/win32-abi.ts'

const PVOID = koffi.pointer('void')

/** Stub binding table: only the members a test drives, so the rest are never called. */
function stubBindings(overrides: Partial<Win32Bindings>): Win32Bindings {
  return overrides as Win32Bindings
}

describe('openCurrentProcessToken failure paths', () => {
  it('reports when OpenProcess yields no handle', () => {
    const api = {
      openProcess: vi.fn(() => 0n),
      getLastError: vi.fn(() => 5),
      formatMessageW: vi.fn(() => 0),
    } as unknown as Win32Bindings
    let caught: unknown
    try {
      openCurrentProcessToken(api)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('OpenProcess')
  })

  it('closes the process handle and reports when OpenProcessToken fails', () => {
    const closeHandle = vi.fn(() => 1)
    const api = {
      openProcess: vi.fn(() => 7n),
      openProcessToken: vi.fn(() => 0),
      closeHandle,
      getLastError: vi.fn(() => 5),
      formatMessageW: vi.fn(() => 0),
    } as unknown as Win32Bindings
    let caught: unknown
    try {
      openCurrentProcessToken(api)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('OpenProcessToken')
    expect(closeHandle).toHaveBeenCalledWith(7n)
  })

  it('reports a failed CloseHandle of the process handle', () => {
    const api = {
      openProcess: vi.fn(() => 7n),
      openProcessToken: vi.fn((_process: unknown, _access: unknown, slot: NativePtr) => {
        koffi.encode(slot, PVOID, 9n)
        return 1
      }),
      closeHandle: vi.fn(() => 0),
      getLastError: vi.fn(() => 5),
      formatMessageW: vi.fn(() => 0),
    } as unknown as Win32Bindings
    let caught: unknown
    try {
      openCurrentProcessToken(api)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('CloseHandle')
  })

  it('rejects a NULL token handle after a successful OpenProcessToken', () => {
    const api = {
      openProcess: vi.fn(() => 7n),
      openProcessToken: vi.fn(() => 1), // succeeds without writing the out slot
      closeHandle: vi.fn(() => 1),
      getLastError: vi.fn(() => 5),
      formatMessageW: vi.fn(() => 0),
    } as unknown as Win32Bindings
    let caught: unknown
    try {
      openCurrentProcessToken(api)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('OpenProcessToken')
  })
})

/**
 * The stub the logon-SID scan needs: the size probe writes `needed`, the
 * second call fills a TOKEN_GROUPS buffer (GroupCount@0, SID pointer@8,
 * attributes@16) with the state's one group. The CopySid mock comes back
 * beside the table for the one test that asserts on its arguments.
 */
function logonApi(state: {
  needed: number
  groupCount: number
  sidPtr: bigint
  logon: boolean
  secondOk?: boolean
  sidLength?: number
  copyOk?: boolean
}): { api: Win32Bindings; copySid: ReturnType<typeof vi.fn> } {
  const copySid = vi.fn(() => (state.copyOk === false ? 0 : 1))
  const api = {
    getTokenInformation: vi.fn((_token: unknown, cls: number, info: Buffer | null, _length: number, needed: NativePtr) => {
      if (cls !== abi.TokenGroups) throw new Error(`unexpected token information class ${cls}`)
      if (info === null) {
        koffi.encode(needed, 'uint32', state.needed)
        return 0 // the size probe is expected to "fail"
      }
      if (state.secondOk === false) return 0
      info.writeUInt32LE(state.groupCount, 0)
      if (state.groupCount > 0) {
        info.writeBigUInt64LE(state.sidPtr, abi.TOKEN_GROUPS_OFFSET)
        info.writeUInt32LE(state.logon ? abi.SE_GROUP_LOGON_ID : 0, abi.TOKEN_GROUPS_OFFSET + 8)
      }
      return 1
    }),
    getLengthSid: vi.fn(() => state.sidLength ?? 12),
    copySid,
    localAlloc: vi.fn(() => 500n),
    localFree: vi.fn(() => 0n),
    getLastError: vi.fn(() => 5),
    formatMessageW: vi.fn(() => 0),
  } as unknown as Win32Bindings
  return { api, copySid }
}

describe('findLogonSid failure paths', () => {
  const token = 9n as NativePtr

  it('reports a size probe that wrote nothing', () => {
    const { api } = logonApi({ needed: 0, groupCount: 0, sidPtr: 0n, logon: false })
    let caught: unknown
    try {
      findLogonSid(api, token)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('GetTokenInformation')
  })

  it('rejects an implausibly small TokenGroups size', () => {
    const { api } = logonApi({ needed: 4, groupCount: 0, sidPtr: 0n, logon: false })
    let caught: unknown
    try {
      findLogonSid(api, token)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('GetTokenInformation')
  })

  it('reports a failed TokenGroups read', () => {
    const { api } = logonApi({ needed: 24, groupCount: 1, sidPtr: 77n, logon: true, secondOk: false })
    let caught: unknown
    try {
      findLogonSid(api, token)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('GetTokenInformation')
  })

  it('skips a NULL group SID pointer and throws when no logon SID remains', () => {
    const { api } = logonApi({ needed: 24, groupCount: 1, sidPtr: 0n, logon: true })
    expect(() => findLogonSid(api, token)).toThrow(/no logon SID found/u)
  })

  it('skips a non-logon group and throws when no logon SID remains', () => {
    const { api } = logonApi({ needed: 24, groupCount: 1, sidPtr: 77n, logon: false })
    expect(() => findLogonSid(api, token)).toThrow(/no logon SID found/u)
  })

  it('reports a zero logon-SID length', () => {
    const { api } = logonApi({ needed: 24, groupCount: 1, sidPtr: 77n, logon: true, sidLength: 0 })
    let caught: unknown
    try {
      findLogonSid(api, token)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('GetLengthSid')
  })

  it('reports a failed CopySid of the logon SID', () => {
    const { api } = logonApi({ needed: 24, groupCount: 1, sidPtr: 77n, logon: true, copyOk: false })
    let caught: unknown
    try {
      findLogonSid(api, token)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('CopySid')
  })

  it('copies the logon SID and returns the new allocation', () => {
    const { api, copySid } = logonApi({ needed: 24, groupCount: 1, sidPtr: 77n, logon: true })
    const copy = findLogonSid(api, token)
    expect(isNullPtr(copy)).toBe(false)
    expect(copySid).toHaveBeenCalledWith(12, copy, 77n)
  })
})

describe('makeWellKnownSid failure paths', () => {
  it('reports when CreateWellKnownSid fails', () => {
    const api = {
      createWellKnownSid: vi.fn(() => 0),
      localAlloc: vi.fn(() => 500n),
      localFree: vi.fn(() => 0n),
      getLastError: vi.fn(() => 5),
      formatMessageW: vi.fn(() => 0),
    } as unknown as Win32Bindings
    let caught: unknown
    try {
      makeWellKnownSid(api, abi.WinWorldSid)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('CreateWellKnownSid')
  })

  it('reports when the created well-known SID is invalid', () => {
    const api = {
      createWellKnownSid: vi.fn(() => 1),
      isValidSid: vi.fn(() => 0),
      localAlloc: vi.fn(() => 500n),
      localFree: vi.fn(() => 0n),
      getLastError: vi.fn(() => 5),
      formatMessageW: vi.fn(() => 0),
    } as unknown as Win32Bindings
    let caught: unknown
    try {
      makeWellKnownSid(api, abi.WinWorldSid)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('IsValidSid')
  })
})

/**
 * The stub the TokenUser read needs: the size probe writes `needed`, the read
 * fills TOKEN_USER { SID_AND_ATTRIBUTES User; } with the state's SID pointer,
 * and LocalAlloc hands out a distinct buffer so the copy target is visible.
 */
function userApi(state: {
  needed?: number
  secondOk?: boolean
  sidPtr?: bigint
  sidLength?: number
  copyOk?: boolean
  lastError?: number
  cleanupChangesLastError?: boolean
}): {
  api: Win32Bindings
  copySid: ReturnType<typeof vi.fn>
  localFree: ReturnType<typeof vi.fn>
  localAlloc: ReturnType<typeof vi.fn>
} {
  let lastError = state.lastError ?? 5
  const copySid = vi.fn(() => (state.copyOk === false ? 0 : 1))
  const localFree = vi.fn((): NativePtr => {
    // A failing cleanup path changes GetLastError after the native failure.
    if (state.cleanupChangesLastError === true) lastError = 87
    return 0n as NativePtr
  })
  const localAlloc = vi.fn((): NativePtr => 500n as NativePtr)
  // Only the members this test drives; the shared helper supplies the type.
  const api = stubBindings({
    localAlloc,
    localFree,
    getTokenInformation: vi.fn((_token: unknown, cls: number, info: Buffer | null, _length: number, needed: NativePtr) => {
      if (cls !== abi.TokenUser) throw new Error(`unexpected token information class ${cls}`)
      if (info === null) {
        koffi.encode(needed, 'uint32', state.needed ?? abi.SID_AND_ATTRIBUTES_SIZE)
        return 0 // the size probe is expected to "fail"
      }
      if (state.secondOk === false) return 0
      info.writeBigUInt64LE(state.sidPtr ?? 79n, 0)
      info.writeUInt32LE(0, 8)
      return 1
    }),
    getLengthSid: vi.fn(() => state.sidLength ?? 12),
    copySid,
    getLastError: vi.fn(() => lastError),
    formatMessageW: vi.fn(() => 0),
  })
  return { api, copySid, localFree, localAlloc }
}

describe('findUserSid failure paths', () => {
  const token = 9n as NativePtr

  it('reports a size probe that wrote nothing', () => {
    const { api } = userApi({ needed: 0 })
    expect(() => findUserSid(api, token)).toThrow(Win32Error)
    let caught: unknown
    try {
      findUserSid(api, token)
    } catch (error) {
      caught = error
    }
    expect((caught as Win32Error).api).toBe('GetTokenInformation')
  })

  it('rejects a size too small for SID_AND_ATTRIBUTES', () => {
    const { api } = userApi({ needed: 8 })
    let caught: unknown
    try {
      findUserSid(api, token)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).message).toMatch(/implausible TokenUser size 8/u)
  })

  it('reports a failed TokenUser read', () => {
    const { api } = userApi({ secondOk: false })
    let caught: unknown
    try {
      findUserSid(api, token)
    } catch (error) {
      caught = error
    }
    expect((caught as Win32Error).api).toBe('GetTokenInformation')
  })

  it('rejects a NULL user SID pointer', () => {
    const { api } = userApi({ sidPtr: 0n })
    let caught: unknown
    try {
      findUserSid(api, token)
    } catch (error) {
      caught = error
    }
    expect((caught as Win32Error).api).toBe('GetTokenInformation')
  })

  it('reports a zero-length user SID', () => {
    const { api } = userApi({ sidLength: 0 })
    let caught: unknown
    try {
      findUserSid(api, token)
    } catch (error) {
      caught = error
    }
    expect((caught as Win32Error).api).toBe('GetLengthSid')
  })

  it('keeps the CopySid error code when the cleanup changes GetLastError, and frees the buffer', () => {
    const { api, localFree } = userApi({ copyOk: false, lastError: 1234, cleanupChangesLastError: true })
    let caught: unknown
    try {
      findUserSid(api, token)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('CopySid')
    // The cleanup ran (and changed the thread's last error) but the reported
    // code is still the CopySid failure.
    expect((caught as Win32Error).win32Code).toBe(1234)
    expect(localFree).toHaveBeenCalledWith(500n)
  })

  it('returns a LocalAlloc-owned copy on success', () => {
    const { api, copySid, localFree, localAlloc } = userApi({})
    expect(findUserSid(api, token)).toBe(500n)
    expect(copySid).toHaveBeenCalledWith(12, 500n, 79n)
    expect(localAlloc).toHaveBeenCalledWith(abi.LPTR, 12)
    // The caller owns the SID from here; the helper must not free it.
    expect(localFree).not.toHaveBeenCalled()
  })
})

/**
 * The stub the default-DACL merge needs: the size probe writes `needed`, the
 * second call fills the DACL pointer slot, and the merge/apply calls follow
 * the state's results.
 */
function daclApi(state: {
  needed: number
  currentDacl: bigint
  secondOk?: boolean
  mergeResult?: number
  mergeResults?: readonly number[]
  newDacl: bigint
  setTokenInfo?: number
  mergedSids?: NativePtr[]
}, captured: {
  setTokenInformation?: ReturnType<typeof vi.fn>
  getTokenInformation?: ReturnType<typeof vi.fn>
  localFree?: ReturnType<typeof vi.fn>
} = {}): Win32Bindings {
  // Typed mocks first: the same variables go into the stub and the sink, so no
  // reference is taken off an already-erased Win32Bindings method.
  const getTokenInformation = vi.fn((_token: unknown, cls: number, info: Buffer | null, _length: number, needed: NativePtr) => {
    if (cls !== abi.TokenDefaultDacl) throw new Error(`unexpected token information class ${cls}`)
    if (info === null) {
      koffi.encode(needed, 'uint32', state.needed)
      return 0 // the size probe is expected to "fail"
    }
    if (state.secondOk === false) return 0
    info.writeBigUInt64LE(state.currentDacl, 0)
    return 1
  })
  const setEntriesInAclW = vi.fn((_count: unknown, entries: Buffer, _old: unknown, newAcl: NativePtr) => {
    // EXPLICIT_ACCESS_W: Trustee.ptstrName (the SID) sits at offset 40.
    state.mergedSids?.push(entries.readBigUInt64LE(40) as NativePtr)
    const result = state.mergeResults?.[state.mergedSids?.length === undefined ? 0 : state.mergedSids.length - 1]
    if (result !== undefined && result !== 0) return result
    if (state.mergeResult !== undefined && state.mergeResult !== 0) return state.mergeResult
    koffi.encode(newAcl, PVOID, state.newDacl)
    return 0
  })
  const setTokenInformation = vi.fn(() => state.setTokenInfo ?? 1)
  const localFree = vi.fn((): NativePtr => 0n as NativePtr)
  captured.setTokenInformation = setTokenInformation as ReturnType<typeof vi.fn>
  captured.getTokenInformation = getTokenInformation as ReturnType<typeof vi.fn>
  captured.localFree = localFree as ReturnType<typeof vi.fn>
  // Only the members these tests drive; the shared helper supplies the type.
  return stubBindings({
    getTokenInformation,
    setEntriesInAclW,
    setTokenInformation,
    localFree,
    getLastError: vi.fn(() => 5),
    formatMessageW: vi.fn(() => 0),
  })
}

describe('setTokenDefaultDaclGrant failure paths', () => {
  const token = 9n as NativePtr
  const sid = 77n as NativePtr

  it('reports a size probe that wrote nothing', () => {
    const api = daclApi({ needed: 0, currentDacl: 0n, newDacl: 0n })
    let caught: unknown
    try {
      setTokenDefaultDaclGrant(api, token, [sid])
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('GetTokenInformation')
  })

  it('reports a failed default-DACL read', () => {
    const api = daclApi({ needed: 8, currentDacl: 88n, secondOk: false, newDacl: 0n })
    let caught: unknown
    try {
      setTokenDefaultDaclGrant(api, token, [sid])
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('GetTokenInformation')
  })

  it('rejects a token that carries no default DACL', () => {
    const api = daclApi({ needed: 8, currentDacl: 0n, newDacl: 0n })
    expect(() => { setTokenDefaultDaclGrant(api, token, [sid]) }).toThrow(/no default DACL/u)
  })

  it('reports a failed SetEntriesInAclW merge', () => {
    const api = daclApi({ needed: 8, currentDacl: 88n, mergeResult: 5, newDacl: 0n })
    let caught: unknown
    try {
      setTokenDefaultDaclGrant(api, token, [sid])
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('SetEntriesInAclW')
  })

  it('rejects a NULL merged default DACL', () => {
    const api = daclApi({ needed: 8, currentDacl: 88n, newDacl: 0n })
    let caught: unknown
    try {
      setTokenDefaultDaclGrant(api, token, [sid])
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('SetEntriesInAclW')
  })

  it('frees the merged DACL and reports when SetTokenInformation fails', () => {
    const localFree = vi.fn(() => 0n)
    const api = daclApi({ needed: 8, currentDacl: 88n, newDacl: 99n, setTokenInfo: 0 })
    ;(api.localFree as unknown as ReturnType<typeof vi.fn>).mockImplementation(localFree)
    let caught: unknown
    try {
      setTokenDefaultDaclGrant(api, token, [sid])
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('SetTokenInformation')
    expect(localFree).toHaveBeenCalledWith(99n)
  })

  it('merges the enabled-pass user SID and the restricting-pass capability SID in order', () => {
    const userSid = 101n as NativePtr
    const capabilitySid = 202n as NativePtr
    const mergedSids: NativePtr[] = []
    const captured: { setTokenInformation?: ReturnType<typeof vi.fn> } = {}
    const api = daclApi({ needed: 8, currentDacl: 88n, newDacl: 99n, mergedSids }, captured)
    setTokenDefaultDaclGrant(api, token, [userSid, capabilitySid])
    // Two merges, the ordinary identity first: a capability-only ACE fails the
    // enabled pass and denied CreatePipe under workspace-write.
    expect(mergedSids).toEqual([userSid, capabilitySid])
    expect(captured.setTokenInformation).toHaveBeenCalledTimes(1)
  })

  it('frees both intermediate ACLs and reports when the second merge fails', () => {
    const localFree = vi.fn(() => 0n)
    const mergedSids: NativePtr[] = []
    const captured: {
      localFree?: ReturnType<typeof vi.fn>
      setTokenInformation?: ReturnType<typeof vi.fn>
    } = {}
    const api = daclApi({
      needed: 8, currentDacl: 88n, newDacl: 99n, mergedSids, mergeResults: [0, 5],
    }, captured)
    captured.localFree?.mockImplementation(localFree)
    let caught: unknown
    try {
      setTokenDefaultDaclGrant(api, 9n as NativePtr, [101n as NativePtr, 202n as NativePtr])
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('SetEntriesInAclW')
    expect(localFree).toHaveBeenCalledWith(99n)
    expect(captured.setTokenInformation).not.toHaveBeenCalled()
  })

  it('rejects an empty SID list before touching the token', () => {
    const captured: { getTokenInformation?: ReturnType<typeof vi.fn> } = {}
    const api = daclApi({ needed: 8, currentDacl: 88n, newDacl: 99n }, captured)
    expect(() => { setTokenDefaultDaclGrant(api, token, []) }).toThrow(/at least one SID/u)
    expect(captured.getTokenInformation).not.toHaveBeenCalled()
  })

  it('frees the merged DACL after a successful apply', () => {
    const localFree = vi.fn(() => 0n)
    const api = daclApi({ needed: 8, currentDacl: 88n, newDacl: 99n })
    ;(api.localFree as unknown as ReturnType<typeof vi.fn>).mockImplementation(localFree)
    setTokenDefaultDaclGrant(api, token, [sid])
    expect(localFree).toHaveBeenCalledWith(99n)
  })
})

describe('restrictTokenIntegrity', () => {
  it('sets TokenIntegrityLevel to the Low label SID with SE_GROUP_INTEGRITY', () => {
    const lowSid = allocBytes(12)
    const setTokenInformation = vi.fn((
      _token: unknown, cls: number, info: Buffer, length: number,
    ) => {
      expect(cls).toBe(abi.TokenIntegrityLevel)
      expect(length).toBe(abi.TOKEN_MANDATORY_LABEL_SIZE + 12)
      expect(info.readBigUInt64LE(0)).toBe(koffi.address(lowSid))
      expect(info.readUInt32LE(8)).toBe(abi.SE_GROUP_INTEGRITY)
      return 1
    })
    const api = stubBindings({ getLengthSid: vi.fn(() => 12), setTokenInformation })
    restrictTokenIntegrity(api, 5n as NativePtr, lowSid)
    expect(setTokenInformation).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the Low label SID has no length', () => {
    const api = stubBindings({
      getLengthSid: vi.fn(() => 0),
      getLastError: vi.fn(() => 87),
      formatMessageW: vi.fn(() => 0),
    })
    let caught: unknown
    try {
      restrictTokenIntegrity(api, 5n as NativePtr, allocBytes(12))
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('GetLengthSid')
  })

  it('fails closed when SetTokenInformation rejects the integrity level', () => {
    const api = stubBindings({
      getLengthSid: vi.fn(() => 12),
      setTokenInformation: vi.fn(() => 0),
      getLastError: vi.fn(() => 5),
      formatMessageW: vi.fn(() => 0),
    })
    let caught: unknown
    try {
      restrictTokenIntegrity(api, 5n as NativePtr, allocBytes(12))
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('SetTokenInformation')
  })
})

describe('createRestrictedToken failure paths', () => {
  it('builds the read-only restricting list without a write SID', () => {
    const create = vi.fn((
      _existing: unknown, _flags: unknown, _dc: unknown, _ds: unknown, _pc: unknown, _pd: unknown,
      count: number, _sids: unknown, slot: NativePtr,
    ) => {
      koffi.encode(slot, PVOID, 9n)
      expect(count).toBe(2)
      return 1
    })
    const api = { createRestrictedToken: create } as unknown as Win32Bindings
    const logon = allocBytes(12)
    expect(createRestrictedToken(api, 1n as NativePtr, logon, [], { world: 2n as NativePtr }, 'read-only')).toBe(9n)
  })

  it('builds the workspace-write restricting list with the write SID', () => {
    const create = vi.fn((
      _existing: unknown, _flags: unknown, _dc: unknown, _ds: unknown, _pc: unknown, _pd: unknown,
      count: number, _sids: unknown, slot: NativePtr,
    ) => {
      koffi.encode(slot, PVOID, 9n)
      expect(count).toBe(3)
      return 1
    })
    const api = { createRestrictedToken: create } as unknown as Win32Bindings
    const logon = allocBytes(12)
    expect(createRestrictedToken(api, 1n as NativePtr, logon, [3n as NativePtr], { world: 2n as NativePtr }, 'workspace-write')).toBe(9n)
  })

  it('reports when CreateRestrictedToken fails', () => {
    const api = {
      createRestrictedToken: vi.fn(() => 0),
      getLastError: vi.fn(() => 5),
      formatMessageW: vi.fn(() => 0),
    } as unknown as Win32Bindings
    const logon = allocBytes(12)
    let caught: unknown
    try {
      createRestrictedToken(api, 1n as NativePtr, logon, [], { world: 2n as NativePtr }, 'read-only')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('CreateRestrictedToken')
  })

  it('rejects a NULL token handle after a successful CreateRestrictedToken', () => {
    const api = {
      createRestrictedToken: vi.fn(() => 1), // succeeds without writing the out slot
      getLastError: vi.fn(() => 5),
      formatMessageW: vi.fn(() => 0),
    } as unknown as Win32Bindings
    const logon = allocBytes(12)
    let caught: unknown
    try {
      createRestrictedToken(api, 1n as NativePtr, logon, [], { world: 2n as NativePtr }, 'read-only')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('CreateRestrictedToken')
  })
})
