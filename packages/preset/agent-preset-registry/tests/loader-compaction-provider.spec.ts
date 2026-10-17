import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dump } from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Include, { type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import Loader, { EntryTree } from '@deepseek-ai/cordis-plugin-loader'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import AgentPreset from '@deepseek-ai/dsh-agent-preset'
import { applyProfileComposition, loadProfileDirectory, profileCompositionRevision, readProfilePatchLayers, withCompositionOwners, type ProfileContext, type ProfilePatchLayer } from '@deepseek-ai/dsh-app-boot'
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
let profileLayers: ProfilePatchLayer[] = []
let profileContext: ProfileContext | undefined
let pendingMount: Promise<unknown> = Promise.resolve()

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  profileContext = undefined
})

/** Whether the bundled provider publishes its service; a test flips it to force a later mount to fail. */
let basicAvailable = true

/** Fibers each mapped module mounted, in activation order. */
const moduleFibers = new Map<string, Context['fiber']>()

function provider(name: string, activate: (ctx: Context) => void) {
  return { name, apply: (ctx: Context) => { moduleFibers.set(name, ctx.fiber); activate(ctx) } }
}

async function boot(config: unknown, activated: string[], patches: PatchOptions[] = []): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-preset-compaction-loader-'))
  roots.push(root)
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, dump(config, { lineWidth: -1 }))

  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(`${root}/`).href
  if (profileContext !== undefined) ctx.provide('profileContext', profileContext)
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
      if (!basicAvailable) throw new Error('the bundled provider cannot start')
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
    // A real automatic provider: it publishes the same service the bundled one does.
    ['@example/context-engine', provider('@example/context-engine', (ctx) => {
      activated.push('@example/context-engine')
      ctx.provide('testCompactionEngine', { provider: '@example/context-engine' })
    })],
    // A real Host manager and an engine that statically injects it: the engine
    // can only be selected once that manager is active.
    ['@example/context-manager', provider('@example/context-manager', (ctx) => {
      activated.push('@example/context-manager')
      ctx.provide('testContextManager', { module: '@example/context-manager' })
    })],
    ['@example/injecting-engine', { name: '@example/injecting-engine', inject: ['testContextManager'],
      apply: (ctx: Context) => {
        activated.push('@example/injecting-engine')
        ctx.provide('testCompactionEngine', { provider: '@example/injecting-engine' })
      } }],
    // A real sidecar: its name mentions compaction but it publishes another service.
    ['@example/compaction-inspector', provider('@example/compaction-inspector', (ctx) => {
      activated.push('@example/compaction-inspector')
      ctx.provide('testCompactCommand', { module: '@example/compaction-inspector' })
    })],
    [RETAINED, provider(RETAINED, () => {
      activated.push(RETAINED)
    })],
  ])
  const internal = ctx.loader.internal
  if (internal === undefined) throw new Error('the Loader exposes no internal importer')
  // Only the importer is replaced; the cache, the version and every other
  // loader operation stay the real ones this process runs with.
  const override: typeof internal.import = async (specifier: string) => {
    if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
    return modules.get(specifier)
  }
  ctx.loader.internal = Object.assign(Object.create(internal) as typeof internal, { import: override })
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
  it('applies a trusted declaration selection, preserves added rows, and mounts Context at Basic order', async () => {
    const activated: string[] = []
    await trustedProfile({ rows: presetPlugins('standard'), provider: ENGINE })
    const patches = profileLayers.flatMap(layer => layer.patches)
    const mountedRow = patches.flatMap(patch => patch.insert ?? []).find(row => row.id === 'preset-standard')
    expect(mountedRow).toBeDefined()
    const ctx = await boot([], activated, patches)

    const mountedPresetRow = [...ctx.loader.entries()].find(entry => entry.options.id === 'preset-standard')
    expect(mountedPresetRow?.options.config).toMatchObject({ id: 'standard', compactionProvider: ENGINE })

    const presets = await ctx.agentPresets.compositionInventory()
    expect(presets.map(preset => preset.id)).toEqual(['standard'])
    for (const preset of presets) {
      expect(preset.broken).toBeUndefined()
      expect(preset.rows.map(row => row.moduleName)).toEqual([ENGINE, COMMAND, PRUNER, RETAINED])
      expect(preset.rows.filter(row => row.moduleName === ENGINE)).toHaveLength(1)
      expect(preset.rows.some(row => row.moduleName === BASIC)).toBe(false)
    }
    expect(activated.filter(name => name === BASIC)).toEqual([])
    expect(ctx.agentPresets.inspectCompositions()[0]?.leakedServices).toEqual([])

    const scope = createScope(ctx, {})
    try {
      await ctx.agentPresets.mount(scope.ctx, 'standard')
      expect(ctx.agentPresets.serviceFor({ ctx: scope.ctx }, 'testCompactionEngine')).toEqual({ provider: ENGINE })
      expect(ctx.agentPresets.serviceFor({ ctx: scope.ctx }, 'testCompactCommand')).toEqual({ module: COMMAND })
      expect(ctx.agentPresets.serviceFor({ ctx: scope.ctx }, 'testToolResultPruner')).toEqual({ module: PRUNER })
      expect(ctx.agentPresets.inspectCompositions().find(row => row.id === 'standard')?.leakedServices).toEqual([])
    } finally {
      await scope.dispose()
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

  it('keeps a valid declaration usable and skips an unvouched provider selection', async () => {
    const activated: string[] = []
    const nested = [{
      id: 'compaction', name: 'cordis:group', group: true,
      isolate: { testCompactionEngine: true, testCompactCommand: true, testToolResultPruner: true },
      config: [
        { id: 'command-compact', name: COMMAND },
        { id: 'tool-result-pruner', name: PRUNER },
      ],
    }]
    const ctx = await boot(composition(ENGINE, nested), activated)

    const resolution = await ctx.agentPresets.resolve('standard')
    // The declared rows are a valid composition, so the preset stays usable and
    // only the unvouched provider selection is reported as skipped.
    expect(resolution.broken).toBeUndefined()
    expect(resolution.compaction?.state).toBe('skipped')
    expect(resolution.compaction?.reason).toBe('no trusted in-box layer vouches for this declaration')
    expect(activated).toContain(COMMAND)
    const [preset] = await ctx.agentPresets.compositionInventory()
    expect(preset?.rows.map(row => row.moduleName)).toEqual([COMMAND, PRUNER])
  })

  it('reports a genuinely unusable declaration as broken, not as a skipped enhancement', async () => {
    const activated: string[] = []
    // The declared group has no isolate realm, so its provider leaks into the
    // root realm: the declaration itself is unusable, independently of any
    // provider selection.
    const nested = [{ name: 'cordis:group', group: true, config: [{ id: 'command-compact', name: COMMAND }] }]
    const ctx = await boot(composition(ENGINE, nested), activated)

    const resolution = await ctx.agentPresets.resolve('standard')
    expect(resolution.broken).toMatch(/isolate/u)
    expect(ctx.agentPresets.inspectCompositions()).toEqual([])
  })
})

/** Start one plugin and return its own context: `ctx.plugin()` resolves to the fiber, not a Context. */
async function ownerContext(ctx: Context): Promise<Context> {
  let owner: Context | undefined
  await ctx.plugin({ apply: (child: Context) => { owner = child } })
  if (owner === undefined) throw new Error('the plugin context was not created')
  return owner
}

/**
 * One install anchor that declares a bundle whose patch declares the standard
 * preset. The bundle resolves from the installation anchor and its manifest is
 * declared by that installation, so its layer is the trusted origin the
 * registry requires before any enhancement applies.
 */
async function trustedProfile(options: {
  rows?: unknown[]
  provider?: string
  userPatch?: unknown[]
  node?: boolean
  secondPreset?: boolean
  inspectors?: number
  manager?: boolean
} = {}): Promise<void> {
  const install = await mkdtemp(join(tmpdir(), 'dsh-preset-install-'))
  const profile = await mkdtemp(join(tmpdir(), 'dsh-preset-profile-'))
  const home = await mkdtemp(join(tmpdir(), 'dsh-preset-home-'))
  roots.push(install, profile, home)
  await mkdir(join(install, 'node_modules', '@example', 'test-bundle'), { recursive: true })
  await writeFile(join(install, 'package.json'), JSON.stringify({
    name: 'dsh-test-install', version: '1.0.0', dependencies: { '@example/test-bundle': '1.0.0' },
  }))
  await writeFile(join(install, 'node_modules', '@example', 'test-bundle', 'package.json'), JSON.stringify({
    name: '@example/test-bundle', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  const rows = options.rows ?? [{
    id: 'compaction', name: 'cordis:group', group: true,
    isolate: { testCompactionEngine: true },
    config: [{ id: 'compaction-basic', name: BASIC }],
  }]
  await writeFile(join(install, 'node_modules', '@example', 'test-bundle', 'cordis.patch.yml'), dump([
    {
      insert: [
        { id: 'agent-presets', name: '@deepseek-ai/dsh-agent-preset-registry', config: { default: 'standard' } },
        { id: 'preset-standard', name: '@deepseek-ai/dsh-agent-preset', config: { id: 'standard', plugins: rows } },
        ...options.node === true ? [{ id: 'context-node', name: '@example/context-engine' }] : [],
        ...options.manager === true ? [{ id: 'context-manager', name: '@example/context-manager', disabled: true }] : [],
        ...options.secondPreset === true ? [{ id: 'preset-ptc', name: '@deepseek-ai/dsh-agent-preset', config: {
          id: 'ptc',
          plugins: [{
            id: 'ptc-compaction', name: 'cordis:group', group: true, isolate: { testCompactionEngine: true },
            config: [{ id: 'ptc-basic', name: BASIC }],
          }],
        } }] : [],
        // Independent Host rows of the same module, each in its own realm so
        // both really mount instead of fighting over one service.
        ...Array.from({ length: options.inspectors ?? 0 }, (_, index) => ({
          id: `inspector-${String(index)}`, name: 'cordis:group', group: true,
          isolate: { testCompactCommand: true },
          config: [{ id: `inspector-row-${String(index)}`, name: '@example/compaction-inspector' }],
        })),
      ],
    },
    ...options.provider === undefined ? [] : [{ id: 'preset-standard', compactionProvider: options.provider }],
  ], { lineWidth: -1 }))
  await writeFile(join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-test', private: true, dsh: { profile: { bundles: ['@example/test-bundle'] } },
  }))
  if (options.userPatch !== undefined) {
    await writeFile(join(profile, 'cordis.patch.yml'), dump(options.userPatch, { lineWidth: -1 }))
  }
  profileContext = {
    name: 'test', dir: profile, patchPath: join(profile, 'cordis.patch.yml'),
    installAnchor: join(install, 'package.json'), cwd: profile, home,
    startedBundles: ['@example/test-bundle'], overlays: [], telemetryDisabledEnv: undefined,
  }
  profileLayers = readProfilePatchLayers('dsh', profileContext)
  applyProfileComposition(profileContext, profileLayers)
}

describe('compaction host registrations', () => {
  it('serves a registration to the bindings made after it, and reports the real owners', async () => {
    const activated: string[] = []
    await trustedProfile()
    const ctx = await boot([], activated, profileLayers.flatMap(layer => layer.patches))
    // The declared composition mounted first, before anything registered.
    expect(activated).toEqual([BASIC])
    const owner = await ownerContext(ctx)
    const registration = await ctx.agentPresets.compactionHost.register(owner, {
      origin: 'desk-context', revision: 'r1', module: ENGINE, presets: ['standard'],
    })
    expect(registration.revision).toBe('r1')
    expect(activated).toEqual([BASIC, ENGINE])

    const scope = createScope(ctx, {})
    try {
      await ctx.agentPresets.mount(scope.ctx, 'standard')
      const binding = ctx.agentPresets.compactionHost.bindingFor(scope.ctx)
      expect(binding?.compactionProvider).toBe(ENGINE)
      expect(binding?.compactionSource).toBe('registration')
      expect(binding?.registrationOrigin).toBe('desk-context')
      expect(binding?.registrationRevision).toBe('r1')
      expect(binding?.owner).toBe('preset-standard')
      expect(binding?.ownerAlive).toBe(true)
      expect(binding?.available).toBe(true)
      expect(binding?.selectable).toBe(true)

      // Unloading the registering plugin leaves the bound revision in place but
      // reports it unavailable, instead of claiming Basic took over.
      await owner.fiber.dispose()
      const after = ctx.agentPresets.compactionHost.bindingFor(scope.ctx)
      expect(after?.compactionProvider).toBe(ENGINE)
      expect(after?.ownerAlive).toBe(false)
      expect(after?.available).toBe(false)
      expect(after?.selectable).toBe(false)
    } finally {
      await scope.dispose()
    }
  })

  it('returns future bindings to the declaration after a revoke', async () => {
    const activated: string[] = []
    await trustedProfile()
    const ctx = await boot([], activated, profileLayers.flatMap(layer => layer.patches))
    const owner = await ownerContext(ctx)
    const registration = await ctx.agentPresets.compactionHost.register(owner, {
      origin: 'desk-context', revision: 'r1', module: ENGINE, presets: ['standard'],
    })
    const bound = createScope(ctx, {})
    const fresh = createScope(ctx, {})
    try {
      await ctx.agentPresets.mount(bound.ctx, 'standard')
      expect(ctx.agentPresets.compactionHost.bindingFor(bound.ctx)?.compactionProvider).toBe(ENGINE)
      await registration.revoke()
      await ctx.agentPresets.mount(fresh.ctx, 'standard')
      // The revision bound before the revoke keeps its provider; the next
      // binding selects the declaration again.
      expect(ctx.agentPresets.compactionHost.bindingFor(fresh.ctx)?.compactionProvider).toBe(BASIC)
      expect(ctx.agentPresets.compactionHost.bindingFor(fresh.ctx)?.compactionSource).toBe('declaration')
      expect(ctx.agentPresets.compactionHost.bindingFor(bound.ctx)?.compactionProvider).toBe(ENGINE)
    } finally {
      await bound.dispose()
      await fresh.dispose()
    }
  })

  it('refuses a competing registration and keeps the live one serving', async () => {
    const activated: string[] = []
    await trustedProfile()
    const ctx = await boot([], activated, profileLayers.flatMap(layer => layer.patches))
    const first = await ownerContext(ctx)
    await ctx.agentPresets.compactionHost.register(first, {
      origin: 'desk-context', revision: 'r1', module: ENGINE, presets: ['standard'],
    })
    const second = await ownerContext(ctx)
    await expect(ctx.agentPresets.compactionHost.register(second, {
      origin: 'other-context', revision: 'r1', module: INSPECTOR, presets: ['standard'],
    })).rejects.toThrow(/already registered/u)
    expect(ctx.agentPresets.compactionHost.selected?.origin).toBe('desk-context')
    const scope = createScope(ctx, {})
    try {
      await ctx.agentPresets.mount(scope.ctx, 'standard')
      expect(ctx.agentPresets.compactionHost.bindingFor(scope.ctx)?.compactionProvider).toBe(ENGINE)
    } finally {
      await scope.dispose()
    }
  })

  it('holds a binding of a revision published while a related change applies', async () => {
    const activated: string[] = []
    await trustedProfile()
    const ctx = await boot([], activated, profileLayers.flatMap(layer => layer.patches))
    const owner = await ownerContext(ctx)
    await ctx.agentPresets.compactionHost.register(owner, {
      origin: 'desk-context', revision: 'r1', module: ENGINE, presets: ['standard'],
    })
    const pending = createScope(ctx, {})
    let settled = false
    try {
      // The enhanced revision is retained with no users, so the change is
      // allowed and its barrier covers the revision published afterwards.
      await withCompositionOwners(ctx, {
        rows: [{ id: 'preset-standard' }], modules: [], operation: 'restart the declaration',
      }, async () => {
        const mounting = ctx.agentPresets.mount(pending.ctx, 'standard').then(() => { settled = true })
        await Promise.resolve()
        await Promise.resolve()
        expect(settled).toBe(false)
        expect(ctx.agentPresets.compactionHost.bindingFor(pending.ctx)).toBeUndefined()
        pendingMount = mounting
      }, 'dsh')
      expect(settled).toBe(false)
      await pendingMount
      expect(settled).toBe(true)
    } finally {
      await pending.dispose()
    }

    // Negative control: a change that touches no real owner holds nothing.
    const unrelated = createScope(ctx, {})
    let committed = false
    try {
      await withCompositionOwners(ctx, {
        rows: [{ id: 'unrelated-config-row' }], modules: [], operation: 'unrelated configuration',
      }, async () => {
        await ctx.agentPresets.mount(unrelated.ctx, 'standard')
        committed = true
      }, 'dsh')
      expect(committed).toBe(true)
      expect(ctx.agentPresets.compactionHost.bindingFor(unrelated.ctx)?.compactionProvider).toBe(ENGINE)
    } finally {
      await unrelated.dispose()
    }
  })

  it('skips the enhancement when a second real provider already supplies compaction', async () => {
    const activated: string[] = []
    // Two real automatic providers, each in its own isolate realm, so both
    // publish the compaction service and the declaration genuinely holds a
    // competitor. The selected module is a third real provider.
    await trustedProfile({
      rows: [
        { id: 'basic-group', name: 'cordis:group', group: true, isolate: { testCompactionEngine: true }, config: [
          { id: 'compaction-basic', name: BASIC },
        ] },
        { id: 'context-group', name: 'cordis:group', group: true, isolate: { testCompactionEngine: true }, config: [
          { id: 'context-engine', name: ENGINE },
        ] },
      ],
    })
    const ctx = await boot([], activated, profileLayers.flatMap(layer => layer.patches))
    const owner = await ownerContext(ctx)
    await ctx.agentPresets.compactionHost.register(owner, {
      origin: 'desk-context', revision: 'r1', module: '@example/context-engine', presets: ['standard'],
    })
    const resolution = await ctx.agentPresets.resolve('standard')
    // Both declared providers mounted and really published the service; only
    // the identity rule refuses to add a third one.
    expect(activated).toEqual(expect.arrayContaining([BASIC, ENGINE]))
    expect(resolution.broken).toBeUndefined()
    expect(resolution.compaction?.state).toBe('skipped')
    expect(resolution.compaction?.reason).toBe(`competing compaction provider: ${ENGINE}`)
    const [preset] = await ctx.agentPresets.compositionInventory()
    expect(preset?.rows.map(row => row.moduleName)).toEqual([BASIC, ENGINE])
  })

  it('selects the provider when a lookalike sidecar publishes a different service', async () => {
    const activated: string[] = []
    // `@example/compaction-inspector` mentions compaction in its name but
    // publishes another service, so it is not a competitor and must not be
    // mistaken for one.
    await trustedProfile({
      rows: [
        { id: 'basic-group', name: 'cordis:group', group: true, isolate: { testCompactionEngine: true }, config: [
          { id: 'compaction-basic', name: BASIC },
        ] },
        { id: 'inspector-group', name: 'cordis:group', group: true, isolate: { testCompactCommand: true }, config: [
          { id: 'compaction-inspector', name: '@example/compaction-inspector' },
        ] },
      ],
    })
    const ctx = await boot([], activated, profileLayers.flatMap(layer => layer.patches))
    const owner = await ownerContext(ctx)
    await ctx.agentPresets.compactionHost.register(owner, {
      origin: 'desk-context', revision: 'r1', module: '@example/context-engine', presets: ['standard'],
    })
    const resolution = await ctx.agentPresets.resolve('standard')
    expect(resolution.broken).toBeUndefined()
    expect(resolution.compaction).toMatchObject({ state: 'substituted', provider: '@example/context-engine' })
    expect(activated).toContain('@example/context-engine')
  })

  it('keeps the declaration when a user layer overrides it with the same value', async () => {
    const activated: string[] = []
    // The user layer rewrites the very same value the trusted bundle declared,
    // and touches the group that contains the declaration.
    await trustedProfile({
      provider: ENGINE,
      rows: [{ id: 'compaction', name: 'cordis:group', group: true, isolate: { testCompactionEngine: true }, config: [
        { id: 'compaction-basic', name: BASIC },
      ] }],
      userPatch: [
        { id: 'preset-standard', compactionProvider: ENGINE },
        { id: 'compaction', config: [{ id: 'compaction-basic', name: BASIC }] },
      ],
    })
    const ctx = await boot([], activated, profileLayers.flatMap(layer => layer.patches))
    const resolution = await ctx.agentPresets.resolve('standard')
    // The patches still compose; only the enhancement is refused, so the
    // declared Basic rows stay in effect and the reason is reported.
    expect(resolution.broken).toBeUndefined()
    expect(resolution.compaction?.state).toBe('skipped')
    expect(resolution.compaction?.reason).toMatch(/profile layer/u)
    const [preset] = await ctx.agentPresets.compositionInventory()
    expect(preset?.rows.map(row => row.moduleName)).toEqual([BASIC])
    expect(activated).toEqual([BASIC])
  })

  it('discards a candidate superseded by a later registration from the same owner', async () => {
    const activated: string[] = []
    await trustedProfile()
    const ctx = await boot([], activated, profileLayers.flatMap(layer => layer.patches))
    const owner = await ownerContext(ctx)
    // Same owner, origin and module: the newer registration only advances the
    // revision, which version 1 allows in place.
    const late = ctx.agentPresets.compactionHost.register(owner, {
      origin: 'desk-context', revision: 'r1', module: ENGINE, presets: ['standard'],
    })
    const latest = ctx.agentPresets.compactionHost.register(owner, {
      origin: 'desk-context', revision: 'r2', module: ENGINE, presets: ['standard'],
    })
    await Promise.all([late, latest])
    const scope = createScope(ctx, {})
    try {
      await ctx.agentPresets.mount(scope.ctx, 'standard')
      const binding = ctx.agentPresets.compactionHost.bindingFor(scope.ctx)
      expect(binding?.compactionProvider).toBe(ENGINE)
      expect(binding?.registrationRevision).toBe('r2')
    } finally {
      await scope.dispose()
    }
  })

  it('keeps two runtimes apart: a registration in one never enhances the other', async () => {
    const firstActivated: string[] = []
    await trustedProfile()
    const first = await boot([], firstActivated, profileLayers.flatMap(layer => layer.patches))
    const firstLayers = profileLayers
    const firstProfile = profileContext
    const firstOwner = await ownerContext(first)
    await first.agentPresets.compactionHost.register(firstOwner, {
      origin: 'desk-context', revision: 'r1', module: ENGINE, presets: ['standard'],
    })
    // A second runtime with its own applied composition and its own registry.
    const secondActivated: string[] = []
    await trustedProfile()
    const second = await boot([], secondActivated, profileLayers.flatMap(layer => layer.patches))
    expect(profileContext).not.toBe(firstProfile)
    expect(profileLayers).not.toBe(firstLayers)
    expect(second.agentPresets.compactionHost.selected).toBeUndefined()
    const scope = createScope(second, {})
    const firstScope = createScope(first, {})
    try {
      await second.agentPresets.mount(scope.ctx, 'standard')
      await first.agentPresets.mount(firstScope.ctx, 'standard')
      expect(second.agentPresets.compactionHost.bindingFor(scope.ctx)?.compactionProvider).toBe(BASIC)
      expect(first.agentPresets.compactionHost.bindingFor(firstScope.ctx)?.compactionProvider).toBe(ENGINE)
    } finally {
      await scope.dispose()
      await firstScope.dispose()
    }
  })

  it('does not select a registration whose required Host nodes are missing or ambiguous', async () => {
    const activated: string[] = []
    await trustedProfile({ inspectors: 2 })
    const ctx = await boot([], activated, profileLayers.flatMap(layer => layer.patches))
    const owner = await ownerContext(ctx)

    // The provider does not inject the node itself, so nothing would be
    // pending; readiness still has to reject the selection.
    await ctx.agentPresets.compactionHost.register(owner, {
      origin: 'desk-context', revision: 'r1', module: ENGINE, presets: ['standard'],
      requires: [{ rowId: 'absent-node' }],
    })
    const missing = await ctx.agentPresets.resolve('standard')
    expect(missing.compaction?.state).toBe('skipped')
    expect(missing.compaction?.reason).toMatch(/required Host nodes are not available yet: absent-node/u)

    // Two independent Host rows of the same module live in this very tree,
    // each in its own isolate realm: the requirement is ambiguous, not missing.
    const inspectorFibers = [...ctx.loader.entries()]
      .filter(entry => entry.options.name === '@example/compaction-inspector')
      .map(entry => entry.fiber)
    expect(inspectorFibers).toHaveLength(2)
    expect(inspectorFibers.every(fiber => fiber !== undefined && fiber.state === FiberState.ACTIVE)).toBe(true)

    const ambiguous = await boot([], activated, [])
    void ambiguous
    await ctx.agentPresets.compactionHost.register(owner, {
      origin: 'desk-context', revision: 'r2', module: ENGINE, presets: ['standard'],
      requires: [{ module: '@example/compaction-inspector' }],
    })
    const ambiguousResolution = await ctx.agentPresets.resolve('standard')
    expect(ambiguousResolution.compaction?.state).toBe('skipped')
    expect(ambiguousResolution.compaction?.reason)
      .toMatch(/required Host nodes are not available yet: @example\/compaction-inspector/u)

    const scope = createScope(ctx, {})
    try {
      await ctx.agentPresets.mount(scope.ctx, 'standard')
      const binding = ctx.agentPresets.compactionHost.bindingFor(scope.ctx)
      // The declared revision is what the Agent binds; the ambiguous
      // requirement is never published as the future selection.
      expect(binding?.compactionProvider).toBe(BASIC)
      expect(binding?.compactionSource).toBe('declaration')
    } finally {
      await scope.dispose()
    }
  })

  it('never migrates an old revision onto a same-named replacement of its required node', async () => {
    const activated: string[] = []
    await trustedProfile({ node: true })
    const ctx = await boot([], activated, profileLayers.flatMap(layer => layer.patches))
    const owner = await ownerContext(ctx)
    await ctx.agentPresets.compactionHost.register(owner, {
      origin: 'desk-context', revision: 'r1', module: ENGINE, presets: ['standard'],
      requires: [{ rowId: 'context-node' }],
    })
    const node = [...ctx.loader.entries()].find(entry => entry.options.id === 'context-node')
    if (node === undefined) throw new Error('the required node row is missing')

    const bound = createScope(ctx, {})
    try {
      await ctx.agentPresets.mount(bound.ctx, 'standard')
      const captured = ctx.agentPresets.compactionHost.bindingFor(bound.ctx)
      expect(captured?.registrationOrigin).toBe('desk-context')
      expect(captured?.ownerAlive).toBe(true)

      // The fiber this revision captured is saved before the row is restarted:
      // the same Entry mounts a different fiber, which is a different owner.
      const oldFiber = node.fiber
      expect(oldFiber).toBeDefined()
      await node.update({ disabled: true })
      expect(oldFiber?.state).not.toBe(FiberState.ACTIVE)
      expect(ctx.agentPresets.compactionHost.bindingFor(bound.ctx)?.ownerAlive).toBe(false)
      await node.update({ disabled: false })
      const replacementFiber = [...ctx.loader.entries()].find(entry => entry.options.id === 'context-node')?.fiber
      expect(replacementFiber).toBeDefined()
      expect(replacementFiber).not.toBe(oldFiber)
      expect(ctx.agentPresets.compactionHost.bindingFor(bound.ctx)?.ownerAlive).toBe(false)
      expect(ctx.agentPresets.compactionHost.bindingFor(bound.ctx)?.available).toBe(false)

      // A new selection from the same owner captures the replacement and only
      // then serves a fresh binding.
      await ctx.agentPresets.compactionHost.register(owner, {
        origin: 'desk-context', revision: 'r2', module: ENGINE, presets: ['standard'],
        requires: [{ rowId: 'context-node' }],
      })
      const fresh = createScope(ctx, {})
      try {
        await ctx.agentPresets.mount(fresh.ctx, 'standard')
        expect(ctx.agentPresets.compactionHost.bindingFor(fresh.ctx)?.ownerAlive).toBe(true)
      } finally {
        await fresh.dispose()
      }
    } finally {
      await bound.dispose()
    }
  })

  it('refuses a change that names only the selected provider\u2019s own fiber', async () => {
    const activated: string[] = []
    await trustedProfile()
    const ctx = await boot([], activated, profileLayers.flatMap(layer => layer.patches))
    const owner = await ownerContext(ctx)
    await ctx.agentPresets.compactionHost.register(owner, {
      origin: 'desk-context', revision: 'r1', module: ENGINE, presets: ['standard'],
    })
    const providerFiber = moduleFibers.get(ENGINE)
    expect(providerFiber).toBeDefined()

    const scope = createScope(ctx, {})
    try {
      await ctx.agentPresets.mount(scope.ctx, 'standard')
      expect(ctx.agentPresets.compactionHost.bindingFor(scope.ctx)?.compactionProvider).toBe(ENGINE)
      // A code replacement that reaches only the provider fiber, with no row id
      // and no module, still touches a real owner of the retained revision, so
      // it is refused before the replacement runs.
      let replaced = false
      await expect(withCompositionOwners(ctx, {
        rows: [], modules: [], fibers: providerFiber === undefined ? [] : [providerFiber],
        operation: 'replace the provider module code',
      }, async () => { replaced = true; return 'replaced' }, 'dsh'))
        .rejects.toThrow(/needs a normal restart/u)
      expect(replaced).toBe(false)
      expect(ctx.agentPresets.compactionHost.bindingFor(scope.ctx)?.compactionProvider).toBe(ENGINE)
    } finally {
      await scope.dispose()
    }
  })

  it('leaves a preset the registration does not cover fully editable', async () => {
    const activated: string[] = []
    await trustedProfile({ secondPreset: true })
    const ctx = await boot([], activated, profileLayers.flatMap(layer => layer.patches))
    const owner = await ownerContext(ctx)
    // The registration selects only the standard preset, so ptc keeps the
    // declared bundled provider.
    await ctx.agentPresets.compactionHost.register(owner, {
      origin: 'desk-context', revision: 'r1', module: ENGINE, presets: ['standard'],
    })
    const standard = createScope(ctx, {})
    const ptc = createScope(ctx, {})
    try {
      await ctx.agentPresets.mount(standard.ctx, 'standard')
      await ctx.agentPresets.mount(ptc.ctx, 'ptc')
      const enhanced = ctx.agentPresets.compactionHost.bindingFor(standard.ctx)
      const native = ctx.agentPresets.compactionHost.bindingFor(ptc.ctx)
      expect(enhanced?.compactionSource).toBe('registration')
      expect(native?.compactionSource).toBe('declaration')
      expect(native?.compactionProvider).toBe(BASIC)

      // The ptc declaration is an ordinary composition owner: restarting it is
      // allowed and never becomes restart-required.
      const decision = await withCompositionOwners(ctx, {
        rows: [{ id: 'preset-ptc' }], modules: [], operation: 'edit an unenhanced preset',
      }, async () => 'restarted', 'dsh')
      expect(decision).toBe('restarted')
      // Both bindings keep the revision they hold, by identity.
      expect(ctx.agentPresets.compactionHost.bindingFor(standard.ctx)).toEqual(enhanced)
      expect(ctx.agentPresets.compactionHost.bindingFor(ptc.ctx)).toEqual(native)
    } finally {
      await standard.dispose()
      await ptc.dispose()
    }
  })

  it('keeps a Host with no registration on the existing composition semantics', async () => {
    const activated: string[] = []
    await trustedProfile({ secondPreset: true })
    const ctx = await boot([], activated, profileLayers.flatMap(layer => layer.patches))
    const scope = createScope(ctx, {})
    try {
      await ctx.agentPresets.mount(scope.ctx, 'standard')
      expect(ctx.agentPresets.compactionHost.selected).toBeUndefined()
      expect(ctx.agentPresets.compactionHost.bindingFor(scope.ctx)?.compactionSource).toBe('declaration')
      // Nothing registers, so an ordinary preset edit stays allowed.
      const decision = await withCompositionOwners(ctx, {
        rows: [{ id: 'preset-standard' }], modules: [], operation: 'edit a preset without any registration',
      }, async () => 'restarted', 'dsh')
      expect(decision).toBe('restarted')
    } finally {
      await scope.dispose()
    }
  })
  it('keeps serving a revoked revision to its Agent and refuses new bindings outright', async () => {
    const activated: string[] = []
    await trustedProfile()
    const ctx = await boot([], activated, profileLayers.flatMap(layer => layer.patches))
    const owner = await ownerContext(ctx)
    const registration = await ctx.agentPresets.compactionHost.register(owner, {
      origin: 'desk-context', revision: 'r1', module: ENGINE, presets: ['standard'],
    })
    const old = createScope(ctx, {})
    try {
      await ctx.agentPresets.mount(old.ctx, 'standard')
      const held = ctx.agentPresets.compactionHost.bindingFor(old.ctx)
      expect(held?.compactionProvider).toBe(ENGINE)
      expect(held?.available).toBe(true)
      expect(held?.selectable).toBe(true)

      // The bundled provider that the declaration names is still the real
      // module; it only stops starting from now on, so the failure lands on the
      // re-mount a withdrawal requires, not on the running provider. The switch
      // stays off until the new binding has actually been refused, so a healthy
      // Basic fallback cannot be what the assertions are reading.
      basicAvailable = false
      await registration.revoke()
      const revoked = ctx.agentPresets.compactionHost.bindingFor(old.ctx)
      expect(revoked?.compactionProvider).toBe(ENGINE)
      expect(revoked?.available).toBe(true)
      expect(revoked?.selectable).toBe(false)

      const fresh = createScope(ctx, {})
      try {
        await expect(ctx.agentPresets.mount(fresh.ctx, 'standard')).rejects.toThrow(/declared composition cannot be mounted/u)
      } finally {
        await fresh.dispose()
      }
      // The retained revision is untouched by the refusal.
      expect(ctx.agentPresets.compactionHost.bindingFor(old.ctx)?.available).toBe(true)
    } finally {
      // Only here is the bundled provider healthy again.
      basicAvailable = true
      await old.dispose()
    }
  })

  it('keeps a retained native Basic revision serving through an edit and a retirement', async () => {
    const activated: string[] = []
    await trustedProfile()
    const ctx = await boot([], activated, profileLayers.flatMap(layer => layer.patches))
    const old = createScope(ctx, {})
    try {
      await ctx.agentPresets.mount(old.ctx, 'standard')
      const before = ctx.agentPresets.compactionHost.bindingFor(old.ctx)
      expect(before?.compactionSource).toBe('declaration')
      // The mounted service is a Cordis proxy: a declared read-only field and
      // identity are compared explicitly, never deep-compared.
      const service = ctx.agentPresets.serviceFor({ ctx: old.ctx }, 'testCompactionEngine')
      expect(service?.provider === BASIC).toBe(true)

      // An ordinary configuration edit re-resolves the existing fiber instead of
      // mounting a new one, so identity here is unchanged by the Loader; what
      // the registry does is roll the revision that later bindings receive.
      const row = [...ctx.loader.entries()].find(entry => entry.options.id === 'preset-standard')
      if (row === undefined) throw new Error('the declaring row is missing')
      const declarationFiber = row.fiber
      const declared: unknown = row.options.config
      if (typeof declared !== 'object' || declared === null) throw new Error('the declaring row carries no object config')
      await row.update({ config: { ...declared, order: 2 } })
      await Promise.allSettled(declarationFiber === undefined ? [] : [declarationFiber.await()])
      await ctx.loader.await()
      expect(row.fiber === declarationFiber).toBe(true)

      const after = ctx.agentPresets.compactionHost.bindingFor(old.ctx)
      expect(after?.generation).toBe(before?.generation)
      expect(after?.available).toBe(true)
      const stillServing = ctx.agentPresets.serviceFor({ ctx: old.ctx }, 'testCompactionEngine')
      expect(stillServing === service).toBe(true)
      expect(stillServing?.provider === BASIC).toBe(true)

      const fresh = createScope(ctx, {})
      try {
        await ctx.agentPresets.mount(fresh.ctx, 'standard')
        const next = ctx.agentPresets.compactionHost.bindingFor(fresh.ctx)
        expect(next?.generation).not.toBe(before?.generation)
        expect(next?.compactionSource).toBe('declaration')
      } finally {
        await fresh.dispose()
      }

      // Retiring the declaration row unloads that fiber for real; the revision
      // this Agent already holds stays retained and keeps serving.
      await row.update({ disabled: true })
      await Promise.allSettled(declarationFiber === undefined ? [] : [declarationFiber.await()])
      await ctx.loader.await()
      expect(declarationFiber?.state === FiberState.ACTIVE).toBe(false)
      // A disabled row keeps its configuration; what changes is that it is
      // disabled and no longer has an active fiber.
      const retiredRow = [...ctx.loader.entries()].find(entry => entry.options.id === 'preset-standard')
      expect(retiredRow?.disabled === true).toBe(true)
      expect(retiredRow?.fiber?.state === FiberState.ACTIVE).toBe(false)

      const retired = ctx.agentPresets.compactionHost.bindingFor(old.ctx)
      expect(retired?.generation).toBe(before?.generation)
      expect(retired?.available).toBe(true)
      expect(retired?.ownerAlive).toBe(true)
      const surviving = ctx.agentPresets.serviceFor({ ctx: old.ctx }, 'testCompactionEngine')
      expect(surviving === service).toBe(true)
      expect(surviving?.provider === BASIC).toBe(true)
    } finally {
      await old.dispose()
    }
  })

  it('never blocks a Basic-only Host through an unbounded change', async () => {
    const activated: string[] = []
    await trustedProfile()
    const ctx = await boot([], activated, profileLayers.flatMap(layer => layer.patches))
    const scope = createScope(ctx, {})
    try {
      await ctx.agentPresets.mount(scope.ctx, 'standard')
      expect(ctx.agentPresets.compactionHost.selected).toBeUndefined()
      // An unknown-impact change stays conservative only about revisions a real
      // registration enhanced; this Host has none, so the ordinary path holds.
      let ran = false
      await withCompositionOwners(ctx, {
        rows: [], modules: [], unbounded: true, operation: 'unknown package impact',
      }, async () => { ran = true }, 'dsh')
      expect(ran).toBe(true)
      expect(ctx.agentPresets.compactionHost.bindingFor(scope.ctx)?.available).toBe(true)
    } finally {
      await scope.dispose()
    }
  })
  it('refuses new bindings when a same-value layer withdraws the voucher and the declaration cannot mount', async () => {
    const activated: string[] = []
    await trustedProfile()
    const ctx = await boot([], activated, profileLayers.flatMap(layer => layer.patches))
    const owner = await ownerContext(ctx)
    await ctx.agentPresets.compactionHost.register(owner, {
      origin: 'desk-context', revision: 'r1', module: ENGINE, presets: ['standard'],
    })
    const old = createScope(ctx, {})
    try {
      await ctx.agentPresets.mount(old.ctx, 'standard')
      const held = ctx.agentPresets.compactionHost.bindingFor(old.ctx)
      expect(held?.compactionSource).toBe('registration')
      expect(held?.selectable).toBe(true)

      // A user layer overrides the declaration with the same effective value:
      // the Entry and its configuration do not change, only the applied
      // composition stops vouching for the row.
      const profile = ctx.get('profileContext')
      if (profile === undefined) throw new Error('the profile context is missing')
      const overridden = readProfilePatchLayers('dsh', profile, {
        ...loadProfileDirectory('dsh', profile.dir, profile.installAnchor),
        patches: [{ id: 'preset-standard', compactionProvider: ENGINE }],
      })
      applyProfileComposition(profile, overridden)

      // The declaration still names the real bundled module, which only stops
      // starting now: the demotion a withdrawn voucher requires must fail.
      basicAvailable = false
      const fresh = createScope(ctx, {})
      try {
        await expect(ctx.agentPresets.mount(fresh.ctx, 'standard'))
          .rejects.toThrow(/declared composition cannot be mounted/u)
      } finally {
        await fresh.dispose()
      }

      const withdrawn = ctx.agentPresets.compactionHost.bindingFor(old.ctx)
      expect(withdrawn?.compactionProvider).toBe(ENGINE)
      expect(withdrawn?.available).toBe(true)
      expect(withdrawn?.selectable).toBe(false)
      // The refusal is recorded once; the revision is not retried away.
      expect(ctx.agentPresets.compactionHost.bindingFor(old.ctx)).toEqual(withdrawn)
    } finally {
      basicAvailable = true
      await old.dispose()
    }
  })
  /**
   * Hold one candidate's second tree settle, which is the await `mountAttempt`
   * performs after its early registration check. Every call still delegates to
   * the real implementation; only the armed tree's second await waits.
   */
  function armTreeGate(): { reached: Promise<void>; release: () => void; restore: () => void } {
    const descriptor = Object.getOwnPropertyDescriptor(EntryTree.prototype, 'await')
    if (descriptor === undefined || typeof descriptor.value !== 'function') {
      throw new Error('EntryTree.await is not a prototype method')
    }
    // The captured original is called with the real tree, never rebound.
    const original = descriptor.value as (this: EntryTree) => Promise<void>
    const reached = Promise.withResolvers<undefined>()
    const released = Promise.withResolvers<undefined>()
    const counts = new WeakMap<EntryTree, number>()
    const pinned: { tree?: EntryTree } = {}
    let armed = true
    EntryTree.prototype.await = async function gatedAwait(this: EntryTree): Promise<void> {
      const count = (counts.get(this) ?? 0) + 1
      counts.set(this, count)
      if (armed) {
        pinned.tree ??= this
        if (this === pinned.tree && count >= 2) {
          armed = false
          reached.resolve(undefined)
          await released.promise
        }
      }
      await original.call(this)
    }
    return {
      reached: reached.promise,
      release: () => { released.resolve(undefined) },
      restore: () => { EntryTree.prototype.await = original },
    }
  }

  it('never lets a late candidate overwrite a newer registration', async () => {
    const activated: string[] = []
    await trustedProfile()
    const ctx = await boot([], activated, profileLayers.flatMap(layer => layer.patches))
    const owner = await ownerContext(ctx)
    const gate = armTreeGate()
    let first: Promise<unknown> | undefined
    let second: Promise<unknown> | undefined
    try {
      first = ctx.agentPresets.compactionHost.register(owner, {
        origin: 'desk-context', revision: 'r1', module: ENGINE, presets: ['standard'],
      })
      // Reached inside the first candidate's post-check await.
      await gate.reached
      // The newer registration keeps the same owner, origin and module and only
      // advances the revision, which is what version 1 allows in place.
      second = ctx.agentPresets.compactionHost.register(owner, {
        origin: 'desk-context', revision: 'r2', module: ENGINE, presets: ['standard'],
      })
      await second
      gate.release()
      await first

      expect(ctx.agentPresets.compactionHost.selected?.revision).toBe('r2')
      const scope = createScope(ctx, {})
      try {
        await ctx.agentPresets.mount(scope.ctx, 'standard')
        const binding = ctx.agentPresets.compactionHost.bindingFor(scope.ctx)
        expect(binding?.compactionProvider).toBe(ENGINE)
        expect(binding?.registrationRevision).toBe('r2')
        expect(binding?.compactionSource).toBe('registration')
        const service = ctx.agentPresets.serviceFor({ ctx: scope.ctx }, 'testCompactionEngine')
        expect(service?.provider === ENGINE).toBe(true)
      } finally {
        await scope.dispose()
      }
    } finally {
      gate.release()
      await Promise.allSettled([first, second].filter((entry): entry is Promise<unknown> => entry !== undefined))
      gate.restore()
    }
  })

  it('never lets a late failing candidate overwrite a newer registration', async () => {
    const activated: string[] = []
    await trustedProfile()
    const ctx = await boot([], activated, profileLayers.flatMap(layer => layer.patches))
    const owner = await ownerContext(ctx)
    const gate = armTreeGate()
    let first: Promise<unknown> | undefined
    let second: Promise<unknown> | undefined
    try {
      // This provider injects a manager the composition never mounts, so its
      // readiness check fails only after the gated await and keeps failing.
      first = ctx.agentPresets.compactionHost.register(owner, {
        origin: 'desk-context', revision: 'r1', module: ENGINE, presets: ['standard'],
        requires: [{ module: '@example/compaction-inspector' }],
      })
      await gate.reached
      // The newer registration keeps the same identity and only drops the
      // requirement that can never be satisfied here.
      second = ctx.agentPresets.compactionHost.register(owner, {
        origin: 'desk-context', revision: 'r2', module: ENGINE, presets: ['standard'],
      })
      await second
      gate.release()
      await first

      expect(ctx.agentPresets.compactionHost.selected?.revision).toBe('r2')
      const resolved = await ctx.agentPresets.resolve('standard')
      expect(resolved.compaction).toMatchObject({ state: 'substituted', provider: ENGINE })
      const scope = createScope(ctx, {})
      try {
        await ctx.agentPresets.mount(scope.ctx, 'standard')
        const binding = ctx.agentPresets.compactionHost.bindingFor(scope.ctx)
        expect(binding?.compactionProvider).toBe(ENGINE)
        expect(binding?.registrationRevision).toBe('r2')
      } finally {
        await scope.dispose()
      }
    } finally {
      gate.release()
      await Promise.allSettled([first, second].filter((entry): entry is Promise<unknown> => entry !== undefined))
      gate.restore()
    }
  })

  it('stops an interleaved reselection from borrowing a newer registration', async () => {
    const activated: string[] = []
    await trustedProfile({ secondPreset: true })
    const ctx = await boot([], activated, profileLayers.flatMap(layer => layer.patches))
    const owner = await ownerContext(ctx)
    // The Agent bound before any registration holds the declared revision.
    const early = createScope(ctx, {})
    await ctx.agentPresets.mount(early.ctx, 'standard')
    const held = ctx.agentPresets.compactionHost.bindingFor(early.ctx)
    const heldService = ctx.agentPresets.serviceFor({ ctx: early.ctx }, 'testCompactionEngine')
    expect(held?.compactionSource).toBe('declaration')

    // Armed only now: the first tree this operation settles is its own candidate.
    const gate = armTreeGate()
    let first: Promise<unknown> | undefined
    let second: Promise<unknown> | undefined
    try {
      first = ctx.agentPresets.compactionHost.register(owner, {
        origin: 'desk-context', revision: 'r1', module: ENGINE, presets: ['standard', 'ptc'],
      })
      await gate.reached
      second = ctx.agentPresets.compactionHost.register(owner, {
        origin: 'desk-context', revision: 'r2', module: ENGINE, presets: ['standard', 'ptc'],
      })
      await second
      gate.release()
      await first

      const standard = createScope(ctx, {})
      const ptc = createScope(ctx, {})
      try {
        await ctx.agentPresets.mount(standard.ctx, 'standard')
        await ctx.agentPresets.mount(ptc.ctx, 'ptc')
        // Both presets read the newest allowed selection; the superseded
        // operation contributed nothing to the preset it had not reached.
        expect(ctx.agentPresets.compactionHost.bindingFor(standard.ctx)?.registrationRevision).toBe('r2')
        expect(ctx.agentPresets.compactionHost.bindingFor(ptc.ctx)?.registrationRevision).toBe('r2')
        expect(ctx.agentPresets.compactionHost.bindingFor(ptc.ctx)?.compactionSource).toBe('registration')
      } finally {
        await standard.dispose()
        await ptc.dispose()
      }

      // The Agent bound before keeps its own generation, provider and service,
      // while no longer being the revision future bindings select.
      const retired = ctx.agentPresets.compactionHost.bindingFor(early.ctx)
      expect(retired?.generation).toBe(held?.generation)
      expect(retired?.compactionProvider).toBe(held?.compactionProvider)
      expect(retired?.available).toBe(true)
      expect(retired?.selectable).toBe(false)
      expect(ctx.agentPresets.serviceFor({ ctx: early.ctx }, 'testCompactionEngine') === heldService).toBe(true)
    } finally {
      gate.release()
      await Promise.allSettled([first, second].filter((entry): entry is Promise<unknown> => entry !== undefined))
      gate.restore()
      await early.dispose()
    }
  })

  it('stops an interleaved withdrawal from demoting the remaining presets', async () => {
    const activated: string[] = []
    await trustedProfile({ secondPreset: true })
    const ctx = await boot([], activated, profileLayers.flatMap(layer => layer.patches))
    const owner = await ownerContext(ctx)
    const registration = await ctx.agentPresets.compactionHost.register(owner, {
      origin: 'desk-context', revision: 'r1', module: ENGINE, presets: ['standard', 'ptc'],
    })
    // Armed right before the withdrawal, so its first settled tree is the
    // declared revision it re-mounts for the first preset.
    const gate = armTreeGate()
    let withdrawing: Promise<unknown> | undefined
    let replacement: Promise<unknown> | undefined
    try {
      withdrawing = registration.revoke()
      await gate.reached
      // A same-origin registration takes over while the withdrawal is inside
      // its first demotion.
      replacement = ctx.agentPresets.compactionHost.register(owner, {
        origin: 'desk-context', revision: 'r2', module: ENGINE, presets: ['standard', 'ptc'],
      })
      await replacement
      gate.release()
      await withdrawing

      const standard = createScope(ctx, {})
      const ptc = createScope(ctx, {})
      try {
        await ctx.agentPresets.mount(standard.ctx, 'standard')
        await ctx.agentPresets.mount(ptc.ctx, 'ptc')
        // The withdrawal stopped at its first preset: neither future binding
        // was demoted under the new registration's authority.
        expect(ctx.agentPresets.compactionHost.bindingFor(standard.ctx)?.registrationRevision).toBe('r2')
        expect(ctx.agentPresets.compactionHost.bindingFor(ptc.ctx)?.registrationRevision).toBe('r2')
        expect(ctx.agentPresets.compactionHost.bindingFor(ptc.ctx)?.compactionSource).toBe('registration')
      } finally {
        await standard.dispose()
        await ptc.dispose()
      }
    } finally {
      gate.release()
      await Promise.allSettled([withdrawing, replacement].filter((entry): entry is Promise<unknown> => entry !== undefined))
      gate.restore()
    }
  })
  it('stops serving a preset the newest registration no longer selects', async () => {
    const activated: string[] = []
    await trustedProfile({ secondPreset: true })
    const ctx = await boot([], activated, profileLayers.flatMap(layer => layer.patches))
    const owner = await ownerContext(ctx)
    await ctx.agentPresets.compactionHost.register(owner, {
      origin: 'desk-context', revision: 'r1', module: ENGINE, presets: ['standard', 'ptc'],
    })
    const boundPtc = createScope(ctx, {})
    try {
      await ctx.agentPresets.mount(boundPtc.ctx, 'ptc')
      const heldPtc = ctx.agentPresets.compactionHost.bindingFor(boundPtc.ctx)
      expect(heldPtc?.compactionSource).toBe('registration')
      const heldService = ctx.agentPresets.serviceFor({ ctx: boundPtc.ctx }, 'testCompactionEngine')
      expect(heldService?.provider === ENGINE).toBe(true)

      // The same owner and origin register again with a narrower selection: ptc
      // is no longer covered, so its retained enhanced revision must not serve a
      // future binding, while standard keeps the newest one.
      await ctx.agentPresets.compactionHost.register(owner, {
        origin: 'desk-context', revision: 'r2', module: ENGINE, presets: ['standard'],
      })

      const standard = createScope(ctx, {})
      const ptc = createScope(ctx, {})
      try {
        await ctx.agentPresets.mount(standard.ctx, 'standard')
        expect(ctx.agentPresets.compactionHost.bindingFor(standard.ctx)?.registrationRevision).toBe('r2')
        await ctx.agentPresets.mount(ptc.ctx, 'ptc')
        const fresh = ctx.agentPresets.compactionHost.bindingFor(ptc.ctx)
        // The declared composition is what ptc receives now, not the revision
        // the wider selection had enhanced.
        expect(fresh?.compactionSource).toBe('declaration')
        expect(fresh?.compactionProvider).toBe(BASIC)
        expect(fresh?.registrationRevision).toBeUndefined()
      } finally {
        await standard.dispose()
        await ptc.dispose()
      }

      // The Agent bound before keeps the service it mounted.
      const afterPtc = ctx.agentPresets.compactionHost.bindingFor(boundPtc.ctx)
      expect(afterPtc?.generation).toBe(heldPtc?.generation)
      expect(afterPtc?.available).toBe(true)
      expect(afterPtc?.selectable).toBe(false)
      expect(ctx.agentPresets.serviceFor({ ctx: boundPtc.ctx }, 'testCompactionEngine') === heldService).toBe(true)
    } finally {
      await boundPtc.dispose()
    }
  })
  it('refuses a different origin or module from the same owner until the selection is revoked', async () => {
    const activated: string[] = []
    await trustedProfile()
    const ctx = await boot([], activated, profileLayers.flatMap(layer => layer.patches))
    const owner = await ownerContext(ctx)
    const first = await ctx.agentPresets.compactionHost.register(owner, {
      origin: 'desk-context', revision: 'r1', module: ENGINE, presets: ['standard'],
    })
    const scope = createScope(ctx, {})
    try {
      await ctx.agentPresets.mount(scope.ctx, 'standard')
      const bound = ctx.agentPresets.compactionHost.bindingFor(scope.ctx)
      const service = ctx.agentPresets.serviceFor({ ctx: scope.ctx }, 'testCompactionEngine')
      const activatedBefore = [...activated]

      // A different origin, and then a different module, from the same owner:
      // both are identity changes the live selection must reject.
      await expect(ctx.agentPresets.compactionHost.register(owner, {
        origin: 'other-context', revision: 'r2', module: ENGINE, presets: ['standard'],
      })).rejects.toThrow(/revoke it before registering a different owner, origin, or module/u)
      await expect(ctx.agentPresets.compactionHost.register(owner, {
        origin: 'desk-context', revision: 'r2', module: '@example/context-engine', presets: ['standard'],
      })).rejects.toThrow(/revoke it before registering a different owner, origin, or module/u)

      // The live selection, the binding and its service are untouched, and no
      // candidate of the rejected registrations ever activated.
      expect(ctx.agentPresets.compactionHost.selected).toBe(first)
      expect(ctx.agentPresets.compactionHost.bindingFor(scope.ctx)).toEqual(bound)
      expect(ctx.agentPresets.serviceFor({ ctx: scope.ctx }, 'testCompactionEngine') === service).toBe(true)
      expect(activated).toEqual(activatedBefore)

      // Revoking first makes the new identity legal.
      await first.revoke()
      const replacement = await ctx.agentPresets.compactionHost.register(owner, {
        origin: 'other-context', revision: 'r2', module: '@example/context-engine', presets: ['standard'],
      })
      expect(replacement.origin).toBe('other-context')
    } finally {
      await scope.dispose()
    }
  })

  it('reports the composition revision the successful attempt actually read', async () => {
    const activated: string[] = []
    await trustedProfile()
    const ctx = await boot([], activated, profileLayers.flatMap(layer => layer.patches))
    const profile = ctx.get('profileContext')
    if (profile === undefined) throw new Error('the profile context is missing')
    const owner = await ownerContext(ctx)
    await ctx.agentPresets.compactionHost.register(owner, {
      origin: 'desk-context', revision: 'r1', module: ENGINE, presets: ['standard'],
    })
    const before = profileCompositionRevision(profile)

    // A trusted recomposition that leaves the declaration's own configuration
    // untouched still advances the composition revision it was authorized under.
    const grown = readProfilePatchLayers('dsh', profile, {
      ...loadProfileDirectory('dsh', profile.dir, profile.installAnchor),
      patches: [{ insert: [{ id: 'extra-probe', name: '@example/compaction-inspector' }] }],
    })
    applyProfileComposition(profile, grown)
    const current = profileCompositionRevision(profile)
    expect(current).not.toBe(before)

    await ctx.agentPresets.compactionHost.register(owner, {
      origin: 'desk-context', revision: 'r2', module: ENGINE, presets: ['standard'],
    })
    const scope = createScope(ctx, {})
    try {
      await ctx.agentPresets.mount(scope.ctx, 'standard')
      const binding = ctx.agentPresets.compactionHost.bindingFor(scope.ctx)
      expect(binding?.registrationRevision).toBe('r2')
      // The origin revision is the one this attempt read, not the snapshot taken
      // when the declaration was created.
      const [composition] = await ctx.agentPresets.compositionInventory()
      expect(composition?.id).toBe('standard')
      const resolved = await ctx.agentPresets.resolve('standard')
      expect(resolved.compaction?.revision).toBe(current)
      expect(resolved.compaction?.state).toBe('substituted')
    } finally {
      await scope.dispose()
    }
  })
})
