/** Resolve and constrain the Documents directory for the isolated packaged-Desktop smoke. */
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'

/**
 * The AppleScript lookup the Host runs for first-use Workspace creation
 * (`packages/api/workspace-controller/src/default-directory.ts`).
 */
export const MACOS_DOCUMENTS_SCRIPT = 'POSIX path of (path to documents folder from user domain without folder creation)'

/** Bound on the pre-launch lookup, matching the Host's own documents lookup deadline. */
export const DOCUMENTS_LOOKUP_TIMEOUT_MS = 10_000

/**
 * Environment for the packaged Desktop process under an isolated profile: a
 * private home, config, cache, harness data, and diagnostic file. The Electron
 * Node switch is removed because a GUI child that inherits it rejects Chromium
 * flags. The smoke and the preflight share this environment so both ask the
 * Documents question exactly as the launched application does.
 * @param root - isolated profile root.
 * @param platform - target platform; defaults to the running one.
 * @returns the child environment.
 */
export function isolatedProfileEnv(root, platform = process.platform) {
  const env = { ...process.env, ...(platform === 'darwin' ? { HOME: root, CFFIXED_USER_HOME: root } : {}),
    XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache'),
    ...(platform === 'win32' ? { APPDATA: join(root, 'config'), LOCALAPPDATA: join(root, 'cache') } : {}),
    DSH_HOME: join(root, 'harness'), DSH_DESKTOP_DIAGNOSTIC_FILE: join(root, 'fatal.txt'), DSH_TELEMETRY_DISABLED: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

/**
 * Ask the OS the same Documents question the Host asks, so the smoke verifies
 * the directory the Host really writes instead of assuming the isolated `HOME`
 * override decides it. A missing, failed, timed-out, or non-absolute answer
 * rejects, because the Host rejects it too and no Workspace can be verified.
 * @param env - environment shared with the launched Desktop process.
 * @param run - injectable command runner; defaults to `spawnSync`.
 * @param timeoutMs - maximum lookup duration; the child is killed after it.
 * @returns the absolute Documents directory without its trailing newline.
 */
export function macosDocumentsDirectory(env, run = spawnSync, timeoutMs = DOCUMENTS_LOOKUP_TIMEOUT_MS) {
  const result = run('osascript', ['-e', MACOS_DOCUMENTS_SCRIPT], { env, encoding: 'utf8', timeout: timeoutMs })
  if (result.error) throw new Error(`macOS Documents lookup failed: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`macOS Documents lookup failed: ${String(result.stderr ?? '').trim() || `osascript exited with ${result.status}`}`)
  }
  const directory = String(result.stdout ?? '').replace(/[\r\n]+$/u, '')
  if (!directory.startsWith('/')) throw new Error(`macOS Documents lookup returned a non-absolute directory: '${directory}'`)
  return directory
}

function contained(root, candidate) {
  const rest = relative(root, candidate)
  return rest === '' || (!isAbsolute(rest) && rest !== '..' && !rest.startsWith(`..${sep}`))
}

/**
 * Decide whether a Documents directory stays inside the isolated profile root.
 * Both sides are realpath-resolved first, so the macOS `/var` and
 * `/private/var` spellings of the same temporary root compare equal. An
 * unresolvable path is reported as not isolated: containment must be proven,
 * never assumed, before the Workspace check may pass.
 * @param directory - Documents directory returned by the OS lookup.
 * @param root - isolated profile root the smoke created.
 * @returns the raw and realpath-resolved spelling of both sides plus the verdict.
 */
export function documentsIsolation(directory, root) {
  const resolve = (path) => { try { return realpathSync(path) } catch { return null } }
  const resolvedRoot = resolve(root)
  const resolvedDirectory = resolve(directory)
  const isolated = resolvedRoot !== null && resolvedDirectory !== null && contained(resolvedRoot, resolvedDirectory)
  return { root, directory, resolvedRoot, resolvedDirectory, isolated }
}
