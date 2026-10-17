/** Real HMR code replacement of a registering row against a retained preset revision. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { FiberState } from '@deepseek-ai/cordis'
import type { FSWatcher } from 'chokidar'
import { expect, it, onTestFinished, vi } from 'vitest'
import { createScope } from '@deepseek-ai/dsh-scope'
import { markerFile, ownerHmrFixture, ownerSource } from './owner-hmr.fixture.ts'

const watchers = vi.hoisted(() => [] as FSWatcher[])
vi.mock('chokidar', async (original) => {
  const native = await original<typeof import('chokidar')>()
  return { ...native, watch: () => {
    const watcher = new native.FSWatcher()
    watchers.push(watcher)
    queueMicrotask(() => watcher.emit('ready'))
    return watcher
  } }
})

/** The module watcher HMR opens for its configured root, after the profile config watchers. */
function moduleWatcher(): FSWatcher {
  const watcher = watchers.at(-1)
  if (watcher === undefined) throw new Error('HMR opened no watcher')
  return watcher
}

/**
 * One replacement round: rewrite the owner module, tell the real watcher, and
 * settle on HMR's own outcome - the reload announcement for a replacement, or
 * the logged restart-required error for a refusal.
 */
async function replaceOwner(
  f: Awaited<ReturnType<typeof ownerHmrFixture>>,
  source: string,
  outcome: 'refused' | 'replaced',
): Promise<string> {
  const listeners: (() => void)[] = []
  let released = false
  const release = (): void => {
    if (released) return
    released = true
    for (const dispose of listeners) dispose()
  }
  // A Vitest timeout does not unwind a pending promise, so the spy and the
  // event listener are also dropped when this test finishes, however it ends.
  onTestFinished(release)
  const refusal = new Promise<string>((resolve) => {
    const warn = f.ctx.logger.warn.bind(f.ctx.logger)
    const spy = vi.spyOn(f.ctx.logger, 'warn').mockImplementation((...args: Parameters<typeof f.ctx.logger.warn>) => {
      const error = args.find((arg): arg is Error => arg instanceof Error)
      if (error !== undefined && /needs a normal restart/u.test(error.message)) resolve(error.message)
      warn(...args)
    })
    listeners.push(() => { spy.mockRestore() })
  })
  const replacement = new Promise<string[]>((resolve) => {
    const off = f.ctx.on('hmr/reload', (reloads) => { resolve([...reloads.values()].map(row => row.filename)) })
    listeners.push(off)
  })
  try {
    writeFileSync(f.ownerModule, source)
    moduleWatcher().emit('change', f.ownerModule)
    // Both outcomes are real: a refusal settles through the HMR error log, a
    // replacement through the reload announcement. Whichever arrives proves
    // which path ran, so a surprise on either side fails with the real result.
    const settled = await Promise.race([refusal, replacement])
    if (typeof settled === 'string') {
      expect(outcome).toBe('refused')
      expect(settled).toMatch(/needs a normal restart/u)
      return settled
    }
    expect(outcome).toBe('replaced')
    // The announcement must carry this owner's own module, not just any event.
    expect(settled.includes(pathToFileURL(f.ownerModule).href), `${settled.join(', ')} ${diagnose(f)}`).toBe(true)
    // HMR also reloads entries and the Loader after announcing; drain both
    // before any result is read.
    await f.ctx.hmr.runExclusive(async () => {})
    await f.ctx.loader.await()
    return settled.join(', ')
  } finally {
    release()
  }
}

/** Bounded facts for a failing replacement assertion; never prints Cordis objects. */
function diagnose(f: Awaited<ReturnType<typeof ownerHmrFixture>>): string {
  const owner = [...f.ctx.loader.entries()].find(row => row.options.id === 'context-owner')
  return [
    `entry=${owner === undefined ? 'missing' : `state:${String(owner.fiber?.state)}`}`,
    `r1-applied=${String(existsSync(markerFile(f.ownerModule, 'owner-r1', 'applied')))}`,
    `r1-disposed=${String(existsSync(markerFile(f.ownerModule, 'owner-r1', 'disposed')))}`,
    `r2-applied=${String(existsSync(markerFile(f.ownerModule, 'owner-r2', 'applied')))}`,
    `r2-disposed=${String(existsSync(markerFile(f.ownerModule, 'owner-r2', 'disposed')))}`,
    `selected=${f.ctx.agentPresets.compactionHost.selected?.revision ?? 'none'}`,
    `retained=${String(f.ctx.agentPresets.compactionHost.retained().length)}`,
  ].join(' ')
}

