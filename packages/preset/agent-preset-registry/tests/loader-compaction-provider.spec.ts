import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dump } from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include, { type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import AgentPreset from '@deepseek-ai/dsh-agent-preset'
import AgentPresetRegistry from '../src/index.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    testCompactionEngine: { provider: string }
    testCompactCommand: { module: string }
    testToolResultPruner: { module: string }
  }
}

const BASIC = '@deepseek-ai/dsh-compaction-basic'
const ENGINE = '@missher/dsh-context-manager/engine'
const COMMAND = '@deepseek-ai/dsh-command-compact'
const PRUNER = '@deepseek-ai/dsh-compaction-tool-result-pruner'
const RETAINED = '@example/upstream-added-plugin'
const MANAGER = '@missher/dsh-context-manager'
const INSPECTOR = '@missher/dsh-context-manager/inspector'
const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function provider(name: string, activate: (ctx: Context) => void) {
  return { name, apply: activate }
}

async function boot(config: unknown, activated: string[], patches: PatchOptions[] = []): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-preset-compaction-loader-'))
  roots.push(root)
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, dump(config, { lineWidth: -1 }))

  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(`${root}/`).href
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.builtins.group = Group
  await ctx.plugin(SessionProjectionRegistry)
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent-preset-registry', AgentPresetRegistry],
    ['@deepseek-ai/dsh-agent-preset', AgentPreset],
    [MANAGER, provider(MANAGER, () => {})],
    [INSPECTOR, provider(INSPECTOR, () => {})],
    [BASIC, provider(BASIC, (ctx) => {
      activated.push(BASIC)
      ctx.provide('testCompactionEngine', { provider: BASIC })
    })],
    [ENGINE, provider(ENGINE, (ctx) => {
      activated.push(ENGINE)
      ctx.provide('testCompactionEngine', { provider: ENGINE })
    })],
    [COMMAND, provider(COMMAND, (ctx) => {
      activated.push(COMMAND)
      ctx.provide('testCompactCommand', { module: COMMAND })
    })],
    [PRUNER, provider(PRUNER, (ctx) => {
      activated.push(PRUNER)
      ctx.provide('testToolResultPruner', { module: PRUNER })
    })],
    ['@example/compaction-provider', provider('@example/compaction-provider', () => {
      activated.push('@example/compaction-provider')
    })],
    [RETAINED, provider(RETAINED, () => {
      activated.push(RETAINED)
    })],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href, patches } })
  await ctx.loader.await()
  return ctx
}

function presetPlugins(id: string, plugins?: unknown[]) {
  return plugins ?? [{
    id: `compaction-${id}`, name: 'cordis:group', group: true,
    isolate: { testCompactionEngine: true, testCompactCommand: true, testToolResultPruner: true },
    config: [
      { id: 'compaction-basic', name: BASIC },
      { id: 'command-compact', name: COMMAND },
      { id: 'tool-result-pruner', name: PRUNER },
      { id: 'upstream-added-plugin', name: RETAINED },
    ],
  }]
}

function composition(compactionProvider?: string, plugins?: unknown[]) {
  return [
    { id: 'agent-presets', name: '@deepseek-ai/dsh-agent-preset-registry', config: { default: 'standard' } },
    ...['standard', 'ptc', 'cordis'].map(id => ({
      id: `preset-${id}`, name: '@deepseek-ai/dsh-agent-preset', config: {
        id, ...(compactionProvider === undefined ? {} : { compactionProvider }), plugins: presetPlugins(id, plugins),
      },
    })),
  ]
}

