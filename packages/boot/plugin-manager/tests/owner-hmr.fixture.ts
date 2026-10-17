/** A real profile whose installation carries the bundle that declares the preset and registers a provider. */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import {
  boot, initProfile, loadProfileDirectory, readProfilePatchLayers, applyProfileComposition,
  type ProfileContext, type ProfilePatchLayer,
} from '@deepseek-ai/dsh-app-boot'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import AgentPreset from '@deepseek-ai/dsh-agent-preset'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import Hmr from '@deepseek-ai/dsh-hmr'

/** The bundled provider the declaration names; the registration selects `./engine.mjs` instead. */
export const BASIC_MODULE = '@deepseek-ai/dsh-compaction-basic'

/** The provider module the registration selects, relative to the composition base. */
export const ENGINE_MODULE = './engine.mjs'

/**
 * Resolve the test's own bare module to the shipped plugin, delegating every
 * other specifier to the Loader's original importer.
 */
export function mapBareImports(ctx: Context, modules: ReadonlyMap<string, unknown>): void {
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

/** One real profile with a trusted declaration, a bundled provider, a registering row and HMR. */
export interface OwnerHmrFixture {
  readonly ctx: Context
  readonly dir: string
  readonly home: string
  readonly profile: ProfileContext
  readonly layers: readonly ProfilePatchLayer[]
  readonly ownerModule: string
  readonly patchBytes: string
}

/**
 * Boot the real composition: the installation anchor declares the bundle, the
 * bundle carries the preset declaration, the bundled provider and the owner row
 * whose code HMR is asked to replace, and HMR watches the temporary tree.
 */
export async function ownerHmrFixture(): Promise<OwnerHmrFixture> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-hmr-owner-')))
  const dir = join(home, 'profiles', 'test')
  const lifecycle: { ctx?: Context } = {}
  onTestFinished(async () => {
    try {
      await lifecycle.ctx?.fiber.dispose()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
  initProfile(dir, ['test-context-bundle'])
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const basic = join(dir, 'node_modules', '@deepseek-ai', 'dsh-compaction-basic')
  mkdirSync(basic, { recursive: true })
  writeFileSync(join(basic, 'package.json'), JSON.stringify({
    name: BASIC_MODULE, version: '1.0.0', exports: './index.mjs',
  }))
  writeFileSync(join(basic, 'index.mjs'), 'export function apply(ctx) { ctx.provide("testCompactionEngine", { provider: "basic" }) }\n')
  writeFileSync(join(dir, 'engine.mjs'), 'export function apply(ctx) { ctx.provide("testCompactionEngine", { provider: "engine" }) }\n')
  const ownerModule = join(home, 'owner-code', 'owner.mjs')
  mkdirSync(dirname(ownerModule), { recursive: true })
  writeFileSync(ownerModule, ownerSource('r1', 'owner-r1'))
  const ownerUrl = pathToFileURL(ownerModule).href
  const bundle = join(home, 'node_modules', 'test-context-bundle')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({
    name: 'test-context-bundle', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  writeFileSync(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'timer', name: 'cordis:timer' },
    { id: 'hmr', name: 'cordis:hmr', config: { root: [home], ignored: [], debounce: 0 } },
    { id: 'preset-standard', name: '@deepseek-ai/dsh-agent-preset', config: {
      id: 'standard',
      plugins: [{
        id: 'compaction', name: 'cordis:group', group: true, isolate: { testCompactionEngine: true },
        config: [{ id: 'compaction-basic', name: BASIC_MODULE }],
      }],
    } },
    { id: 'context-owner', name: ownerUrl },
  ] }]))
  writeFileSync(join(home, 'package.json'), JSON.stringify({
    name: 'test-installation', dependencies: { 'test-context-bundle': '1.0.0' },
  }))
  const profile: ProfileContext = {
    name: 'test', startedBundles: ['test-context-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined,
  }
  const layers = readProfilePatchLayers('test', profile, loadProfileDirectory('test', dir, profile.installAnchor))
  lifecycle.ctx = await boot('test', join(dir, 'cordis.yml'), layers.flatMap(layer => layer.patches), async (host) => {
    mapBareImports(host, new Map([['@deepseek-ai/dsh-agent-preset', { default: AgentPreset }]]))
    host.loader.builtins.timer = Timer
    host.loader.builtins.hmr = Hmr
    await host.plugin(SessionProjectionRegistry)
    await host.plugin(AgentPresets, { default: 'standard' })
    applyProfileComposition(profile, layers)
    host.provide('profileContext', profile)
    // Profile HMR refuses to start without an application readiness signal.
    host.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
  })
  const ctx = lifecycle.ctx
  if (ctx === undefined) throw new Error('the fixture booted no runtime')
  return {
    ctx, dir, home, profile, layers, ownerModule,
    patchBytes: readFileSync(profile.patchPath, 'utf8'),
  }
}

/**
 * One owner module revision: it registers the provider and records its own
 * lifecycle in marker files beside the module, whose absolute paths the spec
 * asserts on.
 */
export function ownerSource(revision: string, marker: string): string {
  return [
    "import { writeFileSync } from 'node:fs'",
    "import { fileURLToPath } from 'node:url'",
    "import { join } from 'node:path'",
    '',
    `const MARKER = ${JSON.stringify(marker)}`,
    'const RECORD_DIR = fileURLToPath(new URL(".", import.meta.url))',
    'const record = (suffix) => { writeFileSync(join(RECORD_DIR, `${MARKER}-${suffix}.txt`), suffix) }',
    '',
    'export async function apply(ctx) {',
    "  await ctx.inject(['agentPresets'], async (scoped) => {",
    '    await scoped.agentPresets.compactionHost.register(scoped, {',
    `      origin: 'hmr-test', revision: ${JSON.stringify(revision)},`,
    "      module: './engine.mjs', presets: ['standard'],",
    '    })',
    '  })',
    "  record('applied')",
    "  ctx.effect(() => () => { record('disposed') })",
    '}',
    '',
  ].join('\n')
}

/** Absolute path of one marker a generated owner module writes. */
export function markerFile(moduleFile: string, marker: string, suffix: 'applied' | 'disposed'): string {
  return join(dirname(moduleFile), `${marker}-${suffix}.txt`)
}
