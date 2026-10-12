import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOCUMENTS_LOOKUP_TIMEOUT_MS, MACOS_DOCUMENTS_SCRIPT, documentsIsolation, isolatedProfileEnv, macosDocumentsDirectory } from '../scripts/community-shell-documents.mjs'

interface CommandCall {
  command: string
  args: readonly string[]
  env: NodeJS.ProcessEnv
  encoding: string
  timeout: number
}

function recorder(result: { status: number | null; stdout?: string | null; stderr?: string | null; error?: Error }) {
  const calls: CommandCall[] = []
  const run = (command: string, args: readonly string[], options: { env: NodeJS.ProcessEnv; encoding: 'utf8'; timeout: number }) => {
    calls.push({ command, args, env: options.env, encoding: options.encoding, timeout: options.timeout })
    return result
  }
  return { calls, run }
}

const isolated = { HOME: '/tmp/missher-desktop-smoke-x', CFFIXED_USER_HOME: '/tmp/missher-desktop-smoke-x' }

type IsolatedRoots<K extends string> = { readonly [P in K]: string }

async function withRoots<K extends string, T>(keys: readonly K[], body: (roots: IsolatedRoots<K>) => Promise<T> | T): Promise<T> {
  const base = await mkdtemp(join(tmpdir(), 'dsh-documents-spec-'))
  try {
    const roots = {} as Record<K, string>
    for (const key of keys) {
      const path = join(base, key)
      await mkdir(path, { recursive: true })
      roots[key] = path
    }
    return await body(roots)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}

describe('macOS Documents resolution for the packaged Desktop smoke', () => {
  it('asks the Host AppleScript with the isolated environment under a bounded timeout', () => {
    const { calls, run } = recorder({ status: 0, stdout: '/Users/runner/Documents\n', stderr: '' })
    expect(macosDocumentsDirectory(isolated, run)).toBe('/Users/runner/Documents')
    expect(calls).toEqual([{ command: 'osascript', args: ['-e', MACOS_DOCUMENTS_SCRIPT], env: isolated, encoding: 'utf8', timeout: DOCUMENTS_LOOKUP_TIMEOUT_MS }])
  })

  it('pins the account Documents question the Host resolves', () => {
    expect(MACOS_DOCUMENTS_SCRIPT).toBe('POSIX path of (path to documents folder from user domain without folder creation)')
  })

  it('trims repeated trailing newlines', () => {
    const { run } = recorder({ status: 0, stdout: '/Users/runner/Documents\r\n\n', stderr: '' })
    expect(macosDocumentsDirectory(isolated, run)).toBe('/Users/runner/Documents')
  })

  it('rejects a failed lookup instead of skipping the on-disk Workspace check', () => {
    const { run } = recorder({ status: 1, stdout: '', stderr: 'execution error: Not authorized. (-1743)\n' })
    expect(() => macosDocumentsDirectory(isolated, run)).toThrow('macOS Documents lookup failed: execution error: Not authorized. (-1743)')
  })

  it('rejects a timed-out lookup', () => {
    const { run } = recorder({ status: null, stdout: null, stderr: null, error: new Error('spawnSync osascript ETIMEDOUT') })
    expect(() => macosDocumentsDirectory(isolated, run)).toThrow('macOS Documents lookup failed: spawnSync osascript ETIMEDOUT')
  })

  it('rejects a spawn error', () => {
    const { run } = recorder({ status: null, stdout: null, stderr: null, error: new Error('spawn osascript ENOENT') })
    expect(() => macosDocumentsDirectory(isolated, run)).toThrow('macOS Documents lookup failed: spawn osascript ENOENT')
  })

  it('rejects the empty answer the Host treats as an unavailable Documents directory', () => {
    const { run } = recorder({ status: 0, stdout: '\n', stderr: '' })
    expect(() => macosDocumentsDirectory(isolated, run)).toThrow('non-absolute directory')
  })

  it('rejects a relative answer', () => {
    const { run } = recorder({ status: 0, stdout: 'Documents\n', stderr: '' })
    expect(() => macosDocumentsDirectory(isolated, run)).toThrow("non-absolute directory: 'Documents'")
  })
})

describe('isolated profile environment shared by the preflight and the smoke', () => {
  it('routes the macOS home, config, cache, harness data, and diagnostic file into the isolated root', () => {
    const env = isolatedProfileEnv('/tmp/isolated-root', 'darwin')
    expect(env).toMatchObject({
      HOME: '/tmp/isolated-root',
      CFFIXED_USER_HOME: '/tmp/isolated-root',
      XDG_CONFIG_HOME: join('/tmp/isolated-root', 'config'),
      XDG_CACHE_HOME: join('/tmp/isolated-root', 'cache'),
      DSH_HOME: join('/tmp/isolated-root', 'harness'),
      DSH_DESKTOP_DIAGNOSTIC_FILE: join('/tmp/isolated-root', 'fatal.txt'),
      DSH_TELEMETRY_DISABLED: '1',
    })
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })

  it('leaves the home override to macOS and uses the Windows profile directories there', () => {
    const env = isolatedProfileEnv('/tmp/isolated-root', 'win32')
    expect(env.HOME).toBe(process.env.HOME)
    expect(env.CFFIXED_USER_HOME).toBe(process.env.CFFIXED_USER_HOME)
    expect(env).toMatchObject({ APPDATA: join('/tmp/isolated-root', 'config'), LOCALAPPDATA: join('/tmp/isolated-root', 'cache') })
  })
})

describe('isolated Documents containment', () => {
  it('accepts the Documents directory inside the isolated root', async () => {
    await withRoots(['root'], async (roots) => {
      const root = roots.root
      await mkdir(join(root, 'Documents'))
      const verdict = documentsIsolation(join(root, 'Documents'), root)
      // The verdict reports realpath output, which differs from the mkdtemp
      // spelling wherever the temporary root resolves through a symlink
      // (`/var` to `/private/var` on macOS), so read the expectation back.
      expect(verdict).toMatchObject({ isolated: true, resolvedDirectory: await realpath(join(root, 'Documents')) })
    })
  })

  it('accepts the root itself', async () => {
    await withRoots(['root'], (roots) => {
      const root = roots.root
      expect(documentsIsolation(root, root).isolated).toBe(true)
    })
  })

  it('accepts one root spelling through a symlink alias of the other', async () => {
    await withRoots(['real-root'], async (roots) => {
      const real = roots['real-root']
      const alias = `${real}-alias`
      await symlink(real, alias)
      await mkdir(join(real, 'Documents'))
      expect(documentsIsolation(join(alias, 'Documents'), real)).toMatchObject({
        isolated: true, resolvedDirectory: await realpath(join(real, 'Documents')),
      })
      expect(documentsIsolation(join(real, 'Documents'), alias).isolated).toBe(true)
    })
  })

  it('rejects the account Documents directory outside the isolated root', async () => {
    await withRoots(['root', 'account/Documents'], (roots) => {
      const root = roots.root
      const verdict = documentsIsolation(roots['account/Documents'], root)
      expect(verdict.isolated).toBe(false)
      expect(verdict.resolvedDirectory).toContain(`${sep}account${sep}Documents`)
    })
  })

  it('rejects a sibling whose path merely extends the root name', async () => {
    await withRoots(['root', 'root-sibling'], (roots) => {
      const root = roots.root
      expect(documentsIsolation(`${root}-sibling`, root).isolated).toBe(false)
    })
  })

  it('rejects an unresolvable directory instead of assuming containment', async () => {
    await withRoots(['root'], (roots) => {
      const root = roots.root
      const verdict = documentsIsolation(join(root, 'missing', 'Documents'), root)
      expect(verdict).toMatchObject({ isolated: false, resolvedDirectory: null })
    })
  })

  it('rejects every path when the isolated root itself is unresolvable', async () => {
    await withRoots(['root'], async (roots) => {
      const root = roots.root
      await mkdir(join(root, 'Documents'))
      expect(documentsIsolation(join(root, 'Documents'), join(root, 'absent')).isolated).toBe(false)
    })
  })
})
