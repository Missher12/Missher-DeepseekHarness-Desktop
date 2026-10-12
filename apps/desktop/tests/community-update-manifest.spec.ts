import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { load } from 'js-yaml'
import { execFileSync } from 'node:child_process'
import { createCommunityUpdateManifest } from '../scripts/community-update-manifest.mjs'

it('binds actual package bytes, rejects missing or empty assets, and emits readable updater metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-update-manifest-'))
  const version = '0.2.1-alpha.2.20261012.1'
  const prefix = `deepseek-harness-${version}-linux-x64-unsigned`
  try {
    await expect(createCommunityUpdateManifest(directory, version, 'notes')).rejects.toThrow()
    await writeFile(join(directory, `${prefix}.AppImage`), 'appimage-content')
    await writeFile(join(directory, `${prefix}.deb`), '')
    await expect(createCommunityUpdateManifest(directory, version, 'notes')).rejects.toThrow('Empty release asset')
    await writeFile(join(directory, `${prefix}.deb`), 'deb-content')
    const manifest = await createCommunityUpdateManifest(directory, version, 'Changes\n第二行')
    expect(manifest.files).toEqual(['AppImage', 'deb'].map((extension, index) => {
      const content = index === 0 ? 'appimage-content' : 'deb-content'
      return {
        url: `https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/download/desktop-v${version}/${prefix}.${extension}`,
        size: Buffer.byteLength(content), sha512: createHash('sha512').update(content).digest('base64'),
      }
    }))
    expect(manifest.releaseNotes).toBe('Changes\n第二行')
    await expect(createCommunityUpdateManifest(directory, `${version}+other`, '')).rejects.toThrow('Invalid comparable')
    await writeFile(join(directory, 'notes.txt'), manifest.releaseNotes)
    execFileSync(process.execPath, ['apps/desktop/scripts/community-update-manifest.mjs', directory, version, join(directory, 'notes.txt')])
    const { readFile } = await import('node:fs/promises')
    expect(load(await readFile(join(directory, 'nightly-linux.yml'), 'utf8'))).toEqual(manifest)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
