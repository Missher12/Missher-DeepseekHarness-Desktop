import { describe, expect, it } from 'vitest'
import { checkCommunityRelease, isCommunityDistribution } from '../src/community-update.ts'

/** Release-list transport with the fields the check reads. */
function transport(tags: readonly string[], draft = false) {
  return async () => new Response(JSON.stringify(tags.map(tag => ({ tag_name: tag, draft }))), {
    status: 200, headers: { 'content-type': 'application/json' },
  })
}

describe('community update release check', () => {
  it('reports the newest published build and whether it is newer', async () => {
    const releases = ['desktop-v0.2.0', 'desktop-v0.2.1-rc.2.20261017.1', 'desktop-v0.2.1-rc.1']
    await expect(checkCommunityRelease('0.2.0', transport(releases))).resolves.toMatchObject({
      version: '0.2.1-rc.2.20261017.1',
      url: 'https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/desktop-v0.2.1-rc.2.20261017.1',
      newer: true,
    })
    await expect(checkCommunityRelease('0.2.1-rc.2.20261017.1', transport(releases)))
      .resolves.toMatchObject({ newer: false })
  })

  it('detects only an explicit community manifest marker', () => {
    expect(isCommunityDistribution({ dshCommunityDistribution: true })).toBe(true)
    expect(isCommunityDistribution({ dshCommunityDistribution: 'true' })).toBe(false)
    expect(isCommunityDistribution({})).toBe(false)
    expect(isCommunityDistribution(null)).toBe(false)
  })

  it('rejects a failed transport and a malformed JSON body without a fake version', async () => {
    await expect(checkCommunityRelease('0.2.0', async () => { throw new Error('offline') }))
      .rejects.toThrow(/offline/u)
    await expect(checkCommunityRelease('0.2.0', async () => new Response('{not json', { status: 200 })))
      .rejects.toThrow()
  })

  it('ignores drafts and rejects a release list without a published build', async () => {
    await expect(checkCommunityRelease('0.2.0', transport(['desktop-v0.2.1'], true)))
      .rejects.toThrow(/No published Harness release/u)
    await expect(checkCommunityRelease('0.2.0', async () => new Response('not json', { status: 500 })))
      .rejects.toThrow(/Release check failed/u)
  })
})
