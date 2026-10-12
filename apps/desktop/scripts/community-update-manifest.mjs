/** Generate the public Linux update channel from frozen release assets. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { valid } from 'semver'
import { dump } from 'js-yaml'

/** Bind both Linux package formats to one immutable release and exact SHA-512.
 * @param {string} directory Directory containing the final DEB and AppImage.
 * @param {string} version Electron build version, including its monotonic suffix.
 * @param {string} notes Public release notes, containing no profile data.
 * @returns {Promise<object>} electron-updater generic provider metadata.
 */
export async function createCommunityUpdateManifest(directory, version, notes) {
  if (valid(version) !== version || version.includes('+')) throw new Error('Invalid comparable build version')
  const files = []
  for (const extension of ['AppImage', 'deb']) {
    const name = `deepseek-harness-${version}-linux-x64-unsigned.${extension}`
    const path = join(directory, name)
    const info = await stat(path)
    if (!info.isFile() || info.size === 0) throw new Error(`Empty release asset: ${basename(path)}`)
    const digest = createHash('sha512')
    for await (const chunk of createReadStream(path)) digest.update(chunk)
    files.push({ url: `https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/download/desktop-v${version}/${name}`,
      sha512: digest.digest('base64'), size: info.size })
  }
  return { version, files, path: files[0].url, sha512: files[0].sha512, releaseNotes: notes }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [directory, version, notesFile] = process.argv.slice(2)
  if (!directory || !version || !notesFile) throw new Error('Usage: community-update-manifest.mjs <assets> <version> <public-notes>')
  const manifest = await createCommunityUpdateManifest(directory, version, await readFile(notesFile, 'utf8'))
  await writeFile(join(directory, 'nightly-linux.yml'), dump(manifest))
}
