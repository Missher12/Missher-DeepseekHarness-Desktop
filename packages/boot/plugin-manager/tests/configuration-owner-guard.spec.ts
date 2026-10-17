/** ConfigEditor writes against a retained, registration-enhanced preset revision. */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { onTestFinished, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { boot, initProfile, loadProfileDirectory, readProfilePatchLayers, applyProfileComposition, reconcileProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import AgentPreset from '@deepseek-ai/dsh-agent-preset'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { createScope } from '@deepseek-ai/dsh-scope'
import PluginManager from '@deepseek-ai/dsh-plugin-manager'
import { pluginEntryId } from '@deepseek-ai/dsh-host-plugin-inventory'

/**
 * A real profile whose installation carries the bundle that declares the
 * preset, so the declaration has a trusted composition origin, plus an owner
 * row that registers a provider through the Host capability and an Agent that
 * stays bound to the enhanced revision.
 */
async function ownerFixture() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'settings-owner-')))
  const dir = join(home, 'profiles', 'test')
  onTestFinished(() => { rmSync(home, { recursive: true, force: true }) })
  initProfile(dir, ['test-context-bundle'])
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  // The bundled provider the declaration asks for, and the module the
  // registration selects instead of it.
  const basic = join(dir, 'node_modules', '@deepseek-ai', 'dsh-compaction-basic')
  mkdirSync(basic, { recursive: true })
  writeFileSync(join(basic, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-compaction-basic', version: '1.0.0', exports: './index.mjs',
  }))
  writeFileSync(join(basic, 'index.mjs'), 'export function apply(ctx) { ctx.provide("testCompactionEngine", { provider: "basic" }) }\n')
  writeFileSync(join(dir, 'engine.mjs'), 'export function apply(ctx) { ctx.provide("testCompactionEngine", { provider: "engine" }) }\n')
  const bundle = join(home, 'node_modules', 'test-context-bundle')
  mkdirSync(bundle, { recursive: true })
  // An ordinary configuration row with no schema and no retained owner. The
  // patch names it relatively, so it lives beside the patch file it is written
  // in, exactly where the resolver looks for it.
  writeFileSync(join(bundle, 'probe.mjs'), 'export function apply(ctx, config) { ctx.provide("plainProbe", config?.note ?? null) }\n')
  // The node the retained revision declares it needs: its effect disposer can
  // be held open by a test, which is the window a reconcile must respect.
  writeFileSync(join(bundle, 'hold.mjs'), [
    'export function apply(ctx) {',
    '  ctx.effect(() => () => {',
    '    const gate = globalThis.__dshOwnerGate',
    '    if (gate === undefined) return undefined',
    '    gate.entered()',
    '    return gate.promise',
    "  }, 'hold-disposal')",
    '}',
    '',
  ].join('\n'))
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({
    name: 'test-context-bundle', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  writeFileSync(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'config-editor', name: 'cordis:editor' },
    { id: 'plugin-manager', name: 'cordis:manager' },
    { id: 'preset-standard', name: '@deepseek-ai/dsh-agent-preset', config: {
      id: 'standard',
      plugins: [{
        id: 'compaction', name: 'cordis:group', group: true, isolate: { testCompactionEngine: true },
        config: [{ id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' }],
      }],
    } },
    { id: 'context-owner', name: './owner.mjs' },
    { id: 'hold', name: './hold.mjs' },
    { id: 'probe', name: './probe.mjs', config: { note: 'original' } },
  ] }]))
  writeFileSync(join(bundle, 'owner.mjs'), [
    'export async function apply(ctx) {',
    "  await ctx.inject(['agentPresets'], async (child) => {",
    '    await child.agentPresets.compactionHost.register(child, {',
    "      origin: 'test-context', revision: 'r1',",
    "      module: './engine.mjs', presets: ['standard'], requires: [{ rowId: 'hold' }],",
    '    })',
    '  })',
    '}',
    '',
  ].join('\n'))
  writeFileSync(join(home, 'package.json'), JSON.stringify({
    name: 'test-installation', dependencies: { 'test-context-bundle': '1.0.0' },
  }))
  const profile: ProfileContext = {
    name: 'test', startedBundles: ['test-context-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined,
  }
  const start = async (): Promise<Context> => {
    const layers = readProfilePatchLayers('test', profile, loadProfileDirectory('test', dir, profile.installAnchor))
    const ctx = await boot('test', join(dir, 'cordis.yml'), layers.flatMap(layer => layer.patches), async (host) => {
      mapBareImports(host, new Map([['@deepseek-ai/dsh-agent-preset', { default: AgentPreset }]]))
      await host.plugin(SessionProjectionRegistry)
      await host.plugin(AgentPresets, { default: 'standard' })
      // The composition the applier is about to mount, recorded as the launcher records it.
      applyProfileComposition(profile, layers)
      host.provide('profileContext', profile)
      host.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
      Object.assign(host.loader.builtins, { editor: ConfigEditor, manager: PluginManager })
    })
    onTestFinished(async () => { await ctx.fiber.dispose() })
    return ctx
  }
  const ctx = await start()
  const agent = createScope(ctx, {})
  await ctx.agentPresets.mount(agent.ctx, 'standard')
  onTestFinished(async () => { await agent.dispose() })
  const binding = ctx.agentPresets.compactionHost.bindingFor(agent.ctx)
  const row = [...ctx.loader.entries()].find(entry => entry.options.id === 'preset-standard')
  if (row === undefined) throw new Error('the declaring row did not mount')
  return { ctx, dir, home, profile, agent, binding, row, start }
}