function isPresetConfigRow<T extends { id: string }>(row: T): row is T & { config: Record<string, unknown> } {
  return row.id.startsWith('preset-')
    && 'config' in row
    && typeof row.config === 'object'
    && row.config !== null
    && !Array.isArray(row.config)
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

describe('preset compaction provider through a real Loader composition', () => {
  it('applies the narrow patch, preserves added rows, and mounts Context at Basic order', async () => {
    const activated: string[] = []
    const base = [{ id: 'compaction-basic', name: BASIC }, ...composition(undefined)]
    const originalConfigs = new Map(base.filter(isPresetConfigRow).map(row => [row.id, structuredClone(row.config)] as const))
    const patches: PatchOptions[] = [
      { id: 'compaction-basic', name: BASIC, disabled: true },
      { insert: [
        { id: 'context-manager', name: MANAGER },
        { id: 'context-manager-engine', name: ENGINE },
        { id: 'context-manager-inspector', name: INSPECTOR },
      ] },
      ...['standard', 'ptc', 'cordis'].map(id => ({
        id: `preset-${id}`, name: '@deepseek-ai/dsh-agent-preset', compactionProvider: ENGINE,
      })),
    ]
    const ctx = await boot(base, activated, patches)

    for (const id of ['standard', 'ptc', 'cordis']) {
      const mountedPresetRow = [...ctx.loader.entries()].find(entry => entry.options.id === `preset-${id}`)
      expect(mountedPresetRow?.options.config).toEqual({ ...originalConfigs.get(`preset-${id}`), compactionProvider: ENGINE })
    }
    expect(ctx.get('testCompactionEngine')).toEqual({ provider: ENGINE })

    const presets = await ctx.agentPresets.compositionInventory()
    expect(presets.map(preset => preset.id).sort()).toEqual(['cordis', 'ptc', 'standard'])
    for (const preset of presets) {
      expect(preset.broken).toBeUndefined()
      expect(preset.rows.map(row => row.moduleName)).toEqual([ENGINE, COMMAND, PRUNER, RETAINED])
      expect(preset.rows.filter(row => row.moduleName === ENGINE)).toHaveLength(1)
      expect(preset.rows.some(row => row.moduleName === BASIC)).toBe(false)
    }
    expect(activated.filter(name => name === BASIC)).toEqual([])
    expect(ctx.agentPresets.inspectCompositions()[0]?.leakedServices).toEqual([])

    for (const id of ['standard', 'ptc', 'cordis']) {
      const scope = createScope(ctx, {})
      try {
        await ctx.agentPresets.mount(scope.ctx, id)
        expect(ctx.agentPresets.serviceFor({ ctx: scope.ctx }, 'testCompactionEngine')).toEqual({ provider: ENGINE })
        expect(ctx.agentPresets.serviceFor({ ctx: scope.ctx }, 'testCompactCommand')).toEqual({ module: COMMAND })
        expect(ctx.agentPresets.serviceFor({ ctx: scope.ctx }, 'testToolResultPruner')).toEqual({ module: PRUNER })
        expect(ctx.agentPresets.inspectCompositions().find(row => row.id === id)?.leakedServices).toEqual([])
      } finally {
        await scope.dispose()
      }
    }
  })

  it('keeps the saved full plugin tree when the Host config omits compactionProvider', async () => {
    const activated: string[] = []
    const ctx = await boot(composition(undefined), activated)

    const [preset] = await ctx.agentPresets.compositionInventory()
    expect(preset?.broken).toBeUndefined()
    expect(preset?.rows.map(row => row.moduleName)).toEqual([BASIC, COMMAND, PRUNER, RETAINED])
    expect(activated).toEqual(Array.from({ length: 3 }, () => [BASIC, COMMAND, PRUNER, RETAINED]).flat())
  })

  it('runs the legacy full-config fallback using the pre-capability patch contract', async () => {
    const activated: string[] = []
    const base = [{ id: 'compaction-basic', name: BASIC }, ...composition(undefined)]
    const replaceBasic = (rows: unknown[]): void => {
      for (const row of rows as { name?: string; group?: boolean; config?: unknown[] }[]) {
        if (row.name === BASIC) row.name = ENGINE
        if (row.group && Array.isArray(row.config)) replaceBasic(row.config)
      }
    }
    const fallbackPatches: PatchOptions[] = [
      { id: 'compaction-basic', name: BASIC, disabled: true },
      { insert: [
        { id: 'context-manager', name: MANAGER },
        { id: 'context-manager-engine', name: ENGINE },
        { id: 'context-manager-inspector', name: INSPECTOR },
      ] },
      ...base.filter(isPresetConfigRow).map((row) => {
        const config = structuredClone(row.config)
        const plugins = config.plugins
        if (!isUnknownArray(plugins)) throw new Error('preset config is missing its plugin rows')
        replaceBasic(plugins)
        return { id: row.id, name: '@deepseek-ai/dsh-agent-preset', config }
      }),
    ]
    const fallback = await boot(base, activated, fallbackPatches)

    expect(fallbackPatches.filter(patch => patch.config !== undefined)
      .every(patch => !isUnknownRecord(patch.config) || !Object.hasOwn(patch.config, 'compactionProvider'))).toBe(true)
    expect([...fallback.loader.entries()].find(entry => entry.options.id === 'compaction-basic')?.disabled).toBe(true)
    expect(fallback.get('testCompactionEngine')).toEqual({ provider: ENGINE })
    const presets = await fallback.agentPresets.compositionInventory()
    expect(presets.map(preset => preset.id).sort()).toEqual(['cordis', 'ptc', 'standard'])
    for (const preset of presets) {
      expect(preset.broken).toBeUndefined()
      expect(preset.rows.map(row => row.moduleName)).toEqual([ENGINE, COMMAND, PRUNER, RETAINED])
      expect(preset.rows.filter(row => row.moduleName === ENGINE)).toHaveLength(1)
    }
    expect(activated.filter(name => name === ENGINE)).toHaveLength(4)
    expect(fallback.agentPresets.inspectCompositions().every(row => row.leakedServices.length === 0)).toBe(true)
  })

  it.each([
    ['missing', [{ name: COMMAND }], /expected exactly one.*found 0/u],
    ['duplicate', [{ name: BASIC }, { name: BASIC }], /expected exactly one.*found 2/u],
    ['competing', [{ name: BASIC }, { name: '@example/compaction-provider' }], /competing compaction provider/u],
  ] as const)('rejects %s provider declarations before importing child plugins', async (_kind, rows, expected) => {
    const activated: string[] = []
    const nested = [{ name: 'cordis:group', group: true, config: rows }]
    const ctx = await boot(composition(ENGINE, nested), activated)

    const resolution = await ctx.agentPresets.resolve('standard')
    expect(resolution.broken).toBeDefined()
    expect(resolution.broken ?? '').toMatch(expected)
    expect(activated).toEqual([])
  })
})
