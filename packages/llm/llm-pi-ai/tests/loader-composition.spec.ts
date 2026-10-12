/** Profile patch edits and credential updates reach the next real adapter request. */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader, { type ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime, { createMessage, createUserMessage, ReasoningEffortId, userAgent } from '@deepseek-ai/dsh-llm'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { profileComposition } from '../../../settings/settings/tests/profile-composition.ts'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

/** One text block, then a tool call truncated by the output-token ceiling. */
const truncatedToolCallEvents = [
  '{"choices":[{"delta":{"role":"assistant","content":""},"index":0,"finish_reason":null}]}',
  '{"choices":[{"delta":{"content":"partial"},"index":0,"finish_reason":null}]}',
  '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"echo","arguments":"{\\"text\\":"}}]},"index":0,"finish_reason":null}]}',
  '{"choices":[{"delta":{},"index":0,"finish_reason":"length"}],"usage":{"prompt_tokens":3,"completion_tokens":4}}',
  '[DONE]',
]

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  await closeMockServers()
  vi.unstubAllEnvs()
})

/** Boot the dormant composition: a bare `llm-pi-ai` row with no config at all. */
async function loadComposition(options: { home?: string; ns?: string } = {}): Promise<{ ctx: Context; settingsPath: string }> {
  root = options.home ?? await mkdtemp(join(tmpdir(), 'dsh-pi-composition-'))
  await writeFile(join(root, '.credentials.yaml'), 'version: 1\nrefs:\n  PI_COMPOSITION_KEY: key-from-store\n', { mode: 0o600 })

  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: llm',
    "  name: 'test-llm-service'",
    '- id: credentials',
    "  name: '@deepseek-ai/dsh-credentials-local'",
    '  config:',
    `    path: ${JSON.stringify(join(root, '.credentials.yaml'))}`,
    '    debounceMs: 10',
    '- id: authorization',
    "  name: '@deepseek-ai/dsh-authorization'",
    `- id: ${options.ns ?? 'llm-pi-ai'}`,
    "  name: '@deepseek-ai/dsh-llm-pi-ai'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['test-llm-service', LlmRuntime],
    ['@deepseek-ai/dsh-credentials-local', LocalCredentialProvider],
    ['@deepseek-ai/dsh-authorization', AuthorizationService],
    ['@deepseek-ai/dsh-llm-pi-ai', LlmPiAi],
  ])
  const internal: ModuleLoaderV2 = {
    version: 'v2',
    loadCache: new Map(),
    import: (specifier: string) => {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return Promise.resolve(modules.get(specifier))
    },
    register(): never { throw new Error('unexpected module hook registration') },
    getOrCreateModuleJob(): never { throw new Error('unexpected module job creation') },
    resolveSync(): never { throw new Error('unexpected synchronous module resolution') },
    load(): never { throw new Error('unexpected module load') },
  }
  ctx.loader.internal = internal
  const patchPath = await profileComposition(ctx, root, configPath)
  return { ctx, settingsPath: patchPath }
}

