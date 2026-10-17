import { expect, it } from 'vitest'
import { selectOfficeEngine } from './libreoffice-packages.mjs'

it.each([
  ['darwin', 'arm64', 'darwin-arm64'], ['darwin', 'x64', 'darwin-x64'],
  ['win32', 'arm64', 'win32-arm64'], ['win32', 'x64', 'win32-x64'],
  ['linux', 'x64', 'wasm'], ['linux', 'arm64', 'wasm'],
  ['darwin', 'other', 'wasm'], ['freebsd', 'x64', 'wasm'],
])('selects the declared engine for %s/%s', (platform, arch, expected) => {
  const optionalDependencies = Object.fromEntries(
    ['darwin-arm64', 'darwin-x64', 'win32-arm64', 'win32-x64', 'wasm']
      .map(engine => [`@deepseek-ai/libreoffice-kit-${engine}`, '0.0.1']),
  )
  expect(selectOfficeEngine({ optionalDependencies }, { platform, arch })).toBe(expected)
})

it('selects a declared Linux native target without an OS-specific policy change', () => {
  expect(selectOfficeEngine({ optionalDependencies: { '@deepseek-ai/libreoffice-kit-linux-x64': '1' } },
    { platform: 'linux', arch: 'x64' })).toBe('linux-x64')
})

it('prefers the declared glibc Linux engine that the kit resolves on glibc hosts', () => {
  const optionalDependencies = {
    '@deepseek-ai/libreoffice-kit-linux-x64': '1',
    '@deepseek-ai/libreoffice-kit-linux-x64-glibc': '0.1.1',
    '@deepseek-ai/libreoffice-kit-wasm': '0.1.5',
  }
  expect(selectOfficeEngine({ optionalDependencies }, { platform: 'linux', arch: 'x64' })).toBe('linux-x64-glibc')
})

it('keeps the installed 0.1.5 kit fallback and native selections unchanged', () => {
  // The installed kit 0.1.5 manifest declares no Linux native package, so Linux
  // packages its WASM engine while macOS and Windows keep their native engines.
  const optionalDependencies = {
    '@deepseek-ai/libreoffice-kit-darwin-arm64': '0.1.5',
    '@deepseek-ai/libreoffice-kit-darwin-x64': '0.1.5',
    '@deepseek-ai/libreoffice-kit-wasm': '0.1.5',
    '@deepseek-ai/libreoffice-kit-win32-arm64': '0.1.5',
    '@deepseek-ai/libreoffice-kit-win32-x64': '0.1.5',
  }
  expect(selectOfficeEngine({ optionalDependencies }, { platform: 'linux', arch: 'x64' })).toBe('wasm')
  expect(selectOfficeEngine({ optionalDependencies }, { platform: 'darwin', arch: 'x64' })).toBe('darwin-x64')
  expect(selectOfficeEngine({ optionalDependencies }, { platform: 'win32', arch: 'x64' })).toBe('win32-x64')
})

it('uses WASM when no native targets are declared', () => {
  expect(selectOfficeEngine({}, { platform: 'darwin', arch: 'x64' })).toBe('wasm')
})
