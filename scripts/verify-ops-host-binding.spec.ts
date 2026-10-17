/**
 * Contract tests for the Ops host-binding preflight, on synthetic trees and
 * through its real CLI. They prove the fail-closed decisions; they are not
 * Windows evidence and never touch a real checkout build.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { hostLinks, prepareHostRoot, verifyBinding } from './verify-ops-host-binding.mjs'

const script = fileURLToPath(new URL('./verify-ops-host-binding.mjs', import.meta.url))
const roots: string[] = []
afterAll(() => {
  for (const root of roots.splice(0).reverse()) rmSync(root, { recursive: true, force: true })
})

/** One package directory with a manifest and one exported built entry. */
function pkg(root: string, name: string, relativeEntry: string): string {
  const dir = join(root, name)
  mkdirSync(dirname(join(dir, relativeEntry)), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name,
    exports: { './package.json': './package.json', ...relativeEntry === 'lib/bin.js' ? {} : { '.': `./${relativeEntry}` } },
  }))
  writeFileSync(join(dir, relativeEntry), `export const marker = ${JSON.stringify(name)}\n`)
  return dir
}

/** A synthetic checkout matching the real layout the links point at. */
function checkout(): string {
  const root = mkdtempSync(join(tmpdir(), 'ops-binding-checkout-'))
  roots.push(root)
  pkg(join(root, 'apps'), 'cli', 'lib/bin.js')
  pkg(join(root, 'vendor'), 'cordis', 'lib/index.js')
  // pnpm-style dependency link: the CLI resolves cordis from its own modules.
  const cliModules = join(root, 'apps', 'cli', 'node_modules', '@deepseek-ai')
  mkdirSync(cliModules, { recursive: true })
  symlinkSync(join(root, 'vendor', 'cordis'), join(cliModules, 'cordis'))
  return root
}

/** One host root inside a parent directory the caller owns. */
function hostParent(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ops-binding-parent-'))
  roots.push(dir)
  return dir
}

