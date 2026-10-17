/** Declarative preset configuration and YAML validation. */
import type { Fiber } from '@deepseek-ai/cordis'
import type { EntryOptions, JsExpr } from '@deepseek-ai/cordis-plugin-loader'

/** Module of the plugin row that declares one Agent preset. */
export const PRESET_DECLARATION_MODULE = '@deepseek-ai/dsh-agent-preset'

/**
 * Real Loader identity of the row that declares one preset.
 *
 * The two ids are different names for the same row: `entryId` is the
 * hierarchical id the Loader composes from its containing trees and includes,
 * and `patchId` is the id patch layers target. Neither is derived from the
 * other.
 */
export interface PresetDeclarationIdentity {
  /** Hierarchical Loader entry id, as `Entry.id` reports it. */
  readonly entryId?: string
  /** Patch-local row id, as `Entry.options.id` reports it. */
  readonly patchId?: string
  /** The declaring plugin's own fiber, compared by identity so a replacement row is never mistaken for it. */
  readonly fiber?: Fiber
}

/**
 * The package identity of a module specifier: its root package name, so a
 * subpath export compares equal to the package that carries it.
 * @param specifier - module specifier or bare package name.
 * @returns the package name the specifier belongs to.
 */
export function packageIdentity(specifier: string): string {
  const segments = specifier.split('/')
  if (!specifier.startsWith('@')) return segments[0] ?? specifier
  const scope = segments[0]
  const name = segments[1]
  return scope === undefined || name === undefined ? specifier : `${scope}/${name}`
}

/** Identity, display fields and child Cordis plugins of one preset. */
export interface PresetDefinition {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly order?: number
  /** Optional provider that replaces the one bundled automatic compaction backend at activation. */
  readonly compactionProvider?: string
  readonly plugins: readonly (Omit<EntryOptions, 'id' | 'disabled'> & { id?: string; disabled?: EntryOptions['disabled'] | JsExpr })[]
}

/** Validate a parsed Cordis entry list, including nested groups.
 * @param rows Parsed YAML value.
 * @param at Diagnostic prefix.
 * @returns The first invalid row, or undefined.
 */
export function entryListProblem(rows: unknown, at = ''): string | undefined {
  if (!Array.isArray(rows)) {
    return at === ''
      ? 'the composition must be a top-level list of plugin rows'
      : `group ${at} must hold a list of plugin rows`
  }
  for (const [index, row] of rows.entries()) {
    const label = at === '' ? `row ${String(index + 1)}` : `${at} row ${String(index + 1)}`
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      return `${label} is not a plugin row (expected a map with a "name")`
    }
    const { name, group, config } = row as { name?: unknown; group?: unknown; config?: unknown }
    if (typeof name !== 'string' || name === '') {
      return `${label} names no plugin (a "name" string is required)`
    }
    if (group === true) {
      const nested = entryListProblem(config, label)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}
