/** Narrow, immutable substitution for a preset's automatic compaction provider. */
import { entryListProblem, type PresetDefinition } from './definition.ts'

const BASIC_PROVIDER = '@deepseek-ai/dsh-compaction-basic'
const CONTEXT_ENGINE = '@missher/dsh-context-manager/engine'
const SIDECARS = new Set([
  '@deepseek-ai/dsh-compaction-image-offload',
  '@deepseek-ai/dsh-compaction-tool-result-pruner',
])

type PresetRows = PresetDefinition['plugins']
type Row = PresetRows[number]

function isProviderName(name: string): boolean {
  if (name === BASIC_PROVIDER || name === CONTEXT_ENGINE) return true
  if (!name.includes('compaction')) return false
  return !SIDECARS.has(name)
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
 */
export function replaceCompactionProvider(rows: PresetRows, provider: string): PresetRows {
  if (typeof provider !== 'string' || provider.trim() === '' || provider === BASIC_PROVIDER) {
    throw new Error('compactionProvider must name a distinct non-empty plugin module')
  }
  const problem = entryListProblem(rows)
  if (problem !== undefined) throw new Error(problem)

  let targetCount = 0
  let competingProvider: string | undefined
  const inspect = (items: readonly Row[]): void => {
    for (const row of items) {
      if (row.id === 'compaction-basic' && row.name !== BASIC_PROVIDER) competingProvider ??= row.name
      if (row.name === BASIC_PROVIDER) targetCount++
      else if (isProviderName(row.name)) competingProvider ??= row.name
      if (row.group === true) inspect(row.config as readonly Row[])
    }
  }
  inspect(rows)
  if (competingProvider !== undefined) throw new Error(`competing compaction provider: ${competingProvider}`)
  if (targetCount !== 1) throw new Error(`expected exactly one ${BASIC_PROVIDER} row; found ${targetCount}`)

  const replace = (items: readonly Row[]): Row[] => items.map((row) => {
    if (row.name === BASIC_PROVIDER) return { ...row, name: provider }
    if (row.group !== true) return row
    return { ...row, config: replace(row.config as readonly Row[]) }
  })
  return replace(rows)
}