it('refuses two identical replacements while the revision stays retained', async () => {
  const f = await ownerHmrFixture()
  const scope = createScope(f.ctx, {})
  try {
    await f.ctx.agentPresets.mount(scope.ctx, 'standard')
    const binding = f.ctx.agentPresets.compactionHost.bindingFor(scope.ctx)
    expect(binding?.compactionSource).toBe('registration')
    expect(binding?.registrationOrigin).toBe('hmr-test')
    expect(binding?.registrationRevision).toBe('r1')
    expect(binding?.compactionProvider).toBe('./engine.mjs')
    expect(binding?.ownerAlive).toBe(true)
    // The selected module really serves this Agent's engine.
    const service = f.ctx.agentPresets.serviceFor({ ctx: scope.ctx }, 'testCompactionEngine')
    expect(service?.provider).toBe('engine')
    const entry = [...f.ctx.loader.entries()].find(row => row.options.id === 'context-owner')
    const runningFiber = entry?.fiber
    expect(runningFiber !== undefined).toBe(true)
    expect(existsSync(markerFile(f.ownerModule, 'owner-r1', 'applied'))).toBe(true)
    expect(existsSync(markerFile(f.ownerModule, 'owner-r1', 'disposed'))).toBe(false)

    // A replacement only reaches HMR when the changed file is already in the
    // real Node cache, which is how the Loader loaded this row.
    const url = pathToFileURL(f.ownerModule).href
    const cache = f.ctx.loader.internal?.loadCache
    expect(cache?.has(url)).toBe(true)
    const cached = cache?.get(url)
    const namespace = entry?.moduleNamespace

    const edited = ownerSource('r2', 'owner-r2')
    expect(await replaceOwner(f, edited, 'refused')).toMatch(/needs a normal restart/u)
    expect(await replaceOwner(f, edited, 'refused')).toMatch(/needs a normal restart/u)

    // Nothing of the retained revision was destroyed, and the replacement
    // module never ran.
    expect(entry?.fiber === runningFiber, diagnose(f)).toBe(true)
    expect(runningFiber?.state === FiberState.ACTIVE, diagnose(f)).toBe(true)
    expect(existsSync(markerFile(f.ownerModule, 'owner-r2', 'applied')), diagnose(f)).toBe(false)
    expect(existsSync(markerFile(f.ownerModule, 'owner-r1', 'disposed')), diagnose(f)).toBe(false)
    expect(f.ctx.agentPresets.compactionHost.bindingFor(scope.ctx)?.generation).toBe(binding?.generation)
    expect(f.ctx.agentPresets.serviceFor({ ctx: scope.ctx }, 'testCompactionEngine') === service).toBe(true)
    // The cache still holds the entry the Loader loaded, the entry still
    // exposes the running namespace, and the user's edit stays on disk.
    expect(cache?.has(url)).toBe(true)
    expect(cache?.get(url) === cached).toBe(true)
    expect(entry?.moduleNamespace === namespace).toBe(true)
    expect(readFileSync(f.ownerModule, 'utf8')).toBe(edited)
    expect(readFileSync(f.profile.patchPath, 'utf8')).toBe(f.patchBytes)
  } finally {
    await scope.dispose()
  }
})

it('really replaces the registering row once the Agent released it', async () => {
  const f = await ownerHmrFixture()
  const scope = createScope(f.ctx, {})
  try {
    await f.ctx.agentPresets.mount(scope.ctx, 'standard')
    expect(f.ctx.agentPresets.compactionHost.bindingFor(scope.ctx)?.compactionSource).toBe('registration')
  } finally {
    // The Agent releases the revision, so no retained binding protects it.
    await scope.dispose()
  }

  const url = pathToFileURL(f.ownerModule).href
  expect(f.ctx.loader.internal?.loadCache.has(url)).toBe(true)
  await replaceOwner(f, ownerSource('r2', 'owner-r2'), 'replaced')

  expect(existsSync(markerFile(f.ownerModule, 'owner-r2', 'applied')), diagnose(f)).toBe(true)
  expect(existsSync(markerFile(f.ownerModule, 'owner-r1', 'disposed')), diagnose(f)).toBe(true)
  expect(f.ctx.agentPresets.compactionHost.selected?.revision).toBe('r2')

  const fresh = createScope(f.ctx, {})
  try {
    await f.ctx.agentPresets.mount(fresh.ctx, 'standard')
    const binding = f.ctx.agentPresets.compactionHost.bindingFor(fresh.ctx)
    expect(binding?.compactionSource).toBe('registration')
    expect(binding?.registrationRevision).toBe('r2')
    expect(binding?.compactionProvider).toBe('./engine.mjs')
    const service = f.ctx.agentPresets.serviceFor({ ctx: fresh.ctx }, 'testCompactionEngine')
    expect(service?.provider).toBe('engine')
  } finally {
    await fresh.dispose()
  }
})