/** Resolve the test's own bare module to the shipped plugin, delegating everything else. */
function mapBareImports(ctx: Context, modules: ReadonlyMap<string, unknown>): void {
  const internal = ctx.loader.internal
  if (internal === undefined) throw new Error('the Loader exposes no internal importer')
  const original = internal.import.bind(internal)
  type Import = typeof internal.import
  const override = (specifier: string, parentURL: string, attributes: Parameters<Import>[2]): Promise<unknown> => {
    const module = modules.get(specifier)
    return module === undefined ? original(specifier, parentURL, attributes) : Promise.resolve(module)
  }
  ctx.loader.internal = Object.assign(Object.create(internal) as typeof internal, { import: override as Import })
}

declare global {
  /** Gate the hold row's real effect disposer waits on, set by a test and cleared in its finally. */
  var __dshOwnerGate: { entered: () => void; promise: Promise<void> } | undefined
}

/** Exact profile bytes one refused edit must leave untouched. */
function profileBytes(dir: string): string {
  return ['package.json', 'cordis.patch.yml', 'cordis.yml'].map((file) => {
    try { return `${file}:${readFileSync(join(dir, file), 'utf8')}` }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return `${file}:`
      throw error
    }
  }).join('\u0000')
}

/** The editable entry ConfigEditor addresses by its patch-local row id. */
function entryFor(ctx: Context, id: string) {
  const entry = ctx.configEditor.entries().find(candidate => candidate.options.id === id)
  if (entry === undefined) throw new Error(`the ${id} row is not editable`)
  return entry
}

it('refuses an ordinary edit of a retained owner config before writing', async () => {
  const f = await ownerFixture()
  expect(f.binding?.compactionSource).toBe('registration')
  expect(f.binding?.registrationOrigin).toBe('test-context')
  const before = profileBytes(f.dir)
  const fibers = new Map([...f.ctx.loader.entries()].map(entry => [entry.id, entry.fiber]))

  await expect(f.ctx.configEditor.edit(entryFor(f.ctx, 'preset-standard'), () => ({ id: 'standard', plugins: [] })))
    .rejects.toThrow(/needs a normal restart/u)

  expect(profileBytes(f.dir)).toBe(before)
  expect([...f.ctx.loader.entries()].map(entry => entry.id)).toEqual([...fibers.keys()])
  for (const [id, fiber] of fibers) {
    expect([...f.ctx.loader.entries()].find(entry => entry.id === id)?.fiber).toBe(fiber)
  }
  // The binding and the generation the Agent holds are unchanged.
  expect(f.ctx.agentPresets.compactionHost.bindingFor(f.agent.ctx)).toEqual(f.binding)
})

it('still saves an unrelated entry while the owner is retained', async () => {
  const f = await ownerFixture()
  const before = profileBytes(f.dir)
  // The probe row names no retained owner, so its own edit is an ordinary
  // configuration change and must still be saved.
  const entry = entryFor(f.ctx, 'probe')
  await f.ctx.configEditor.edit(entry, current => ({ ...current, note: 'saved' }))

  expect(profileBytes(f.dir)).not.toBe(before)
  expect(readFileSync(f.profile.patchPath, 'utf8')).toContain('saved')
  expect(f.ctx.get('plainProbe')).toBe('saved')
  expect(f.ctx.agentPresets.compactionHost.bindingFor(f.agent.ctx)).toEqual(f.binding)
})