describe('llm-pi-ai real dormant composition', () => {
  it('persists tri-state capabilities and sparse wire mappings through real settings, reload, and requests', async () => {
    vi.stubEnv('PI_COMPOSITION_KEY', '')
    const ns = 'renamed-pi-instance'
    const server = await mockServer(Array.from({ length: 4 }, () => ({ events: textEvents })))
    const composition = await loadComposition({ ns })
    let { ctx } = composition
    const { settingsPath } = composition
    const home = root!
    const firstMap = { off: null, low: 'light', high: 'deep', max: 'ultra' }
    const profile = { api: 'openai-completions', baseURL: server.url, apiKeyEnv: 'PI_COMPOSITION_KEY', reasoning: 'high',
      models: [{ id: 'same', reasoningEfforts: firstMap, compat: { supportsDeveloperRole: false } }, { id: 'untouched', reasoningEfforts: false }] }
    await ctx.settings.mutate(ns, [{ op: 'set', path: ['providers'], value: {
      a: profile,
      b: { ...profile, models: [{ id: 'same', reasoningEfforts: { off: null, high: 'b-deep' } }] },
      deepseek: { apiKeyEnv: 'PI_COMPOSITION_KEY', baseURL: server.url },
    } }])
    const revision = ctx.settings.describe().find(row => row.ns === ns)!.revision
    const prepared = await ctx.llm.prepareCall({ provider: 'a', model: 'same', reasoningEffort: ReasoningEffortId('max') })
    await ctx.settings.mutate(ns, [{ op: 'set', path: ['providers', 'a', 'models', '0', 'reasoningEfforts'],
      value: { off: null, low: 'light', high: 'deep' } }], revision)
    const disk = await readFile(settingsPath, 'utf8')
    await expect(ctx.settings.mutate(ns, [{ op: 'set', path: ['providers', 'a', 'reasoning'], value: 'max' }], revision)).rejects.toThrow('changed since it was read')
    expect(await readFile(settingsPath, 'utf8')).toBe(disk)
    // A request already prepared owns its immutable configuration snapshot.
    for await (const chunk of prepared.stream({ ...prepared.config, messages: [] })) void chunk
    expect(server.requests[0]).toMatchObject({ reasoning_effort: 'ultra' })
    const refused = await assemble(ctx, { provider: 'a', model: 'same', reasoningEffort: ReasoningEffortId('max'), messages: [] })
    expect(refused.finish.kind).toBe('error')
    expect(server.requests).toHaveLength(1)
    await assemble(ctx, { provider: 'a', model: 'same', reasoningEffort: ReasoningEffortId('high'), messages: [] })
    await assemble(ctx, { provider: 'b', model: 'same', reasoningEffort: ReasoningEffortId('high'), messages: [] })
    expect(server.requests[1]).toMatchObject({ reasoning_effort: 'deep' })
    expect(server.requests[2]).toMatchObject({ reasoning_effort: 'b-deep' })
    expect(server.headers.every(headers => headers.authorization === 'Bearer key-from-store')).toBe(true)
    // A fresh Loader reads the persisted sparse map; unrelated defaults survive.
    await ctx.fiber.dispose()
    ;({ ctx } = await loadComposition({ ns, home }))
    expect(ctx.settings.describe().find(row => row.ns === ns)?.value).toMatchObject({ providers: {
      a: { ...profile, models: [{ ...profile.models[0], reasoningEfforts: { off: null, low: 'light', high: 'deep' } }, profile.models[1]] },
      b: { models: [{ id: 'same', reasoningEfforts: { off: null, high: 'b-deep' } }] },
    } })
    const beforeModels = await ctx.llm.listModels('deepseek')
    const beforeReasoning = (await ctx.llm.resolveModelInfo('deepseek', 'deepseek-v4-flash')).reasoning
    expect(beforeReasoning).toBeDefined()
    await ctx.settings.mutate(ns, [{ op: 'set', path: ['providers', 'deepseek', 'modelOverrides', 'deepseek-v4-flash', 'reasoningEfforts'], value: false }])
    await ctx.fiber.dispose()
    ;({ ctx } = await loadComposition({ ns, home }))
    expect((await ctx.llm.resolveModelInfo('deepseek', 'deepseek-v4-flash')).reasoning).toBeUndefined()
    const disabled = await assemble(ctx, { provider: 'deepseek', model: 'deepseek-v4-flash', reasoningEffort: ReasoningEffortId('high'), messages: [] })
    expect(disabled.finish.kind).toBe('error')
    expect(server.requests).toHaveLength(3)
    await assemble(ctx, { provider: 'deepseek', model: 'deepseek-v4-flash', messages: [] })
    expect(server.requests[3]).not.toHaveProperty('reasoning_effort')
    await ctx.settings.mutate(ns, [{ op: 'unset', path: ['providers', 'deepseek', 'modelOverrides', 'deepseek-v4-flash', 'reasoningEfforts'] }])
    await ctx.fiber.dispose()
    ;({ ctx } = await loadComposition({ ns, home }))
    expect(await ctx.llm.listModels('deepseek')).toEqual(beforeModels)
    expect((await ctx.llm.resolveModelInfo('deepseek', 'deepseek-v4-flash')).reasoning).toEqual(beforeReasoning)
    expect(ctx.settings.describe().find(row => row.ns === ns)?.user).not.toHaveProperty('providers.deepseek.models')
  }, 20_000)

  it('boots with zero routes and registers one the moment settings supply a profile', async () => {
    vi.stubEnv('PI_COMPOSITION_KEY', '')
    const server = await mockServer([{ events: textEvents }])
    const { ctx, settingsPath } = await loadComposition()

    // The shipped posture: the adapter exists, no route does.
    expect(ctx.llm.listProviders()).toEqual([])

    // Exactly what the web Models page leaves on disk.
    await writeFile(settingsPath, [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      deepseek:',
      '        apiKeyEnv: PI_COMPOSITION_KEY',
      `        baseURL: ${server.url}`,
      '',
    ].join('\n'))
    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['deepseek'])
    }, { timeout: 5000 })

    const result = await assemble(ctx, { provider: 'deepseek', model: 'deepseek-flash', messages: [] })
    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(server.headers[0]?.authorization).toBe('Bearer key-from-store')
  })

  it('offers OpenAI sign-in by API key only, while other subscription logins stay', async () => {
    const { ctx } = await loadComposition()
    const methods = (provider: string): string[] | undefined => ctx.authorization.list()
      .find(entry => entry.key === LlmPiAi.recordKeyFor(provider))?.methods.map(method => method.id)

    // pi-ai's Sign in with ChatGPT needs an installation ID the harness does
    // not supply, so the route offers only its key login.
    expect(methods('openai')).toEqual(['api-key'])
    expect(methods('anthropic')).toEqual(['oauth', 'api-key'])
  })

  it('uses settings-only route headers for model discovery', async () => {
    vi.stubEnv('PI_COMPOSITION_KEY', '')
    const server = await mockServer([{ body: JSON.stringify({ data: [{ id: 'acme-private' }] }) }])
    const { ctx, settingsPath } = await loadComposition()

    await writeFile(settingsPath, [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      acme-gateway:',
      '        apiKeyEnv: PI_COMPOSITION_KEY',
      '        api: openai-completions',
      `        baseURL: ${server.url}`,
      '        headers:',
      '          X-Company-Code: private-tenant',
      '          Accept: text/plain',
      '          User-Agent: deployment-owned',
      '        models:',
      '          - id: acme-bootstrap',
      '',
    ].join('\n'))
    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['acme-gateway'])
    }, { timeout: 5000 })

    await expect(ctx.llm.discoverModels('llm-pi-ai', {
      provider: 'acme-gateway',
      baseURL: server.url,
      api: 'openai-completions',
    })).resolves.toEqual([{ id: 'acme-private', name: 'acme-private' }])
    expect(server.paths).toEqual(['/models'])
    expect(server.headers[0]?.['x-company-code']).toBe('private-tenant')
    expect(server.headers[0]?.authorization).toBe('Bearer key-from-store')
    expect(server.headers[0]?.accept).toBe('application/json')
    expect(server.headers[0]?.['user-agent']).toBe(userAgent())
  })

  it('continues natively after max-token assembly drops a tool call, with pruned replay metadata', async () => {
    vi.stubEnv('PI_COMPOSITION_KEY', '')
    const server = await mockServer([
      { events: truncatedToolCallEvents },
      { events: textEvents },
    ])
    const { ctx, settingsPath } = await loadComposition()
    await writeFile(settingsPath, [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      deepseek:',
      '        apiKeyEnv: PI_COMPOSITION_KEY',
      `        baseURL: ${server.url}`,
      '',
    ].join('\n'))
    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['deepseek'])
    }, { timeout: 5000 })

    const truncated = await assemble(ctx, {
      provider: 'deepseek',
      model: 'deepseek-flash',
      messages: [],
    })
    expect(truncated.finish).toEqual({ kind: 'max-tokens' })
    expect(truncated.message.content).toEqual([{ type: 'text', text: 'partial' }])
    expect(truncated.message.source).toEqual({
      kind: 'model',
      provider: 'deepseek',
      model: 'deepseek-flash',
      replayState: {
        response: {
          kind: 'pi-ai',
          version: 2,
          api: 'openai-completions',
          provider: 'deepseek',
          model: 'deepseek-flash',
          stopReason: 'length',
        },
        blocks: [{ type: 'text' }],
      },
    })

    const continued = await assemble(ctx, {
      provider: 'deepseek',
      model: 'deepseek-flash',
      messages: [
        truncated.message,
        createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }),
      ],
    })
    expect(continued.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(server.requests).toHaveLength(2)
    expect(server.requests[1]).toMatchObject({
      messages: [
        { role: 'assistant', content: 'partial' },
        { role: 'user', content: 'continue' },
      ],
    })
    const followup = server.requests[1] as { messages?: unknown[] }
    expect(followup.messages?.[0]).not.toHaveProperty('tool_calls')
  })

  it('continues a legacy session whose stored replay state no longer matches its content', async () => {
    vi.stubEnv('PI_COMPOSITION_KEY', '')
    const server = await mockServer([{ events: textEvents }])
    const { ctx, settingsPath } = await loadComposition()
    await writeFile(settingsPath, [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      deepseek:',
      '        apiKeyEnv: PI_COMPOSITION_KEY',
      `        baseURL: ${server.url}`,
      '',
    ].join('\n'))
    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['deepseek'])
    }, { timeout: 5000 })

    // A pre-envelope session log entry: max-token assembly dropped the tool
    // call from content while the flat v1 state still describes both blocks.
    const poisoned = createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'partial' }],
      source: {
        kind: 'model',
        ...{
          provider: 'deepseek',
          model: 'deepseek-flash',
          replayState: {
            kind: 'pi-ai',
            version: 1,
            api: 'openai-completions',
            provider: 'deepseek',
            model: 'deepseek-flash',
            stopReason: 'length',
            blocks: [{ type: 'text' }, { type: 'tool-call' }],
          },
        },
      },
    })
    const continued = await assemble(ctx, {
      provider: 'deepseek',
      model: 'deepseek-flash',
      messages: [
        poisoned,
        createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }),
      ],
    })
    expect(continued.finish).toEqual({ kind: 'stop' })
    expect(continued.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(server.requests[0]).toMatchObject({
      messages: [
        { role: 'assistant', content: 'partial' },
        { role: 'user', content: 'continue' },
      ],
    })
  })
})
