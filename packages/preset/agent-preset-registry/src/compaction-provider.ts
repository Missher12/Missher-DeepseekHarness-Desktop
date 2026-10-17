/** Narrow, immutable substitution for a preset's automatic compaction provider. */
import { entryListProblem, type PresetDefinition } from './definition.ts'

/** The bundled automatic compaction provider every declared composition carries. */
export const BASIC_COMPACTION_PROVIDER = '@deepseek-ai/dsh-compaction-basic'
const BASIC_PROVIDER = BASIC_COMPACTION_PROVIDER
const CONTEXT_ENGINE = '@missher/dsh-context-manager/engine'
const SIDECARS = new Set([
  '@deepseek-ai/dsh-compaction-image-offload',
  '@deepseek-ai/dsh-compaction-tool-result-pruner',
])

type PresetRows = PresetDefinition['plugins']
type Row = PresetRows[number]

/**
 * Whether a row names an automatic compaction provider.
 *
 * Providers are recognized by identity: the bundled provider, the engine the
 * versioned Context integration supplies, and the module the declaration
 * itself asks for. A module whose name merely contains `compaction` provides
 * something else, and a companion row named here as a sidecar is never the
 * provider.
 * @param name - the row's module specifier.
 * @param requested - the provider the declaration asks for.
 * @returns true when the row supplies automatic compaction.
 */
function isProviderName(name: string, requested: string): boolean {
  if (SIDECARS.has(name)) return false
  return name === BASIC_PROVIDER || name === CONTEXT_ENGINE || name === requested
}

/** Outcome of planning one declaration's automatic compaction provider. */
export type CompactionPlan =
  | { readonly kind: 'replace'; readonly provider: string; readonly rows: PresetRows }
  | { readonly kind: 'skipped'; readonly reason: string }

/**
 * Plan the substitution of the bundled automatic compaction provider.
 *
 * Every reason a substitution cannot be applied is reported as `skipped`, so
 * the caller keeps the declared composition usable instead of failing the
 * preset: a declaration that names no provider, names the bundled provider,
 * carries an unusable row list, holds no or several bundled provider rows, or
 * already holds a competing automatic provider.
 * @param rows - preset plugin rows to inspect.
 * @param provider - distinct provider module that replaces the basic compaction row.
 * @returns the substituted rows, or why the declaration keeps its own rows.
 */
export function planCompactionSubstitution(rows: PresetRows, provider: string): CompactionPlan {
  if (typeof provider !== 'string' || provider.trim() === '') {
    return { kind: 'skipped', reason: 'compactionProvider must name a non-empty plugin module' }
  }
  if (provider === BASIC_PROVIDER) {
    return { kind: 'skipped', reason: `${BASIC_PROVIDER} already supplies automatic compaction` }
  }
  const problem = entryListProblem(rows)
  if (problem !== undefined) return { kind: 'skipped', reason: problem }

  let targetCount = 0
  let competingProvider: string | undefined
  const inspect = (items: readonly Row[]): void => {
    for (const row of items) {
      if (row.id === 'compaction-basic' && row.name !== BASIC_PROVIDER) competingProvider ??= row.name
      if (row.name === BASIC_PROVIDER) targetCount++
      else if (isProviderName(row.name, provider)) competingProvider ??= row.name
      if (row.group === true) inspect(row.config as readonly Row[])
    }
  }
  inspect(rows)
  if (competingProvider !== undefined) {
    return { kind: 'skipped', reason: `competing compaction provider: ${competingProvider}` }
  }
  if (targetCount !== 1) {
    return { kind: 'skipped', reason: `expected exactly one ${BASIC_PROVIDER} row; found ${targetCount}` }
  }
  return { kind: 'replace', provider, rows: replace(rows, provider) }
}

/** Copy the row list with exactly the bundled provider renamed. */
function replace(items: readonly Row[], provider: string): Row[] {
  return items.map((row) => {
    if (row.name === BASIC_PROVIDER) return { ...row, name: provider }
    if (row.group !== true) return row
    return { ...row, config: replace(row.config as readonly Row[], provider) }
  })
}

/**
 * Replace exactly the declared basic provider while preserving all other rows,
 * group order, isolation flags, command plugins and reducers.
 *
 * The caller may omit this function entirely when running on an older Host;
 * in that case the saved, complete preset remains authoritative.
 * @param rows - preset plugin rows to inspect and copy.
 * @param provider - distinct provider module that replaces the basic compaction row.
 * @returns copied preset rows with exactly the basic provider replaced.
 * @throws {Error} with the {@link planCompactionSubstitution} reason when no substitution applies.
 */
export function replaceCompactionProvider(rows: PresetRows, provider: string): PresetRows {
  const plan = planCompactionSubstitution(rows, provider)
  if (plan.kind === 'skipped') throw new Error(plan.reason)
  return plan.rows
}
