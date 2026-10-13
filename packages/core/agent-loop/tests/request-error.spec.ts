import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LlmRuntime, { createUserMessage, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, ImageBlock } from '@deepseek-ai/dsh-llm'
import type { LlmFailure, ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse } from './mock-adapter.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'handoff-bridge': { kind: 'handoff-bridge' } & ContextFormed
    'handoff-system': { kind: 'handoff-system' } & ContextFormed
  }
}

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function fail(message: string, code: string): () => never {
  return () => {
    throw new LlmError(message, code)
  }
}

describe('agent/request-error', () => {
  it('does not offer middleware failures to request recovery', async () => {
    const adapter = new MockAdapter([textResponse('unused')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('request-error-narrow'), { provider: 'mock', model: 'mock' })
    let recoveries = 0
    ctx.on('agent/request', () => {
      throw new LlmError('middleware failed', 'MIDDLEWARE')
    })
    ctx.on('agent/request-error', async () => {
      recoveries += 1
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(recoveries).toBe(0)
    expect(adapter.requests).toHaveLength(0)
  })

  it('lets each failed request return a retry action before its turn closes', async () => {
    const adapter = new MockAdapter([
      fail('busy', 'RATE_LIMIT'),
      fail('unavailable', 'SERVICE_UNAVAILABLE'),
      textResponse('ok'),
    ])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('request-error-retry'), { provider: 'mock', model: 'mock' })
    const seen: {
      turn: number
      step: number
      failure: LlmFailure
      retryPolicy: ResolvedRetryPolicy | undefined
    }[] = []
    const statuses: string[] = []
    ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent) statuses.push(status)
    })
    ctx.on('agent/request-error', async ({ agent: subject, turn, step, failure, retryPolicy }) => {
      expect(subject).toBe(agent)
      seen.push({ turn, step, failure, retryPolicy })
      return { kind: 'retry' }
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(seen.map(item => ({
      turn: item.turn,
      step: item.step,
      code: item.failure.code,
    }))).toEqual([
      {
        turn: 1,
        step: 1,
        code: 'RATE_LIMIT',
      },
      {
        turn: 1,
        step: 1,
        code: 'SERVICE_UNAVAILABLE',
      },
    ])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(seen.map(item => item.retryPolicy)).toEqual([
      expect.objectContaining({ mode: 'normal' }),
      expect.objectContaining({ mode: 'normal' }),
    ])
    expect(statuses).toEqual(['running', 'idle'])
    expect(agent.session.snapshotEvents().flatMap(event =>
      event.type === 'request/header' ? [event.data.reason] : [])).toEqual(['initial'])
  })

  it('lets cancellation win over a retry action', async () => {
    const adapter = new MockAdapter([fail('busy', 'RATE_LIMIT'), textResponse('unused')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('request-error-cancel'), { provider: 'mock', model: 'mock' })
    ctx.on('agent/request-error', async ({ agent: subject }) => {
      subject.cancel({ kind: 'user' })
      return { kind: 'retry' }
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(agent.session.snapshotEvents().find(event => event.type === 'turn/end')).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'aborted', reason: { kind: 'user' } } },
    })
  })

  it('advertises handoff and advances to queued next-step input without retrying the failed request', async () => {
    const adapter = new MockAdapter([
      () => { throw new LlmError('context changed', 'CONTEXT_CHANGED') },
      textResponse('continued with steering'),
    ])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('request-error-handoff-step'), { provider: 'mock', model: 'mock' })
    expect(agent.supportsRequestErrorHandoff).toBe(true)
    let recoveries = 0
    ctx.on('agent/request-error', async ({ agent: subject }) => {
      recoveries++
      subject.steer(createUserMessage({ content: [{ type: 'text', text: 'new next-step instruction' }], source: { kind: 'handoff-bridge' } }))
      return { kind: 'handoff' }
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'original task' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    const log = agent.session.snapshotEvents()
    expect(recoveries).toBe(1)
    expect(adapter.requests).toHaveLength(2)
    expect(log.filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(log.filter(event => event.type === 'step/start')).toHaveLength(2)
    expect(log.filter(event => event.type === 'user/message').map(event => event.type === 'user/message' ? event.data.content[0] : undefined))
      .toEqual([{ type: 'text', text: 'original task' }, { type: 'text', text: 'new next-step instruction' }])
    expect(log.findLast(event => event.type === 'turn/end')).toMatchObject({ data: { reason: { kind: 'completed' } } })
  })

  it('ends the failed turn and starts queued next-turn input without replay', async () => {
    const adapter = new MockAdapter([
      () => { throw new LlmError('context changed', 'CONTEXT_CHANGED') },
      textResponse('next turn complete'),
    ])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('request-error-handoff-turn'), { provider: 'mock', model: 'mock' })
    const queued = createUserMessage({ content: [{ type: 'text', text: 'queued bridge task' }], source: { kind: 'handoff-bridge' } })
    ctx.on('agent/request-error', async ({ agent: subject }) => {
      subject.followup(queued)
      return { kind: 'handoff' }
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'original task' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    const log = agent.session.snapshotEvents()
    expect(adapter.requests).toHaveLength(2)
    expect(log.filter(event => event.type === 'turn/start')).toHaveLength(2)
    expect(log.filter(event => event.type === 'turn/end').map(event => event.data.reason.kind)).toEqual(['aborted', 'completed'])
    expect(log.find(event => event.type === 'turn/end')?.data.reason).toEqual({
      kind: 'aborted', reason: { kind: 'hook', reason: 'queued inbox handoff' },
    })
    expect(log.filter(event => event.type === 'user/message' && event.data.id === queued.id)).toHaveLength(1)
    expect(adapter.requests[1]!.messages.find(message => message.id === queued.id)?.content).toEqual(queued.content)
  })

  it('delivers consecutive bridge and attached messages before a queued next-turn task', async () => {
    const adapter = new MockAdapter([
      () => { throw new LlmError('context changed', 'CONTEXT_CHANGED') },
      textResponse('next-step complete'),
      textResponse('next-turn complete'),
    ])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('request-error-handoff-mixed'), { provider: 'mock', model: 'mock' })
    const bridge = createUserMessage({ content: [{ type: 'text', text: 'bridge message' }], source: { kind: 'handoff-bridge' } })
    const attached = createUserMessage({ content: [
      { type: 'text', text: 'attachment message' },
      { type: 'image', attachment: { attachmentId: `sha256:${'b'.repeat(64)}` as ImageBlock['attachment']['attachmentId'], mediaType: 'image/png', bytes: 32, width: 8, height: 8 } },
    ], source: { kind: 'handoff-system' } })
    const followup = createUserMessage({ content: [{ type: 'text', text: 'queued next turn' }], source: { kind: 'handoff-bridge' } })
    let recoveries = 0
    ctx.on('agent/request-error', async ({ agent: subject }) => {
      recoveries++
      subject.inject(bridge)
      subject.steer(attached)
      subject.followup(followup)
      return { kind: 'handoff' }
    })

    const original = createUserMessage({ content: [{ type: 'text', text: 'original task' }], source: { kind: 'user' } })
    agent.followup(original)
    await agent.whenIdle()

    const log = agent.session.snapshotEvents()
    expect(recoveries).toBe(1)
    expect(adapter.requests).toHaveLength(3)
    expect(log.filter(event => event.type === 'user/message').map(event => event.data.id))
      .toEqual([original.id, bridge.id, attached.id, followup.id])
    expect(log.filter(event => event.type === 'turn/start')).toHaveLength(2)
    expect(log.filter(event => event.type === 'turn/end').map(event => event.data.reason.kind)).toEqual(['completed', 'completed'])
    expect(adapter.requests[1]!.messages.find(message => message.id === attached.id)?.content).toEqual(attached.content)
    expect(adapter.requests[2]!.messages.find(message => message.id === followup.id)?.content).toEqual(followup.content)
    for (const message of [original, bridge, attached, followup]) {
      expect(log.filter(event => event.type === 'user/message' && event.data.id === message.id)).toHaveLength(1)
    }
  })

  it('lets explicit user cancellation win over a requested handoff', async () => {
    const adapter = new MockAdapter([
      () => { throw new LlmError('context changed', 'CONTEXT_CHANGED') },
      textResponse('must not run'),
    ])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('request-error-handoff-cancel'), { provider: 'mock', model: 'mock' })
    const queued = createUserMessage({ content: [{ type: 'text', text: 'queued but cancelled' }], source: { kind: 'user' } })
    ctx.on('agent/request-error', async ({ agent: subject }) => {
      subject.followup(queued)
      subject.cancel({ kind: 'user' }, { keepInbox: true })
      return { kind: 'handoff' }
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'original task' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')?.data.reason)
      .toEqual({ kind: 'aborted', reason: { kind: 'user' } })
    expect(agent.inbox.nextTurn.map(message => message.content)).toEqual([[{ type: 'text', text: 'queued but cancelled' }]])
  })

  it('restores a claimed handoff message when agent/request cancels with keepInbox', async () => {
    const adapter = new MockAdapter([
      () => { throw new LlmError('route changed', 'CONTEXT_CHANGED') },
      textResponse('must not run'),
    ])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('request-error-handoff-cancel-request'), { provider: 'mock', model: 'mock' })
    const queued = createUserMessage({ content: [{ type: 'text', text: 'claimed bridge input' }], source: { kind: 'handoff-bridge' } })
    ctx.on('agent/request-error', async ({ agent: subject }) => {
      subject.steer(queued)
      return { kind: 'handoff' }
    })
    ctx.on('agent/request', async ({ agent: subject, step }, next) => {
      if (subject === agent && step === 2) subject.cancel({ kind: 'user' }, { keepInbox: true })
      return next()
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'original task' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    expect(agent.inbox.nextStep.map(message => message.id)).toEqual([queued.id])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.id === queued.id)).toHaveLength(0)
    expect(agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')?.data.reason)
      .toEqual({ kind: 'aborted', reason: { kind: 'user' } })
  })

  it('restores a claimed handoff message when prepareCall cancels with keepInbox', async () => {
    const adapter = new MockAdapter([
      () => { throw new LlmError('route changed', 'CONTEXT_CHANGED') },
      textResponse('must not run'),
    ])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('request-error-handoff-cancel-prepare-call'), { provider: 'mock', model: 'mock' })
    const queued = createUserMessage({ content: [{ type: 'text', text: 'claimed bridge input' }], source: { kind: 'handoff-bridge' } })
    ctx.on('agent/request-error', async ({ agent: subject }) => {
      subject.steer(queued)
      return { kind: 'handoff' }
    })
    const prepareCall = ctx.llm.prepareCall.bind(ctx.llm)
    let calls = 0
    vi.spyOn(ctx.llm, 'prepareCall').mockImplementation(async (config, signal) => {
      const prepared = await prepareCall(config, signal)
      if (++calls === 2) agent.cancel({ kind: 'user' }, { keepInbox: true })
      return prepared
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'original task' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    expect(agent.inbox.nextStep.map(message => message.id)).toEqual([queued.id])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.id === queued.id)).toHaveLength(0)
    expect(agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')?.data.reason)
      .toEqual({ kind: 'aborted', reason: { kind: 'user' } })
  })

  it('keeps an unlogged handoff message queued when request preparation fails before dispatch', async () => {
    const adapter = new MockAdapter([
      () => { throw new LlmError('route changed', 'CONTEXT_CHANGED') },
      textResponse('must not run'),
    ])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('request-error-handoff-prepare-failure'), { provider: 'mock', model: 'mock' })
    const queued = createUserMessage({ content: [{ type: 'text', text: 'claimed bridge input' }], source: { kind: 'handoff-bridge' } })
    ctx.on('agent/request-error', async ({ agent: subject }) => {
      subject.steer(queued)
      return { kind: 'handoff' }
    })
    const prepareCall = ctx.llm.prepareCall.bind(ctx.llm)
    let calls = 0
    vi.spyOn(ctx.llm, 'prepareCall').mockImplementation(async (config, signal) => {
      if (++calls === 2) throw new Error('prepared route is unavailable')
      return prepareCall(config, signal)
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'original task' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    expect(agent.inbox.nextStep.map(message => message.id)).toEqual([queued.id])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.id === queued.id)).toHaveLength(0)
    expect(agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')?.data.reason?.kind).toBe('error')
  })

  it('does not requeue input already committed before a retry preparation cancellation', async () => {
    const adapter = new MockAdapter([
      () => { throw new LlmError('temporary route failure', 'CONTEXT_CHANGED') },
      textResponse('must not run'),
    ])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('request-error-retry-cancel-prepare'), { provider: 'mock', model: 'mock' })
    ctx.on('agent/request-error', async () => ({ kind: 'retry' }))
    const prepareCall = ctx.llm.prepareCall.bind(ctx.llm)
    let calls = 0
    vi.spyOn(ctx.llm, 'prepareCall').mockImplementation(async (config, signal) => {
      const prepared = await prepareCall(config, signal)
      if (++calls === 2) agent.cancel({ kind: 'user' }, { keepInbox: true })
      return prepared
    })
    const original = createUserMessage({ content: [{ type: 'text', text: 'already committed input' }], source: { kind: 'user' } })

    agent.followup(original)
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    expect(agent.inbox.nextStep.length + agent.inbox.nextTurn.length).toBe(0)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.id === original.id)).toHaveLength(1)
    expect(agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')?.data.reason)
      .toEqual({ kind: 'aborted', reason: { kind: 'user' } })
  })

  it('does not retry when the recovery listener fails before returning its action', async () => {
    const adapter = new MockAdapter([fail('busy', 'RATE_LIMIT'), textResponse('unused')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('request-error-recovery-failed'), {
      provider: 'mock',
      model: 'mock',
    })
    ctx.on('agent/request-error', async () => {
      throw new Error('recovery failed')
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(agent.session.snapshotEvents().find(event => event.type === 'turn/end')).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'error' } },
    })
  })
})
