import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader, { type EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import { harness as presetHarness, declare, agentOn } from '../../../preset/agent-preset-registry/tests/harness.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import Inventory from '../src/index.ts'
import ReferenceResolver from '../src/reference-plugin.ts'
import { describePluginReference, formatPluginReferenceMention, parsePluginReferenceText, pluginInstanceId } from '../src/reference.ts'

const roots: Context[] = []
const signal = new AbortController().signal
afterEach(async () => { for (const ctx of roots.splice(0).reverse()) await ctx.fiber.dispose() })

async function add(ctx: Context, row: EntryOptions) { return ctx.loader.create(row) }

async function scoped(ctx: Context, key: object): Promise<Scope> {
  let scope!: Scope
  await ctx.plugin({ inject: ['tools', 'systemPrompt', 'loader'], apply(inner: Context) { scope = createScope(inner, key) } })
  return scope
}

function tool(name: string): ToolDefinition {
  return {
    name, description: `Use ${name}`, parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async () => name,
  }
}

async function harness() {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(Loader)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Inventory)
  await ctx.plugin(ReferenceResolver)
  ctx.loader.builtins.provider = {
    inject: ['tools'],
    apply(inner: Context, config: { name: string }) { inner.tools.register(tool(config.name)) },
  }
  ctx.loader.builtins.ui = () => {}
  const agent = { id: 'session-a' as SessionId, ctx } as Agent
  return { ctx, agent, inventory: ctx.pluginInventory }
}

describe('canonical plugin references', () => {
  it('round-trips stable identities with Chinese, spaces and embedded @ while preserving other references', () => {
    const id = pluginInstanceId(JSON.stringify(['中文 @ Tool', 'entry @ 中文', ['preset', 'custom']]))
    const mention = formatPluginReferenceMention(id)
    expect(describePluginReference(id)).toEqual({ moduleName: '中文 @ Tool', entryId: 'entry @ 中文' })
    expect(parsePluginReferenceText(`@file @"My Dir/" /skill ${mention} dsh-session:x`))
      .toEqual({ text: '@file @"My Dir/" /skill  dsh-session:x', references: [id] })
    expect(parsePluginReferenceText(mention + mention).references).toEqual([id, id])
  })
  it.each(['@{dsh-plugin:v2:x}', '@{dsh-plugin:v1:%ZZ}', '@{dsh-plugin:v1:x', '@{dsh-plugin:v1:%22label%22}'])(
    'rejects malformed references: %s', (text) => { expect(() => parsePluginReferenceText(text)).toThrow() },
  )
})