describe('host binding preflight', () => {
  it('accepts a fresh isolated root resolving this checkout Host and cordis', () => {
    const root = checkout()
    const host = join(hostParent(), 'host')
    expect(prepareHostRoot(host, root, hostLinks(root)).ok).toBe(true)
    const facts = verifyBinding(host, root)
    expect(facts.failures).toEqual([])
    expect(facts.ok).toBe(true)
    const hostPackage = facts.hostPackage
    if (hostPackage === undefined) throw new Error('hostPackage must be reported')
    expect(hostPackage?.builtEntrySha256).toMatch(/^[0-9a-f]{64}$/u)
    const cordis = facts.chain?.cordis
    if (cordis === undefined) throw new Error('cordis chain entry must be reported')
    expect(cordis.entrySha256).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('rejects a stale host that resolves another checkout', () => {
    const root = checkout()
    const other = checkout()
    const host = join(hostParent(), 'host')
    prepareHostRoot(host, root, hostLinks(root))
    rmSync(join(host, 'node_modules', '@deepseek-ai', 'dsh'))
    symlinkSync(join(other, 'apps', 'cli'), join(host, 'node_modules', '@deepseek-ai', 'dsh'))
    const facts = verifyBinding(host, root)
    expect(facts.ok).toBe(false)
    expect(facts.failures.map(entry => entry.stage)).toContain('host')
  })

  it('rejects chain modules that resolve outside the checkout', () => {
    const root = checkout()
    const other = checkout()
    const host = join(hostParent(), 'host')
    prepareHostRoot(host, root, hostLinks(root))
    const cliModules = join(root, 'apps', 'cli', 'node_modules', '@deepseek-ai')
    rmSync(join(cliModules, 'cordis'), { force: true, recursive: true })
    symlinkSync(join(other, 'vendor', 'cordis'), join(cliModules, 'cordis'))
    const facts = verifyBinding(host, root)
    expect(facts.ok).toBe(false)
    expect(facts.failures.some(entry => entry.code === 'cordis-not-from-checkout')).toBe(true)
  })

  it('fails closed on a missing manifest, a missing build and an unbound HEAD', () => {
    const root = checkout()
    const empty = join(hostParent(), 'empty')
    mkdirSync(empty)
    const missing = verifyBinding(empty, root)
    expect(missing.ok).toBe(false)
    expect(missing.failures[0]?.stage).toBe('host')

    const host = join(hostParent(), 'host')
    prepareHostRoot(host, root, hostLinks(root))
    rmSync(join(root, 'apps', 'cli', 'lib', 'bin.js'))
    const unbuilt = verifyBinding(host, root)
    expect(unbuilt.ok).toBe(false)
    expect(unbuilt.failures.some(entry => entry.reason.includes('not built'))).toBe(true)

    const head = verifyBinding(host, root, { expectedHead: 'deadbeef', actualHead: null })
    expect(head.ok).toBe(false)
    expect(head.failures.some(entry => entry.stage === 'head')).toBe(true)
  })

  it('keeps an existing root untouched and reports it instead of repairing it', () => {
    const root = checkout()
    const host = join(hostParent(), 'host')
    mkdirSync(host)
    writeFileSync(join(host, 'keep.txt'), 'keep')
    expect(() => prepareHostRoot(host, root, hostLinks(root))).toThrow(/refuses an existing root/u)
    expect(readFileSync(join(host, 'keep.txt'), 'utf8')).toBe('keep')
  })
})

describe('host binding CLI', () => {
  /** A synthetic checkout with its own git HEAD. */
  function gitCheckout(): { root: string; head: string } {
    const root = checkout()
    const git = (...args: string[]): string => {
      const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
      expect(result.status, result.stderr).toBe(0)
      return result.stdout.trim()
    }
    git('init', '--initial-branch=main')
    git('config', 'user.email', 'binding@test.invalid')
    git('config', 'user.name', 'binding')
    writeFileSync(join(root, 'tracked.txt'), 'x')
    git('add', '.')
    git('commit', '-m', 'synthetic')
    return { root, head: git('rev-parse', 'HEAD') }
  }

  it('prepares a fresh root with the right HEAD, even with the flag last', () => {
    const { root, head } = gitCheckout()
    const parent = hostParent()
    const report = join(parent, 'report.json')
    const result = spawnSync(process.execPath, [script, '--prepare', '--checkout', root, '--host-root', join(parent, 'host'), '--expected-head', head, '--json', report, '--private-root-file', join(parent, 'root.txt'), '--prepare'], { encoding: 'utf8', timeout: 60_000 })
    expect(result.signal).toBeNull()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    const facts = JSON.parse(readFileSync(report, 'utf8')) as { ok: boolean; head: { expected: string } }
    expect(facts.ok).toBe(true)
    expect(facts.head.expected).toBe(head)
  })

  it('rejects a wrong HEAD and still writes the report', () => {
    const { root } = gitCheckout()
    const parent = hostParent()
    const report = join(parent, 'report.json')
    const result = spawnSync(process.execPath, [script, '--prepare', '--checkout', root, '--host-root', join(parent, 'host'), '--expected-head', 'f'.repeat(40), '--json', report], { encoding: 'utf8', timeout: 60_000 })
    expect(result.signal).toBeNull()
    expect(result.status).toBe(1)
    const facts = JSON.parse(readFileSync(report, 'utf8')) as { ok: boolean; failures: { stage: string }[] }
    expect(facts.ok).toBe(false)
    expect(facts.failures.some(entry => entry.stage === 'head')).toBe(true)
  })

  it('rejects an existing host root without touching it or the parent', () => {
    const { root, head } = gitCheckout()
    const parent = hostParent()
    const existing = join(parent, 'existing')
    mkdirSync(existing)
    writeFileSync(join(existing, 'keep.txt'), 'keep')
    const report = join(parent, 'report.json')
    const result = spawnSync(process.execPath, [script, '--prepare', '--checkout', root, '--host-root', existing, '--expected-head', head, '--json', report], { encoding: 'utf8', timeout: 60_000 })
    expect(result.signal).toBeNull()
    expect(result.status).toBe(1)
    const facts = JSON.parse(readFileSync(report, 'utf8')) as { ok: boolean; failures: { code?: string }[] }
    expect(facts.ok).toBe(false)
    expect(facts.failures.some(failure => failure.code === 'root-exists')).toBe(true)
    expect(readFileSync(join(existing, 'keep.txt'), 'utf8')).toBe('keep')
  })

  it('rejects a missing host root argument and a missing checkout entry', () => {
    const { root, head } = gitCheckout()
    const missingArgument = spawnSync(process.execPath, [script, '--prepare', '--checkout', root, '--expected-head', head], { encoding: 'utf8', timeout: 60_000 })
    expect(missingArgument.status).toBe(1)
    expect(missingArgument.stdout).toContain('host-root-required')

    const broken = checkout()
    rmSync(join(broken, 'apps', 'cli', 'lib', 'bin.js'))
    // A host that really links the broken checkout, so the only failure is the
    // missing built entry (a stale host is a separate case).
    const host = join(hostParent(), 'host')
    prepareHostRoot(host, broken, hostLinks(broken))
    const facts = verifyBinding(host, broken)
    expect(facts.ok).toBe(false)
    expect(facts.failures.some(entry => entry.reason.includes('not built'))).toBe(true)
    const stale = verifyBinding(host, root)
    expect(stale.failures.some(entry => entry.stage === 'host')).toBe(true)
  })
})
