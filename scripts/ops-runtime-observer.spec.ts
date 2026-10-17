/**
 * Contract tests for the read-only profile observer, on synthetic checkout and
 * profile trees. They prove the fail-closed decisions; they are not Windows
 * evidence and never load a real profile.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { inspectRuntime } from './ops-runtime-observer.mjs'
import { overlayDocument } from './ops-runtime-observer-overlay.mjs'

const roots: string[] = []
afterAll(() => {
  for (const root of roots.splice(0).reverse()) rmSync(root, { recursive: true, force: true })
})

/** One package directory with a manifest and one entry file. */
function pkg(root: string, name: string, relativeEntry: string): string {
  const dir = join(root, name)
  mkdirSync(dirname(join(dir, relativeEntry)), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, exports: { './package.json': './package.json', '.': `./${relativeEntry}` } }))
  writeFileSync(join(dir, relativeEntry), `export const marker = ${JSON.stringify(name)}\n`)
  return dir
}

/** Synthetic checkout matching the expected realpaths. */
function checkout(): string {
  const root = mkdtempSync(join(tmpdir(), 'obs-checkout-'))
  roots.push(root)
  pkg(join(root, 'apps'), 'cli', 'lib/bin.js')
  pkg(join(root, 'vendor'), 'cordis', 'lib/index.js')
  pkg(join(root, 'packages', 'sandbox'), 'sandbox-local', 'lib/index.js')
  pkg(join(root, 'packages', 'subprocess'), 'subprocess-local', 'lib/index.js')
  const acl = join(root, 'packages', 'sandbox', 'sandbox-windows-acl')
  mkdirSync(join(acl, 'lib'), { recursive: true })
  writeFileSync(join(acl, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-sandbox-windows-acl',
    exports: { '.': './lib/index.js', './runner': './lib/runner.js', './package.json': './package.json' },
  }))
  writeFileSync(join(acl, 'lib', 'index.js'), 'export const marker = "acl"\n')
  writeFileSync(join(acl, 'lib', 'runner.js'), 'export const marker = "acl-runner"\n')
  return root
}

/** A profile that resolves the checkout packages from its own node_modules. */
function profile(root: string): { dir: string; installAnchor: string } {
  const dir = mkdtempSync(join(tmpdir(), 'obs-profile-'))
  roots.push(dir)
  const modules = join(dir, 'node_modules', '@deepseek-ai')
  mkdirSync(modules, { recursive: true })
  symlinkSync(join(root, 'vendor', 'cordis'), join(modules, 'cordis'))
  symlinkSync(join(root, 'packages', 'sandbox', 'sandbox-local'), join(modules, 'dsh-sandbox-local'))
  symlinkSync(join(root, 'packages', 'subprocess', 'subprocess-local'), join(modules, 'dsh-subprocess-local'))
  // sandbox-local's own dependency closure carries the Windows ACL package.
  const sandboxModules = join(root, 'packages', 'sandbox', 'sandbox-local', 'node_modules', '@deepseek-ai')
  mkdirSync(sandboxModules, { recursive: true })
  symlinkSync(join(root, 'packages', 'sandbox', 'sandbox-windows-acl'), join(sandboxModules, 'dsh-sandbox-windows-acl'))
  return { dir, installAnchor: join(root, 'apps', 'cli', 'package.json') }
}

/** Observer config for one synthetic run. */
const config = (root: string, outFile: string): { checkout: string; expectedHead: string; runNonce: string; outFile: string } =>
  ({ checkout: root, expectedHead: 'abcdef', runNonce: 'nonce-1', outFile })

describe('ops runtime observer', () => {
  it('accepts the profile that resolved the checkout chain and writes evidence', () => {
    const root = checkout()
    const context = profile(root)
    const outFile = join(context.dir, 'observer.json')
    const evidence = inspectRuntime(context, config(root, outFile))
    expect(evidence.failures).toEqual([])
    expect(evidence.ok).toBe(true)
    expect(evidence.hashes.aclRunner).toMatch(/^[0-9a-f]{64}$/u)
    const document = JSON.parse(readFileSync(outFile, 'utf8')) as { observations: { ok: boolean; pid: number }[] }
    expect(document.observations).toHaveLength(1)
    expect(document.observations[0]?.pid).toBe(process.pid)
    // The public report carries no synthetic absolute root.
    const text = readFileSync(outFile, 'utf8')
    expect(text.includes(root)).toBe(false)
    expect(text.includes(context.dir)).toBe(false)
  })

  it('rejects a profile-local old SDK that shadows the checkout chain', () => {
    const root = checkout()
    const other = checkout()
    const context = profile(root)
    const shadow = join(context.dir, 'node_modules', '@deepseek-ai', 'dsh-sandbox-local')
    rmSync(shadow, { recursive: true, force: true })
    symlinkSync(join(other, 'packages', 'sandbox', 'sandbox-local'), shadow)
    const evidence = inspectRuntime(context, config(root, join(context.dir, 'observer.json')))
    expect(evidence.ok).toBe(false)
    expect(evidence.failures.some(failure => failure.code === 'sandbox-local-not-from-checkout')).toBe(true)
  })

  it('rejects a missing built ACL runner and a wrong install anchor', () => {
    const root = checkout()
    const context = profile(root)
    rmSync(join(root, 'packages', 'sandbox', 'sandbox-windows-acl', 'lib', 'runner.js'))
    const unbuilt = inspectRuntime(context, config(root, join(context.dir, 'observer.json')))
    expect(unbuilt.ok).toBe(false)
    expect(unbuilt.failures.some(failure => failure.code === 'acl-runner-unbuilt')).toBe(true)

    const other = checkout()
    const wrong = { dir: context.dir, installAnchor: join(other, 'apps', 'cli', 'package.json') }
    const anchor = inspectRuntime(wrong, config(root, join(context.dir, 'observer.json')))
    expect(anchor.ok).toBe(false)
    expect(anchor.failures.some(failure => failure.code === 'install-anchor-mismatch')).toBe(true)
  })
})

describe('observer overlay', () => {
  it('generates a valid patch document without starting a Host', async () => {
    const out = join(tmpdir(), `overlay-${Date.now()}.yml`)
    roots.push(out)
    writeFileSync(out, '')
    const document = overlayDocument({
      observer: 'scripts/ops-runtime-observer.mjs',
      checkout: '/synthetic/checkout',
      expectedHead: 'abcdef',
      runNonce: 'nonce-1',
      outFile: '/synthetic/observer.json',
    })
    const parsed = JSON.parse(document) as { insert: { id: string; name: string; config: { runNonce: string } }[] }[]
    expect(parsed[0]?.insert[0]?.id).toBe('ops-runtime-observer')
    expect(parsed[0]?.insert[0]?.name.startsWith('file://')).toBe(true)
    expect(parsed[0]?.insert[0]?.config.runNonce).toBe('nonce-1')
    // Importing the module must not run its CLI.
    const imported = await import('./ops-runtime-observer-overlay.mjs')
    expect(typeof imported.overlayDocument).toBe('function')
  })
})