describe('live plugin capability ownership', () => {
  it('uses actual Loader ownership, excludes disabled/UI/unowned registrations and invalidates on disposal', async () => {
    const { ctx, agent, inventory } = await harness()
    const changed = vi.fn()
    ctx.on('plugin-capabilities/changed', changed)
    ctx.tools.register(tool('provider_fake_prefix'))
    await add(ctx, { id: 'one', name: 'cordis:provider', config: { name: 'unrelated_name' } })
    await add(ctx, { id: 'two', name: 'cordis:provider', config: { name: 'another_name' } })
    await add(ctx, { id: 'ui', name: 'cordis:ui' })
    await add(ctx, { id: 'disabled', name: 'cordis:provider', disabled: true, config: { name: 'hidden' } })
    const rows = await inventory.candidates(agent, '', signal)
    expect(rows.map(row => row.entryId)).toEqual(['one', 'two'])
    expect(rows[0]?.capabilities[0]).toMatchObject({ name: 'unrelated_name', invocation: 'native' })
    expect(rows[0]?.id).not.toBe(rows[1]?.id)
    const before = changed.mock.calls.length
    await ctx.loader.update('one', { disabled: true })
    expect(changed.mock.calls.length).toBeGreaterThan(before)
    expect(await inventory.candidates(agent, 'unrelated_name', signal)).toEqual([])
    expect(() => inventory.resolveReferences(agent, [rows[0]!.id])).toThrow(/unavailable/)
    await ctx.loader.update('one', { disabled: false })
    expect((await inventory.candidates(agent, 'unrelated_name', signal))[0]?.id).toBe(rows[0]?.id)
    const restarted = await harness()
    await add(restarted.ctx, { id: 'one', name: 'cordis:provider', config: { name: 'unrelated_name' } })
    expect((await restarted.inventory.candidates(restarted.agent, '', signal))[0]?.id).toBe(rows[0]?.id)
  })

  it('tracks the selected registration through scoped shadowing, restrictions and teardown', async () => {
    const { ctx, agent, inventory } = await harness()
    await add(ctx, { id: 'global', name: 'cordis:provider', config: { name: 'shared' } })
    let local!: Scope
    ctx.loader.builtins.local = {
      inject: ['tools'],
      apply(inner: Context) {
        local = createScope(inner, agent)
        local.ctx.tools.register(tool('shared'))
      },
    }
    await add(ctx, { id: 'local', name: 'cordis:local' })
    expect((await inventory.candidates(agent, '', signal)).map(row => row.entryId)).toEqual(['local'])
    const other = { id: 'other' as SessionId, ctx } as Agent
    expect((await inventory.candidates(other, '', signal)).map(row => row.entryId)).toEqual(['global'])
    await local.dispose()
    expect((await inventory.candidates(agent, '', signal)).map(row => row.entryId)).toEqual(['global'])
    const restriction = await scoped(ctx, agent)
    restriction.ctx.tools.restrict({ deny: ['shared'] })
    expect(await inventory.candidates(agent, '', signal)).toEqual([])
    await restriction.dispose()
    expect((await inventory.candidates(agent, '', signal)).map(row => row.entryId)).toEqual(['global'])
  })

  it('uses stable preset sources across different Agent identities and applies preset switching', async () => {
    const ctx = await presetHarness()
    roots.push(ctx)
    await ctx.plugin(Inventory)
    await ctx.plugin(ReferenceResolver)
    ctx.loader.builtins.provider = {
      inject: ['tools'],
      apply(inner: Context, config: { name: string }) { inner.tools.register(tool(config.name)) },
    }
    for (const id of ['first', 'second']) {
      await declare(ctx, { id, plugins: [{ id: 'same', name: 'cordis:provider', config: { name: 'read' } }] })
    }
    const agent = await agentOn(ctx, 'session-a', 'first')
    const inventory = ctx.pluginInventory
    const row = (await inventory.candidates(agent, '', signal))[0]!
    expect(row.presetId).toBe('first')
    const fork = await agentOn(ctx, 'fork', 'first')
    expect((await inventory.candidates(fork, '', signal))[0]?.id).toBe(row.id)
    await ctx.agentPresets.recompose(agent.ctx, 'second')
    expect((await inventory.candidates(agent, '', signal))[0]?.presetId).toBe('second')
    expect(() => inventory.resolveReferences(agent, [row.id])).toThrow(/unavailable/)
  })

  it('prepares only selected-plugin context and refuses a stale mention before a request enters', async () => {
    const { ctx, agent, inventory } = await harness()
    await add(ctx, { id: 'one', name: 'cordis:provider', config: { name: 'read' } })
    await add(ctx, { id: 'two', name: 'cordis:provider', config: { name: 'write' } })
    const row = (await inventory.candidates(agent, 'read', signal))[0]!
    const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: `Use ${row.mention} with @file` }] })
    const decide = () => ctx.waterfall('agent/pre-step', { agent, signal } as never,
      async () => ({ kind: 'enter' as const, messages: [message] }))
    const result = await decide()
    expect(result.kind).toBe('enter')
    if (result.kind !== 'enter') return
    expect(result.messages[0]).toBe(message)
    expect(parsePluginReferenceText((result.messages[0]!.content[0] as { text: string }).text).references).toEqual([row.id])
    expect(result.messages[1]?.source).toEqual({ kind: 'plugin-reference', form: 'instructions', version: 1, instances: [row.id] })
    const guidance = result.messages[1]?.content[0]
    expect(guidance?.type).toBe('text')
    if (guidance?.type !== 'text') return
    expect(guidance.text).toContain('"name":"read"')
    expect(guidance.text).not.toContain('"name":"write"')
    await ctx.loader.update('one', { disabled: true })
    await expect(decide()).rejects.toThrow(/unavailable/)
  })

  it('hides candidates and rejects queued markers when the resolver is disposed', async () => {
    const { ctx, agent, inventory } = await harness()
    await add(ctx, { id: 'one', name: 'cordis:provider', config: { name: 'read' } })
    const row = (await inventory.candidates(agent, '', signal))[0]!
    ctx.registry.delete(ReferenceResolver)
    expect(await inventory.candidates(agent, '', signal)).toEqual([])
    const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: row.mention }] })
    await expect(ctx.waterfall('agent/pre-step', { agent, signal } as never,
      async () => ({ kind: 'enter' as const, messages: [message] }))).rejects.toThrow(/resolver is not active/)
    await ctx.plugin(ReferenceResolver)
    expect((await inventory.candidates(agent, '', signal))[0]?.id).toBe(row.id)
  })

  it('rejects references as soon as Loader disables the resolver, before disposal settles', async () => {
    const { ctx, agent, inventory } = await harness()
    ctx.registry.delete(ReferenceResolver)
    ctx.loader.builtins.resolver = ReferenceResolver
    await add(ctx, { id: 'resolver', name: 'cordis:resolver' })
    await add(ctx, { id: 'one', name: 'cordis:provider', config: { name: 'read' } })
    const row = (await inventory.candidates(agent, '', signal))[0]!
    const resolver = ctx.pluginReferenceResolver
    const pending = ctx.loader.update('resolver', { disabled: true })
    expect(await inventory.candidates(agent, '', signal)).toEqual([])
    expect(() => resolver.validate(agent, [row.id])).toThrow(/resolver is not active/)
    await pending
  })
})
