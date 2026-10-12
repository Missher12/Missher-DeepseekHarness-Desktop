/** Release checks for community builds that do not carry an installer feed. */
import { gt, rcompare, valid } from 'semver'

/** Published distribution version and its fixed-origin release notes. */
export interface CommunityRelease {
  readonly version: string
  readonly url: string
  readonly newer: boolean
}

/**
 * Check published releases, including release candidates, without downloading an installer.
 * @param currentVersion - Installed application version.
 * @param request - Desktop's proxy-aware fetch transport.
 * @returns Highest published semantic version and whether it is newer.
 */
export async function checkCommunityRelease(
  currentVersion: string, request: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<CommunityRelease> {
  const response = await request('https://api.github.com/repos/Missher12/Missher-DeepseekHarness-Desktop/releases?per_page=30', {
    headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`Release check failed (${response.status})`)
  const data: unknown = await response.json()
  if (!Array.isArray(data)) throw new Error('Invalid release list')
  const versions = data.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null || !('tag_name' in item)
      || !('draft' in item) || item.draft !== false || typeof item.tag_name !== 'string') return []
    const tag = item.tag_name
    if (!tag.startsWith('desktop-v')) return []
    const version = valid(tag.slice(9))
    return version === null ? [] : [{ version, tag }]
  }).sort((left, right) => rcompare(left.version, right.version))
  const latest = versions[0]
  if (latest === undefined) throw new Error('No published Harness release found')
  return {
    version: latest.version,
    url: `https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/${encodeURIComponent(latest.tag)}`,
    newer: gt(latest.version, currentVersion),
  }
}
