/** Fixed distribution feed: release metadata cannot select another platform or repository. */
import type { UpdateInfo } from 'electron-updater'

/** Reject a mismatched community payload before any download begins.
 * @param info - Metadata returned by Electron's updater.
 * @param platform - Installed operating system.
 * @param arch - Installed architecture.
 */
export function validateCommunityUpdate(info: UpdateInfo, platform: string, arch: string): void {
  if (platform !== 'linux' || arch !== 'x64') throw new Error('Community automatic updates require Linux x64')
  if (info.files.length === 0) throw new Error('Community update has no files')
  for (const file of info.files) {
    const url = new URL(file.url)
    const filename = decodeURIComponent(url.pathname.split('/').at(-1) ?? '')
    const prefix = `deepseek-harness-${info.version}-linux-x64-unsigned.`
    if (url.origin !== 'https://github.com' || url.username !== '' || url.password !== ''
      || !url.pathname.startsWith(`/Missher12/Missher-DeepseekHarness-Desktop/releases/download/desktop-v${info.version}/`)
      || url.search !== '' || url.hash !== '' || !filename.startsWith(prefix)
      || !['deb', 'AppImage'].includes(filename.slice(prefix.length))
      || !/^[A-Za-z0-9+/]{86}==$/u.test(file.sha512)) {
      throw new Error('Community update platform, release asset, or SHA-512 is invalid')
    }
  }
}
