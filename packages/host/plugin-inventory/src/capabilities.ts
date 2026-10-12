/** Agent-scoped projection of actual tool registration owners onto Loader identities. */
import { FiberState, type Context, type Fiber } from '@deepseek-ai/cordis'
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-tools'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { formatPluginReferenceMention, pluginInstanceId } from './reference.ts'
import type { CapabilityCatalogConfig, PluginCapabilityCandidate, PluginCapabilityId, PluginEntryId } from './types.ts'

/** Find the configured entry whose fiber owns this actual registration. */
function entryOf(fiber: Fiber): Entry | undefined {
  for (;;) {
    if (fiber.entry !== undefined) return fiber.entry
    const parent = fiber.parent.fiber
    if (parent === fiber) return undefined
    fiber = parent
  }
}

/**
 * Project live scoped registrations without interpreting tool names or package labels.
 * @param ctx - Host context with Loader and optional preset registry.
 * @param agent - actual Agent whose registry restrictions and preset select visibility.
 * @param config - limits resolved by the inventory's Config schema.
 * @returns one bounded summary per active, identifiable Loader owner.
 * @throws RemoteError when the Agent has no tool registry.
 */
export function readPluginCapabilities(
  ctx: Context,
  agent: Agent,
  config: Required<CapabilityCatalogConfig>,
): PluginCapabilityCandidate[] {
  const tools = ctx.get('agentPresets')?.serviceFor(agent, 'tools') ?? ctx.get('tools')
  if (tools === undefined) throw new RemoteError('gateway/internal', 'The session tool registry is unavailable', {})
  const catalog = tools.catalog(agent)
  const hostEntries = new Set(ctx.loader.entries())
  const rows = new Map<string, PluginCapabilityCandidate>()
  for (const { definition, context } of catalog.registrations) {
    const entry = entryOf(context.fiber)
    if (entry === undefined || entry.options.group || entry.disabled
      || entry.fiber?.state !== FiberState.ACTIVE || context.fiber.state !== FiberState.ACTIVE) continue
    const presetId = ctx.get('agentPresets')?.presetForTree(agent.ctx, entry.parent.tree)
    // Unknown ad-hoc trees cannot claim a stable profile or preset namespace.
    if (presetId === undefined && !hostEntries.has(entry)) continue
    const origin = presetId !== undefined ? ['preset', presetId] : 'host'
    const id = pluginInstanceId(JSON.stringify([entry.options.name, entry.id, origin]))
    const previous = rows.get(id)
    const capability = {
      id: JSON.stringify([id, 'tool', definition.name]) as PluginCapabilityId,
      name: definition.name,
      description: definition.description.slice(0, config.descriptionMaxChars),
      invocation: catalog.mode,
    }
    const capabilities = previous?.capabilities ?? []
    const base = entry.parent.tree.ctx.baseUrl
    const meta = base === undefined ? undefined : ctx.get('pluginPackages')?.metaOf(entry.options.name, base)
    const title = meta?.title
    rows.set(id, {
      id,
      label: typeof title === 'string' ? title : title?.en ?? entry.options.name,
      description: '',
      mention: formatPluginReferenceMention(id),
      moduleName: entry.options.name,
      entryId: entry.id as PluginEntryId,
      ...meta === undefined ? {} : { meta },
      ...presetId === undefined ? {} : { presetId: presetId },
      capabilities: capabilities.length < config.toolLimit ? [...capabilities, capability] : capabilities,
      capabilityCount: (previous?.capabilityCount ?? 0) + 1,
    })
  }
  return [...rows.values()].map(row => ({
    ...row,
    description: row.capabilities.map(tool => tool.name).join(', ').slice(0, config.descriptionMaxChars),
  }))
}