it('keeps the user patch and refuses an override that changes nothing', async () => {
  const f = await ownerFixture()
  // A user/home layer overrides the declaration with the same effective value:
  // the patch composes as written, the Entry keeps its identity, and the
  // enhancement is no longer authorized for new bindings.
  const userLayer = [{ id: 'preset-standard', name: '@deepseek-ai/dsh-agent-preset', config: {
    id: 'standard',
    plugins: [{
      id: 'compaction', name: 'cordis:group', group: true, isolate: { testCompactionEngine: true },
      config: [{ id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' }],
    }],
  } }]
  writeFileSync(f.profile.patchPath, JSON.stringify(userLayer))
  const composed = readProfilePatchLayers('test', f.profile)
  // The real reconcile: the effective configuration is unchanged, so the Entry
  // and its fiber survive, while the applied composition no longer vouches for
  // the declaration.
  await reconcileProfilePatches(f.ctx, composed.flatMap(layer => layer.patches), 'test', [], composed)
  const sameEntry = [...f.ctx.loader.entries()].find(entry => entry.options.id === 'preset-standard')
  expect(sameEntry).toBe(f.row)
  expect(sameEntry?.fiber).toBe(f.row.fiber)
  expect(readFileSync(f.profile.patchPath, 'utf8')).toBe(JSON.stringify(userLayer))

  const fresh = createScope(f.ctx, {})
  try {
    await f.ctx.agentPresets.mount(fresh.ctx, 'standard')
    const binding = f.ctx.agentPresets.compactionHost.bindingFor(fresh.ctx)
    // New bindings lose the enhancement; the Agent bound before keeps its own.
    expect(binding?.compactionSource).toBe('declaration')
    expect(binding?.compactionProvider).toBe('@deepseek-ai/dsh-compaction-basic')
    expect(f.ctx.agentPresets.compactionHost.bindingFor(f.agent.ctx)?.compactionProvider).toBe('./engine.mjs')
  } finally {
    await fresh.dispose()
  }
})

it('refuses the first reconcile of an externally disabled owner', async () => {
  const f = await ownerFixture()
  // The user wrote the desired-disabled state outside the Host; the row is still
  // mounted in memory.
  const disabled = [{ id: 'preset-standard', disabled: true }]
  writeFileSync(f.profile.patchPath, JSON.stringify(disabled))
  const onDisk = readFileSync(f.profile.patchPath, 'utf8')

  const entry = entryFor(f.ctx, 'config-editor')
  await expect(f.ctx.configEditor.edit(entry, current => ({ ...current, marker: 'after' })))
    .rejects.toThrow()
  // The editor neither applies the external change nor overwrites the file.
  expect(readFileSync(f.profile.patchPath, 'utf8')).toBe(onDisk)
  expect(f.ctx.agentPresets.compactionHost.bindingFor(f.agent.ctx)).toEqual(f.binding)
})

it('refuses a PluginManager disable that precedes an equally protected save', async () => {
  const f = await ownerFixture()
  const before = profileBytes(f.dir)
  const manager = f.ctx.pluginManager
  const row = [...f.ctx.loader.entries()].find(entry => entry.options.id === 'preset-standard')
  if (row === undefined) throw new Error('the declaring row did not mount')

  // Without HMR the management write is the only way this disable could land,
  // and the retained owner refuses it before the patch is touched.
  const disabled = await manager.setPluginEnabled(pluginEntryId(row.id), false)
  expect(disabled.application).toBe('failed')
  expect(disabled.error?.diagnostic).toMatch(/needs a normal restart/u)
  expect(profileBytes(f.dir)).toBe(before)

  // The following save is protected by the same boundary and changes nothing.
  const entry = entryFor(f.ctx, 'preset-standard')
  await expect(f.ctx.configEditor.edit(entry, current => ({ ...current, marker: 'after-disable' })))
    .rejects.toThrow(/needs a normal restart/u)
  expect(profileBytes(f.dir)).toBe(before)
  expect(f.ctx.agentPresets.compactionHost.bindingFor(f.agent.ctx)).toEqual(f.binding)
})

it('holds a new binding until the direct reconcile that retires a required owner settles', async () => {
  const f = await ownerFixture()
  const enhanced = f.ctx.agentPresets.compactionHost.bindingFor(f.agent.ctx)
  expect(enhanced?.compactionSource).toBe('registration')
  expect(enhanced?.ownerAlive).toBe(true)
  // Zero users, so the change is allowed; the revision stays retained.
  await f.agent.dispose()

  const entered = Promise.withResolvers<undefined>()
  const released = Promise.withResolvers<undefined>()
  const previousGate = globalThis.__dshOwnerGate
  // The profile patch as the initialization wrote it, comments included.
  const patchBytes = readFileSync(f.profile.patchPath, 'utf8')
  globalThis.__dshOwnerGate = { entered: () => { entered.resolve(undefined) }, promise: released.promise }
  let mounting: Promise<unknown> | undefined
  let reconciling: Promise<unknown> | undefined
  const fresh = createScope(f.ctx, {})
  try {
    const patches = readProfilePatchLayers('test', f.profile).flatMap(layer => layer.patches)
    // The documented formal entry: a real reconcile that disables the node the
    // retained revision declared it needs.
    reconciling = reconcileProfilePatches(f.ctx, [...patches, { id: 'hold', disabled: true }], 'test', [], undefined)
    // The real effect disposer of that node is now waiting: `entry.update` has
    // returned while the teardown is unfinished.
    await entered.promise

    let settled = false
    let refused: unknown
    mounting = f.ctx.agentPresets.mount(fresh.ctx, 'standard')
      .then(() => { settled = true })
      .catch((error: unknown) => { refused = error })
    await Promise.resolve()
    await Promise.resolve()
    // A new binding must not attach to the revision whose owner is still being
    // torn down, nor to the abandoned one.
    expect(settled).toBe(false)
    expect(f.ctx.agentPresets.compactionHost.bindingFor(fresh.ctx)).toBeUndefined()

    released.resolve(undefined)
    await reconciling
    await mounting
    expect(settled).toBe(false)
    // The retained revision is observed where it really is: the registry's own
    // retained list, since the Agent that held it was disposed on purpose.
    const retained = f.ctx.agentPresets.compactionHost.retained()
      .find(entry => entry.agentPreset === 'standard')
    expect(retained?.generation).toBe(enhanced?.generation)
    expect(retained?.available).toBe(false)
    expect(retained?.selectable).toBe(false)
    // No new binding exists and nothing claims the declared composition took
    // over for a preset whose required node was retired.
    expect(f.ctx.agentPresets.compactionHost.bindingFor(fresh.ctx)).toBeUndefined()
    // The refusal is specific: the enhanced revision has a real owner that
    // stopped serving, and no Basic takeover is claimed for it.
    expect(refused instanceof Error).toBe(true)
    expect(refused instanceof Error ? refused.message : '').toMatch(/no longer serviceable/u)
    // The reconcile applies in memory only: the file is byte-identical to what
    // the operation started with, whatever the initialization template holds.
    expect(readFileSync(f.profile.patchPath, 'utf8')).toBe(patchBytes)
  } finally {
    released.resolve(undefined)
    await Promise.allSettled([reconciling, mounting]
      .filter((entry): entry is Promise<unknown> => entry !== undefined))
    // The global is restored to what it was, not blindly cleared.
    globalThis.__dshOwnerGate = previousGate
    await fresh.dispose()
  }
})

it('lets an unrelated reconcile settle while the same owner stays retained', async () => {
  const f = await ownerFixture()
  const before = profileBytes(f.dir)
  const patches = readProfilePatchLayers('test', f.profile).flatMap(layer => layer.patches)
  await reconcileProfilePatches(f.ctx, [...patches, { id: 'probe', disabled: true }], 'test', [], undefined)
  // The unrelated change is applied without touching the retained revision.
  const binding = f.ctx.agentPresets.compactionHost.bindingFor(f.agent.ctx)
  expect(binding?.compactionSource).toBe('registration')
  expect(binding?.available).toBe(true)
  expect(profileBytes(f.dir)).toBe(before)
})

it('refuses the same reconcile before mutating while an Agent still holds the revision', async () => {
  const f = await ownerFixture()
  const before = profileBytes(f.dir)
  const fibers = new Map([...f.ctx.loader.entries()].map(entry => [entry.id, entry.fiber]))
  const patches = readProfilePatchLayers('test', f.profile).flatMap(layer => layer.patches)
  await expect(reconcileProfilePatches(f.ctx, [...patches, { id: 'hold', disabled: true }], 'test', [], undefined))
    .rejects.toThrow(/needs a normal restart/u)
  expect(profileBytes(f.dir)).toBe(before)
  for (const [id, fiber] of fibers) {
    expect([...f.ctx.loader.entries()].find(entry => entry.id === id)?.fiber).toBe(fiber)
  }
  const binding = f.ctx.agentPresets.compactionHost.bindingFor(f.agent.ctx)
  expect(binding?.available).toBe(true)
})
