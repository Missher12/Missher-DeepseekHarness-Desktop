// Read-only Project Ops profile observer.
//
// Loaded into the real Ops profile through `PROJECT_OPS_EXTRA_PATCH`, it records
// what the profile actually resolved: the Host package from the profile's own
// `installAnchor`, and the cordis / sandbox-local / subprocess-local chain plus
// the built Windows ACL runner from the real profile module context. It never
// starts a model request, never calls appExit and never changes the original
// task's gates; a mismatch is written to the evidence file and thrown.
//
// The module context is the PROFILE directory, not this file's repository path,
// so a profile-local old SDK wins exactly as it would for the real plugins.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Exported plugin name, as the Loader/overlay row requires. */
export const name = 'ops-runtime-observer'
/** No service needs to be ready before the read-only inspection runs. */
export const inject = []

/** SHA-256 of one file, or null. */
const hashOf = path => existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null

/** Canonical path, or null when it does not exist. */
const canonical = path => {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

/**
 * Resolve one specifier from one file context.
 * @param contextFile absolute file whose directory is the module context
 * @param specifier package specifier
 * @returns canonical entry path or null
 */
function resolveFrom(contextFile, specifier) {
  try {
    return canonical(createRequire(pathToFileURL(contextFile).href).resolve(specifier))
  } catch {
    return null
  }
}

/**
 * Inspect the runtime the profile really resolved.
 * @param profileContext the profile's own `{ dir, installAnchor }`
 * @param config `{ checkout, expectedHead, runNonce, outFile }`
 * @returns the evidence object (also written to `config.outFile`)
 */
export function inspectRuntime(profileContext, config) {
  const failures = []
  const missing = [
    ['dir', profileContext?.dir],
    ['installAnchor', profileContext?.installAnchor],
  ].filter(([, value]) => typeof value !== 'string' || value.length === 0).map(([name]) => name)
  if (missing.length > 0) {
    const evidence = {
      state: 'runtime-observer', runNonce: config.runNonce, expectedHead: config.expectedHead ?? null,
      pid: process.pid, observedAt: new Date().toISOString(), ok: false,
      failures: missing.map(name => ({ stage: 'profile-context', code: `${name}-missing` })),
    }
    if (config.outFile !== undefined) {
      mkdirSync(dirname(config.outFile), { recursive: true })
      writeFileSync(config.outFile, JSON.stringify({ runNonce: config.runNonce, expectedHead: config.expectedHead ?? null, observations: [evidence] }, null, 2))
    }
    return evidence
  }
  const checkout = config.checkout
  const expected = {
    host: canonical(join(checkout, 'apps', 'cli', 'package.json')),
    hostEntry: canonical(join(checkout, 'apps', 'cli', 'lib', 'bin.js')),
    cordis: canonical(join(checkout, 'vendor', 'cordis', 'lib', 'index.js')),
    sandboxLocal: canonical(join(checkout, 'packages', 'sandbox', 'sandbox-local', 'lib', 'index.js')),
    subprocessLocal: canonical(join(checkout, 'packages', 'subprocess', 'subprocess-local', 'lib', 'index.js')),
    aclMain: canonical(join(checkout, 'packages', 'sandbox', 'sandbox-windows-acl', 'lib', 'index.js')),
    aclRunner: canonical(join(checkout, 'packages', 'sandbox', 'sandbox-windows-acl', 'lib', 'runner.js')),
  }
  const installAnchor = canonical(profileContext.installAnchor)
  const profileDir = canonical(profileContext.dir)
  // Resolution context: the real profile directory (its node_modules wins), with
  // the install anchor as the Host's own context for the CLI entry.
  const profileContextFile = join(profileContext.dir, 'cordis.yml')
  const anchorContextFile = join(dirname(profileContext.installAnchor), 'package.json')

  const observed = {
    host: {
      installAnchor: canonical(profileContext.installAnchor),
      manifest: resolveFrom(anchorContextFile, '@deepseek-ai/dsh/package.json'),
      bin: canonical(join(dirname(profileContext.installAnchor), 'lib', 'bin.js')),
    },
    chain: {
      cordis: resolveFrom(profileContextFile, '@deepseek-ai/cordis'),
      sandboxLocal: resolveFrom(profileContextFile, '@deepseek-ai/dsh-sandbox-local'),
      subprocessLocal: resolveFrom(profileContextFile, '@deepseek-ai/dsh-subprocess-local'),
    },
    acl: { main: null, runner: null },
  }
  // The Windows ACL package is a dependency of the sandbox seam, so it is
  // resolved from sandbox-local's own entry context, exactly as the confined run
  // loads it.
  if (observed.chain.sandboxLocal !== null) {
    observed.acl.main = resolveFrom(observed.chain.sandboxLocal, '@deepseek-ai/dsh-sandbox-windows-acl')
    observed.acl.runner = resolveFrom(observed.chain.sandboxLocal, '@deepseek-ai/dsh-sandbox-windows-acl/runner')
  }

  if (installAnchor !== expected.host) failures.push({ stage: 'host', code: 'install-anchor-mismatch' })
  if (observed.host.manifest !== null && observed.host.manifest !== expected.host) {
    failures.push({ stage: 'host', code: 'host-manifest-outside-checkout' })
  }
  if (observed.host.bin === null) failures.push({ stage: 'host', code: 'host-bin-unbuilt' })
  if (observed.chain.cordis !== expected.cordis) failures.push({ stage: 'chain', code: 'cordis-not-from-checkout' })
  if (observed.chain.sandboxLocal !== expected.sandboxLocal) failures.push({ stage: 'chain', code: 'sandbox-local-not-from-checkout' })
  if (observed.chain.subprocessLocal !== expected.subprocessLocal) failures.push({ stage: 'chain', code: 'subprocess-local-not-from-checkout' })
  if (observed.acl.main !== expected.aclMain) failures.push({ stage: 'acl', code: 'acl-main-not-from-checkout' })
  if (observed.acl.runner !== expected.aclRunner) failures.push({ stage: 'acl', code: 'acl-runner-not-from-checkout' })
  if (observed.acl.runner === null || hashOf(observed.acl.runner) === null) failures.push({ stage: 'acl', code: 'acl-runner-unbuilt' })

  // Every expected path must exist and every observed path must be non-null: a
  // null == null comparison must never pass as a match.
  for (const [name, path] of Object.entries(expected)) {
    if (path === null) failures.push({ stage: 'expected', code: `${name}-missing` })
  }
  if (observed.chain.cordis !== null && expected.cordis !== null && observed.chain.cordis === expected.cordis) {
    // matched; anything else was already reported above
  }
  const publicPath = path => {
    if (path === null) return null
    const rel = relative(checkout, path)
    return rel.startsWith('..') || rel === '' ? '<outside-checkout>' : rel.replaceAll('\\', '/')
  }
  const evidence = {
    state: 'runtime-observer',
    runNonce: config.runNonce,
    expectedHead: config.expectedHead ?? null,
    pid: process.pid,
    observedAt: new Date().toISOString(),
    profileDir: publicPath(profileDir),
    installAnchor: publicPath(installAnchor),
    observed: {
      host: {
        installAnchor: publicPath(observed.host.installAnchor),
        manifest: publicPath(observed.host.manifest),
        bin: publicPath(observed.host.bin),
      },
      chain: {
        cordis: publicPath(observed.chain.cordis),
        sandboxLocal: publicPath(observed.chain.sandboxLocal),
        subprocessLocal: publicPath(observed.chain.subprocessLocal),
      },
      acl: { main: publicPath(observed.acl.main), runner: publicPath(observed.acl.runner) },
    },
    expected: Object.fromEntries(Object.entries(expected).map(([name, path]) => [name, publicPath(path)])),
    hashes: {
      hostEntry: hashOf(expected.hostEntry),
      cordis: hashOf(expected.cordis),
      sandboxLocal: hashOf(expected.sandboxLocal),
      subprocessLocal: hashOf(expected.subprocessLocal),
      aclMain: hashOf(expected.aclMain),
      aclRunner: hashOf(expected.aclRunner),
    },
    ok: failures.length === 0,
    failures,
  }
  if (config.outFile !== undefined) {
    // Installed and removed are two separate dsh processes in one run; each
    // appends its observation so both survive and the gate can count them.
    mkdirSync(dirname(config.outFile), { recursive: true })
    let previous = []
    if (existsSync(config.outFile)) {
      // Stale evidence is refused, never inherited or silently reset.
      let existing
      try {
        existing = JSON.parse(readFileSync(config.outFile, 'utf8'))
      } catch {
        throw new Error('ops runtime observer: the existing evidence file is unreadable')
      }
      if (existing.runNonce !== config.runNonce || existing.expectedHead !== (config.expectedHead ?? null)) {
        throw new Error('ops runtime observer: the existing evidence belongs to another run')
      }
      previous = Array.isArray(existing.observations) ? existing.observations : []
    }
    if (previous.length >= 2) throw new Error('ops runtime observer: more than the two expected observations')
    const document = {
      runNonce: config.runNonce,
      expectedHead: config.expectedHead ?? null,
      observations: [...previous, evidence],
    }
    writeFileSync(config.outFile, JSON.stringify(document, null, 2))
  }
  return evidence
}

/**
 * Plugin entry: run the inspection once after the application is ready.
 * @param ctx the profile context
 * @param config observer config supplied by the generated overlay
 */
export function apply(ctx, config) {
  const run = () => {
    const evidence = inspectRuntime(ctx.profileContext, config)
    if (!evidence.ok) throw new Error(`ops runtime observer: ${evidence.failures.map(f => `${f.stage}:${f.code}`).join(',')}`)
  }
  if (typeof ctx.effect === 'function') ctx.effect(() => { run() })
  else run()
}
