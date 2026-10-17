/** Resolve the physical Desktop directories one CLI launch depends on. */

import { basename, dirname, join } from 'node:path'
import { runtimeArchivePath } from './office-engine.ts'

/**
 * Locate the physical runtime directory that owns the primary-runtime payload.
 * Prepared trees keep it beside the dsh package, ASAR builds keep it beside the
 * archive, and Linux unpacked builds keep it beside the `app` tree.
 * @param runtimeDir - Prepared, ASAR-contained, or unpacked `dsh` package tree.
 * @returns Absolute Desktop runtime directory containing `primary-runtime` and `bin`.
 */
export function desktopSupportDir(runtimeDir: string): string {
  const archive = runtimeArchivePath(runtimeDir)
  if (archive !== undefined) return join(dirname(archive), 'runtime')
  const parent = dirname(runtimeDir)
  // The Linux app tree lives under resources/app while the payload stays in resources/runtime.
  return join(basename(parent) === 'app' ? dirname(parent) : parent, 'runtime')
}
