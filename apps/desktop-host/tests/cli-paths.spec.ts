import { join } from 'node:path'
import { expect, it } from 'vitest'
import { desktopSupportDir } from '../src/cli-paths.ts'
import { runtimeArchivePath } from '../src/office-engine.ts'

it('resolves the pnpm payload for prepared, ASAR and Linux unpacked layouts', () => {
  expect(desktopSupportDir(join('checkout', 'targets', 'linux-x64', 'dsh')))
    .toBe(join('checkout', 'targets', 'linux-x64', 'runtime'))
  expect(desktopSupportDir(join('App', 'resources', 'app.asar', 'dsh')))
    .toBe(join('App', 'resources', 'runtime'))
  expect(desktopSupportDir(join('App', 'resources', 'app', 'dsh')))
    .toBe(join('App', 'resources', 'runtime'))
})

it('never classifies the unpacked app tree as an ASAR archive', () => {
  expect(runtimeArchivePath(join('App', 'resources', 'app', 'dsh'))).toBeUndefined()
  expect(runtimeArchivePath(join('App', 'resources', 'app.asar', 'dsh')))
    .toBe(join('App', 'resources', 'app.asar'))
})
