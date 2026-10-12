import { expect, it, vi } from 'vitest'
import { checkCommunityRelease } from '../src/community-update.ts'

it('selects the highest published Harness release including RCs and constructs a trusted notes URL', async () => {
  const request = vi.fn<typeof fetch>(async () => Response.json([
    { tag_name: 'desktop-v0.2.0-rc.2', draft: false, html_url: 'https://untrusted.invalid' },
    { tag_name: 'desktop-v0.2.0-rc.1', draft: false },
    { tag_name: 'desktop-v9.0.0', draft: true },
    { tag_name: 'other-v9.0.0', draft: false },
    { tag_name: 'desktop-vbroken', draft: false },
    null,
  ]))
  expect(await checkCommunityRelease('0.2.0-rc.1', request)).toEqual({
    version: '0.2.0-rc.2', newer: true,
    url: 'https://github.com/Missher12/Missher-DeepseekHarness-Desktop/releases/tag/desktop-v0.2.0-rc.2',
  })
  const [url, init] = request.mock.calls[0]!
  expect(url).toContain('/Missher12/Missher-DeepseekHarness-Desktop/releases?')
  expect(init?.signal).toBeInstanceOf(AbortSignal)
  expect((await checkCommunityRelease('0.3.0', request)).newer).toBe(false)
})

it('reports network and invalid-feed failures instead of claiming the app is current', async () => {
  await expect(checkCommunityRelease('0.1.0', async () => new Response(null, { status: 503 }))).rejects.toThrow('503')
  await expect(checkCommunityRelease('0.1.0', async () => Response.json({ message: 'limited' }))).rejects.toThrow('Invalid release list')
  await expect(checkCommunityRelease('0.1.0', async () => Response.json([]))).rejects.toThrow('No published')
  await expect(checkCommunityRelease('0.1.0', () => Promise.reject(new Error('offline')))).rejects.toThrow('offline')
})
