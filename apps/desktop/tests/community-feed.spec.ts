import { expect, it } from 'vitest'
import { validateCommunityUpdate } from '../src/community-feed.ts'

const version = '0.2.1-alpha.2.20261012.1'
const url = `https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/download/desktop-v${version}/deepseek-harness-${version}-linux-x64-unsigned.deb`
const info = { version, releaseDate: '', path: url, sha512: 'A'.repeat(86) + '==', files: [{ url, sha512: 'A'.repeat(86) + '==' }] }

it('accepts only exact distribution, platform, architecture, version and checksum metadata', () => {
  expect(() => { validateCommunityUpdate(info, 'linux', 'x64') }).not.toThrow()
  for (const changed of [url.replace('x64', 'arm64'), url.replace('github.com', 'example.com'),
    url.replace(version, '0.2.0'), url.replace('.deb', '.exe'), `${url}?other=1`]) {
    expect(() => { validateCommunityUpdate({ ...info, files: [{ ...info.files[0]!, url: changed }] }, 'linux', 'x64') }).toThrow()
  }
  expect(() => { validateCommunityUpdate({ ...info, files: [] }, 'linux', 'x64') }).toThrow()
  expect(() => { validateCommunityUpdate({ ...info, files: [{ url, sha512: '' }] }, 'linux', 'x64') }).toThrow()
  expect(() => { validateCommunityUpdate(info, 'darwin', 'x64') }).toThrow()
  expect(() => { validateCommunityUpdate(info, 'linux', 'arm64') }).toThrow()
})
