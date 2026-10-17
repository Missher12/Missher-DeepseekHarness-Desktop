// Preflight for an isolated Project Ops host root: the root must resolve THIS
// checkout's CLI with a built entry, and the CLI's own module context must
// resolve this checkout's cordis. The profile's plugin chain (sandbox-local,
// subprocess-local, Windows ACL runner) is not a CLI dependency and is proven by
// the runtime observer inside the real profile, not guessed here.
//
// Preparation and verification are separate: `prepareHostRoot` creates a fresh
// directory this module owns; `verifyBinding` only reads the root it is given.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** SHA-256 of one file, or null when it does not exist. */
function hashOf(path) {
  return existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null
}

/** Canonical path when it exists, otherwise null. */
function canonical(path) {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

/** Repo-relative public path, or a placeholder; absolute paths never go public. */
function publicPath(path, checkout) {
  if (path === null) return null
  const rel = relative(checkout, path)
  if (rel === '') return '.'
  return rel.startsWith('..') ? '<outside-checkout>' : rel.replaceAll('\\', '/')
}

/**
 * Create one fresh isolated host root owned by this call.
 * @param {string} hostRoot absolute directory that must not exist yet
 * @param {string} checkout absolute repository root
 * @param {Record<string, string>} links package name -> absolute checkout directory
 * @returns {{ok: boolean, failures: string[]}}
 */
export function prepareHostRoot(hostRoot, checkout, links) {
  const failures = []
  if (existsSync(hostRoot)) throw new Error(`prepareHostRoot refuses an existing root: ${publicPath(hostRoot, checkout)}`)
  mkdirSync(join(hostRoot, 'node_modules', '@deepseek-ai'), { recursive: true })
  writeFileSync(join(hostRoot, 'package.json'), JSON.stringify({
    name: 'ops-host-binding', private: true, type: 'module',
    dependencies: { '@deepseek-ai/dsh': '0.0.0' },
  }, null, 2))
  for (const [name, target] of Object.entries(links)) {
    if (!existsSync(target)) {
      failures.push({ stage: 'prepare', reason: `missing checkout package for ${publicPath(target, checkout)}` })
      continue
    }
    symlinkSync(target, join(hostRoot, 'node_modules', '@deepseek-ai', name), process.platform === 'win32' ? 'junction' : 'dir')
  }
  return { ok: failures.length === 0, failures }
}

/** Checkout packages the isolated root links, by package name. */
export function hostLinks(checkout) {
  return {
    dsh: join(checkout, 'apps', 'cli'),
    cordis: join(checkout, 'vendor', 'cordis'),
  }
}

/**
 * Read-only verification of one prepared root against one checkout.
 * @param {string} hostRoot absolute isolated root
 * @param {string} checkout absolute repository root
 * @param {{expectedHead?: string, actualHead?: string | null}} [options] expected `git rev-parse HEAD`
 * @returns {object} facts with `ok`, structured `failures` and stable stages
 */
export function verifyBinding(hostRoot, checkout, options = {}) {
  const failures = []
  const facts = { stage: 'verify', checkout: publicPath(canonical(checkout) ?? checkout, checkout), hostRoot: '<host-root>', ok: false, failures }
  const expectedCli = canonical(join(checkout, 'apps', 'cli'))
  const cliManifest = canonical(join(hostRoot, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
  if (cliManifest === null) {
    failures.push({ stage: 'host', reason: 'the host root does not resolve @deepseek-ai/dsh/package.json' })
    return facts
  }
  const cliDir = realpathSync(dirname(cliManifest))
  const builtEntry = join(cliDir, 'lib', 'bin.js')
  facts.hostPackage = {
    manifest: publicPath(cliManifest, checkout),
    dir: publicPath(cliDir, checkout),
    builtEntry: publicPath(builtEntry, checkout),
    builtEntrySha256: hashOf(builtEntry),
  }
  if (cliDir !== expectedCli) failures.push({ stage: 'host', reason: `stale host: resolves to ${publicPath(cliDir, checkout)}` })
  if (facts.hostPackage.builtEntrySha256 === null) failures.push({ stage: 'host', reason: 'the Host entry lib/bin.js is not built' })

  // The CLI's own dependency: only what the CLI package actually declares.
  facts.chain = {}
  try {
    const cordisEntry = realpathSync(createRequire(join(cliDir, 'lib', 'bin.js')).resolve('@deepseek-ai/cordis'))
    facts.chain.cordis = { entry: publicPath(cordisEntry, checkout), entrySha256: hashOf(cordisEntry) }
    const expectedCordis = canonical(join(checkout, 'vendor', 'cordis', 'lib', 'index.js'))
    if (canonical(cordisEntry) !== expectedCordis) {
      failures.push({ stage: 'chain', code: 'cordis-not-from-checkout', reason: 'cordis does not resolve to this checkout vendor/cordis/lib/index.js' })
    }
  } catch (error) {
    facts.chain.cordis = { entry: null, entrySha256: null }
    failures.push({ stage: 'chain', code: 'cordis-unresolved', reason: 'the CLI cannot resolve @deepseek-ai/cordis' })
  }
  facts.profileChain = {
    stage: 'runtime-observer-required',
    reason: 'sandbox-local, subprocess-local and the built Windows ACL runner are profile plugins; only the in-profile observer can prove them',
  }
  facts.head = { expected: options.expectedHead ?? null, actual: options.actualHead ?? null, source: 'git rev-parse HEAD' }
  if (options.expectedHead !== undefined) {
    if (options.actualHead === null || options.actualHead === undefined) failures.push({ stage: 'head', reason: 'git HEAD is unavailable, so the checkout cannot be bound' })
    else if (options.actualHead !== options.expectedHead) failures.push({ stage: 'head', reason: `HEAD mismatch: ${options.actualHead.slice(0, 12)} != ${options.expectedHead.slice(0, 12)}` })
  }
  facts.ok = failures.length === 0
  return facts
}

/** Report helper: write facts even on failure, then exit non-zero. */
function emit(facts, jsonPath) {
  const output = JSON.stringify(facts, null, 2)
  if (jsonPath !== undefined) writeFileSync(resolve(jsonPath), output)
  process.stdout.write(`${output}\n`)
  process.exitCode = facts.ok ? 0 : 1
}

/** CLI entry: `--prepare` (fresh root, owned cleanup) or read-only verify. */
function main(argv) {
  const option = name => {
    const index = argv.indexOf(`--${name}`)
    return index < 0 ? undefined : argv[index + 1]
  }
  const prepare = argv.includes('--prepare')
  const checkout = resolve(option('checkout') ?? process.cwd())
  const expectedHead = option('expected-head')
  const jsonPath = option('json')
  let actualHead = null
  try {
    const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' })
    actualHead = result.status === 0 ? result.stdout.trim() : null
  } catch {
    actualHead = null
  }
  let facts
  if (!prepare) {
    facts = verifyBinding(resolve(option('host-root') ?? ''), checkout, { expectedHead, actualHead })
    emit(facts, jsonPath)
    return
  }
  // `--host-root` is the new root this command creates; it must not exist yet and
  // its parent must. The caller passes this exact path to
  // PROJECT_OPS_HOST_ROOT, so no second API shape exists.
  const root = option('host-root')
  if (root === undefined) {
    emit({ stage: 'prepare', ok: false, failures: [{ stage: 'prepare', code: 'host-root-required', reason: '--host-root must name the new isolated root' }] }, jsonPath)
    return
  }
  const freshRoot = resolve(root)
  const parent = dirname(freshRoot)
  if (!existsSync(parent)) {
    emit({ stage: 'prepare', ok: false, failures: [{ stage: 'prepare', code: 'parent-missing', reason: 'the host-root parent does not exist' }] }, jsonPath)
    return
  }
  if (existsSync(freshRoot)) {
    emit({ stage: 'prepare', ok: false, failures: [{ stage: 'prepare', code: 'root-exists', reason: 'the host-root already exists and is left untouched' }] }, jsonPath)
    return
  }
  let prepared
  try {
    prepared = prepareHostRoot(freshRoot, checkout, hostLinks(checkout))
  } catch {
    rmSync(freshRoot, { recursive: true, force: true })
    emit({ stage: 'prepare', ok: false, failures: [{ stage: 'prepare', code: 'prepare-failed', reason: 'the isolated root could not be created and was cleaned up' }] }, jsonPath)
    return
  }
  if (!prepared.ok) {
    rmSync(freshRoot, { recursive: true, force: true })
    emit({ stage: 'prepare', ok: false, hostRoot: '<host-root>', failures: prepared.failures }, jsonPath)
    return
  }
  facts = verifyBinding(freshRoot, checkout, { expectedHead, actualHead })
  facts.hostRoot = '<host-root>'
  facts.preparedRoot = publicPath(freshRoot, checkout)
  // Write the real root only to a private file the workflow reads; the public
  // report never carries a machine absolute path.
  const privateRootFile = option('private-root-file')
  if (privateRootFile !== undefined) writeFileSync(resolve(privateRootFile), `${freshRoot}
`)
  if (!facts.ok) rmSync(freshRoot, { recursive: true, force: true })
  emit(facts, jsonPath)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2))
}
