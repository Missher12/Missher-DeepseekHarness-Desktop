/** Resolve packaged Desktop runtime directories and keep Office engine manifests usable by native child processes. */
import { registerHooks, type ModuleHooks } from 'node:module'
import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Locate the archive containing a packaged runtime.
 * @param runtimeDir - Prepared or ASAR-contained runtime directory.
 * @returns Parent archive path, or undefined for a prepared directory.
 */
export function runtimeArchivePath(runtimeDir: string): string | undefined {
  const parent = dirname(runtimeDir)
  return basename(parent) === 'app.asar' ? parent : undefined
}

/**
 * Locate the physical Desktop runtime payload beside a prepared or packaged dsh tree.
 * Packaged payloads ship as `resources/runtime`: a sibling of the unpacked `resources/app`
 * directory on Linux (asar=false) and of `resources/app.asar` elsewhere. A prepared layout
 * keeps `runtime` as the direct sibling of the dsh directory itself.
 * @param runtimeDir - Prepared or ASAR-contained dsh runtime directory.
 * @returns Physical `runtime` directory holding the primary-runtime payload and Node launchers.
 * @throws When neither candidate runtime directory exists on disk.
 */
export function runtimeSupportDir(runtimeDir: string): string {
  const root = dirname(runtimeDir)
  const sibling = join(root, 'runtime')
  if (existsSync(sibling)) return sibling
  const nested = join(dirname(root), 'runtime')
  if (existsSync(nested)) return nested
  throw new Error(`desktop runtime: no bundled runtime payload at ${sibling} or ${nested}`)
}

/**
 * Keep engine executable and resource paths usable by native child processes outside Electron.
 * Hooks apply only to this thread; worker threads must install their own resolver.
 * @param runtimeDir - Prepared or ASAR-contained dsh runtime directory.
 * @returns Installed resolver for the Host lifetime, or undefined for a non-ASAR runtime.
 */
export function installOfficeEngineResolution(runtimeDir: string): ModuleHooks | undefined {
  if (runtimeArchivePath(runtimeDir) === undefined) return undefined
  const root = realpathSync(runtimeDir)
  const archive = dirname(root)
  const source = pathToFileURL(join(root, 'node_modules', '@deepseek-ai', 'libreoffice-kit-')).href
  const destination = pathToFileURL(join(`${archive}.unpacked`, relative(archive, root), 'node_modules', '@deepseek-ai', 'libreoffice-kit-')).href
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context)
      if (!resolved.url.startsWith('file:')) return resolved
      const engineRequest = /^@deepseek-ai\/libreoffice-kit-(?:darwin|win32|linux)-/u.test(specifier)
      const engineTarget = /\/node_modules\/@deepseek-ai\/libreoffice-kit-(?:darwin|win32|linux)-[^/]+\//u
        .test(new URL(resolved.url).pathname)
      if (!engineRequest && !engineTarget) return resolved
      const canonical = pathToFileURL(realpathSync(fileURLToPath(resolved.url))).href
      if (!canonical.startsWith(source)) {
        if (canonical.startsWith(pathToFileURL(archive + '/').href)) {
          throw new Error(`desktop Office engine resolved outside the runtime package directory: ${resolved.url}`)
        }
        return resolved
      }
      const physical = realpathSync(fileURLToPath(destination + canonical.slice(source.length)))
      return { ...resolved, url: pathToFileURL(physical).href }
    },
  })
}
