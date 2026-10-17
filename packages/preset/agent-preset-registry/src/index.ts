/** Declarative Agent capability sets, activation and session binding. */
import { Context, FiberState, type Fiber } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { bindScopeParent, createScope, scopeOf, scopeParentOf, type Scope, type ScopeKey, type ScopeParentBinding } from '@deepseek-ai/dsh-scope'
import type { EntryTree } from '@deepseek-ai/cordis-plugin-loader'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { dump } from 'js-yaml'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  COMPOSITION_OWNER_GUARD_VERSION, presetEnhancementOrigin, provideCompositionOwnerGuard,
  type CompositionOwnerBlock, type CompositionOwnerGuard, type CompositionOwnerOutcome, type CompositionOwnerRole,
  type PresetEnhancementOrigin, type ProposedCompositionChange,
} from '@deepseek-ai/dsh-app-boot'
// Type-only: the optional `settings` service this registry keeps off the generated pages.
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-tools'
import type { AgentPresetDocument, AgentPresetRoster } from './types.ts'
import { entryListProblem, packageIdentity, PRESET_DECLARATION_MODULE, type PresetDeclarationIdentity, type PresetDefinition } from './definition.ts'
import { BASIC_COMPACTION_PROVIDER, planCompactionSubstitution } from './compaction-provider.ts'
import { COMPACTION_HOST_VERSION, type AgentPresetBinding, type CompactionHostCapability, type CompactionHostRequirement, type CompactionProviderRegistration, type CompactionRegistration, type PresetCompactionState } from './compaction-host.ts'
import type { AgentPreset, Config } from './preset.ts'
import { agentPresetProjectionDefinition } from './session.ts'
import { auditRows, leakedServices, mountPreset, serviceForMount, type PresetMount } from './mount.ts'
import { activeCompositionModules, definitionComposition, mountedCompositionRows, type AgentPresetComposition, type AgentPresetInspection } from './composition-inventory.ts'

export { agentPresetProjectionDefinition } from './session.ts'
export { entryListProblem, packageIdentity, PRESET_DECLARATION_MODULE, type PresetDeclarationIdentity, type PresetDefinition } from './definition.ts'
export { auditRows, leakedServices, withinFiber, type PresetMount, type RowAudit } from './mount.ts'
export { BASIC_COMPACTION_PROVIDER, planCompactionSubstitution, replaceCompactionProvider, type CompactionPlan } from './compaction-provider.ts'
export { COMPACTION_HOST_VERSION, type AgentPresetBinding, type CompactionHostCapability, type CompactionHostRequirement, type CompactionProviderRegistration, type CompactionRegistration, type PresetCompactionState } from './compaction-host.ts'
export type { AgentPresetInspection } from './composition-inventory.ts'
export type { AgentPreset, Config } from './preset.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentPresets: AgentPresetRegistry
  }
}

/** One live revision and the owners it depends on. */
interface Generation {
  scope: Scope
  key: ScopeKey
  mount: PresetMount
  users: number
  retired: boolean
  /** Monotonic ordinal of this revision, stable for the life of the process. */
  ordinal: number
  /** How this revision supplies automatic compaction. */
  compaction: PresetCompactionState
  /** Patch-local row id of the declaring row, the id profile layers target. */
  declarationPatchId: string | undefined
  /** Hierarchical Loader entry id of the declaring row. */
  declarationEntryId: string | undefined
  /**
   * Declaring row's own fiber; identity is compared, so a replacement row never
   * counts as this owner. Only a revision a registration enhanced depends on
   * it: a declared revision is retained by the registry's own scope and keeps
   * serving after that fiber retires.
   */
  declarationFiber: Fiber | undefined
  /** Registration identity that selected this revision's provider, when one did. */
  registrationOrigin?: string
  /** Revision string of the registration that selected this revision's provider. */
  registrationRevision?: string
  /** Host rows and modules the selecting registration declared it needs. */
  registrationRequirements: readonly CompactionHostRequirement[]
  /** Fiber of the plugin that registered this revision's provider. */
  registrationFiber?: Fiber
  /** Hierarchical Loader entry id of the registering plugin, when it is a Loader row. */
  registrationOwnerEntryId?: string
  /** Patch-local row id of the registering plugin, when it is a Loader row. */
  registrationOwnerPatchId?: string
  /** Host fibers that satisfied the registration's requirements when this revision was published. */
  registrationRequirementFibers: readonly Fiber[]
  /** Fiber each declared requirement was captured with, keyed by its identity. */
  capturedRequirements: ReadonlyMap<string, Fiber>
  /** Fiber of the row that mounts this revision's selected provider; undefined for a declared composition. */
  providerFiber: Fiber | undefined
}

/** Barrier holding new bindings of one revision while a composition change is applied. */
interface Suspension {
  count: number
  readonly released: Promise<void>
  release(): void
}

/** One composition change in flight, with the owners it touches. */
interface Transaction {
  readonly rows: ReadonlySet<string>
  readonly modules: ReadonlySet<string>
  readonly fibers: readonly Fiber[]
  readonly unbounded: boolean
  readonly released: Promise<void>
}

interface Definition {
  config: PresetDefinition
  context: Context
  ready: Promise<void>
  generation?: Generation
  /** Mount failure; unset while a tree is mounted, whose rows {@link AgentPresetRegistry.diagnostic} re-audits on read. */
  broken?: string
  /** Real Loader identity of the declaring row, when the declaration came from one. */
  identity: PresetDeclarationIdentity
  /** Declaring row's own fiber, captured for identity-based liveness. */
  declarationFiber: Fiber | undefined
  /** Composition origin of the declaration, when the runtime read profile layers for it. */
  origin: PresetEnhancementOrigin | undefined
  /** Structured outcome of the declared compaction provider. */
  compaction: PresetCompactionState
}
interface Binding {
  parent: ScopeParentBinding
  generation: Generation
}

/** One selection attempt's captured decision, re-checked before it may commit anything. */
interface AttemptToken {
  readonly record: Definition
  readonly epoch: number
  readonly origin: PresetEnhancementOrigin | undefined
}

/** Stable identity of one declared requirement, used to keep its captured fiber. */
function requirementKey(requirement: CompactionHostRequirement): string {
  return `${requirement.rowId ?? ''}|${requirement.module ?? ''}`
}

/** One mounted candidate beside the rows its own subtree is still waiting for. */
interface MountedCandidate {
  readonly ok: true
  readonly generation: Generation
  readonly pending: readonly string[]
}

/** The service names its own rows are still waiting for, one diagnostic line per pending row. */
async function pendingRows(tree: PresetMount['tree']): Promise<readonly string[]> {
  const audit = await auditRows(tree)
  return audit.pending
}

/** The fiber of the row that mounts one provider module inside a retained revision. */
function providerRowFiber(mount: PresetMount, provider: string): Fiber | undefined {
  for (const entry of mount.tree.entries()) {
    if (entry.options.name === provider && entry.fiber !== undefined) return entry.fiber
  }
  return undefined
}

/** The origin revision a compaction decision carries, when a profile layer recorded one. */
function originRevision(origin: PresetEnhancementOrigin | undefined): { revision?: number } {
  return origin === undefined ? {} : { revision: origin.revision }
}

/** Registry of YAML-declared presets and the revisions live Agents retain. */
export class AgentPresetRegistry extends TypertRemoteService {
  static inject = ['loader', 'sessionProjections']
  static Config = z.object({
    default: z.string().required(),
    selectedDefault: z.string().volatile(),
  })
  private readonly owner: Context
  private readonly definitions = new Map<string, Definition>()
  private readonly generations = new Map<ScopeKey, Generation>()
  private readonly bindings = new WeakMap<ScopeKey, Binding>()
  private readonly switches = new Map<string, Promise<unknown>>()
  /** Revisions whose new bindings wait for the composition change that holds them. */
  private readonly suspensions = new Map<Generation, Suspension>()
  /** Composition changes in flight, by the owners they touch. */
  private readonly transactions = new Set<Transaction>()
  /** Monotonic ordinal assigned to each mounted revision. */
  private ordinal = 0
  /** Monotonic revision of the retained-owner set the guard reports. */
  private retained = 0
  /** Registration future revisions select, and the epoch that invalidates a candidate mounting from it. */
  private selected: CompactionRegistration | undefined
  private registrationEpoch = 0
  /** Versioned surface a compaction provider integration registers through. */
  readonly compactionHost: CompactionHostCapability
  private readonly guard: CompositionOwnerGuard

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'agentPresets')
    this.owner = ctx
    ctx.sessionProjections.register(agentPresetProjectionDefinition)
    ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
    ctx.on('session/event', (session, event) => {
      if (event.type === 'agent-preset/selected') ctx.emit('agent-preset/selected', session.id, event.data.agentPreset)
    })
    this.compactionHost = {
      version: COMPACTION_HOST_VERSION,
      // Installed below: a getter in this literal would read the capability
      // object, and `selected` must be read from this registry.
      selected: undefined,
      register: (owner, registration) => this.registerProvider(owner, registration),
      bindingFor: agentCtx => this.describeBinding(this.generationFor(agentCtx)),
      retained: () => [...this.generations.values()].flatMap((generation) => {
        const binding = this.describeBinding(generation)
        return binding === undefined ? [] : [binding]
      }),
    }
    Object.defineProperty(this.compactionHost, 'selected', { enumerable: true, get: () => this.selected })
    this.guard = {
      version: COMPOSITION_OWNER_GUARD_VERSION,
      revision: 0,
      exclusive: (change, run) => this.exclusive(change, run),
    }
    Object.defineProperty(this.guard, 'revision', { enumerable: true, get: () => this.retained })
    ctx.effect(() => provideCompositionOwnerGuard(ctx, this.guard), 'agent-preset.owner-guard')
  }

  /**
   * The declaration's current origin, read from the applied composition.
   *
   * The decision is never cached on the definition: a later reconcile can
   * withdraw the voucher for a row whose effective configuration did not
   * change, so every selection reads the origin it is about to rely on.
   */
  private currentOrigin(record: Definition): PresetEnhancementOrigin | undefined {
    return presetEnhancementOrigin(this.owner.get('profileContext'), record.identity.patchId)
  }

  /**
   * Publish one provider registration and re-prepare the revisions already declared.
   *
   * The selection is attributed to the registering plugin's own context, whose
   * unload withdraws it. Another owner's or another module's live registration
   * is refused rather than overwritten, and a candidate whose mount finishes
   * after a withdrawal or a replacement re-reads the epoch before publishing.
   */
  private async registerProvider(
    owner: Context, registration: CompactionProviderRegistration,
  ): Promise<CompactionRegistration> {
    const { origin, revision, module } = registration
    if (origin.trim() === '') throw new Error('A compaction provider registration needs an origin')
    if (revision.trim() === '') throw new Error('A compaction provider registration needs a revision')
    if (module.trim() === '') throw new Error('A compaction provider registration needs a module')
    if (registration.presets.length === 0) {
      throw new Error('A compaction provider registration needs at least one preset id')
    }
    if (owner.root !== this.owner.root) throw new Error('A compaction provider must register from the runtime it enhances')
    if (owner === this.owner) throw new Error('A compaction provider must register from its own plugin context')
    const fiber = owner.fiber
    const selected = this.selected
    if (selected !== undefined) {
      // Version 1 only allows the same owner, origin and module to update its
      // revision or preset set in place. A different identity must revoke the
      // live selection first: it is rejected here, before the epoch, the
      // selection, or any effect changes.
      if (selected.ownerFiber !== fiber || selected.origin !== origin || selected.module !== module) {
        throw new Error(
          `compaction provider ${selected.origin} already registered ${selected.module}; `
          + 'revoke it before registering a different owner, origin, or module',
        )
      }
    }
    const handle: CompactionRegistration = {
      origin, revision, module, presets: [...registration.presets], requires: [...registration.requires ?? []],
      ownerFiber: fiber,
      revoke: () => this.withdraw(handle),
    }
    // The increment invalidates every attempt planned from the previous selection.
    this.registrationEpoch++
    this.selected = handle
    this.retained++
    owner.effect(() => () => this.withdraw(handle), 'compaction-provider.registration')
    await this.reselect(handle)
    return handle
  }

  /** Prepare the registered provider for every existing declaration the selection covers. */
  private async reselect(registration: CompactionRegistration): Promise<void> {
    // The authorization is captured once for the whole operation: a later
    // registration must not lend its epoch to the remaining iterations.
    const epoch = this.registrationEpoch
    for (const record of [...this.definitions.values()]) {
      if (!registration.presets.includes(record.config.id)) continue
      // A newer registration replaced this one: the rest of this loop has no
      // authority left, and neither do its candidates.
      if (this.selected !== registration) return
      // One token per declaration, built from the epoch this operation started
      // with: every publication and diagnostic below is allowed only while that
      // authorization still holds.
      const token = this.attempt(record, epoch)
      const origin = token.origin
      if (origin?.trusted !== true) {
        this.recordCompaction(token, {
          state: 'skipped',
          reason: origin?.reason ?? 'no trusted in-box layer vouches for this declaration',
          ...originRevision(origin),
        })
        // A revision this registration enhanced must not keep serving new
        // bindings once its voucher is gone; Agents already bound keep theirs.
        const serving = record.generation
        if (serving !== undefined && serving.registrationOrigin !== undefined) {
          const declared = await this.mountAttempt(record, record.config.plugins, token.epoch)
          if (declared.ok) {
            declared.generation.compaction = { state: 'declared' }
            await this.publishCandidate(record, declared.generation, token)
          }
        }
        continue
      }
      const plan = planCompactionSubstitution(record.config.plugins, registration.module)
      if (plan.kind === 'skipped') {
        this.recordCompaction(token, { state: 'skipped', reason: plan.reason, ...originRevision(origin) })
        continue
      }
      const candidate = await this.mountAttempt(record, plan.rows, token.epoch, origin)
      if (!candidate.ok) {
        this.recordCompaction(token, { state: 'skipped', reason: candidate.reason, ...originRevision(origin) })
        continue
      }
      const problem = await this.candidateProblem(candidate, registration)
      if (problem !== undefined) {
        // A candidate of a superseded attempt disposes itself and reports
        // nothing: the newer attempt's roster stays authoritative.
        if (this.tokenValid(token)) {
          this.recordCompaction(token, { state: 'skipped', reason: problem, ...originRevision(origin) })
        }
        continue
      }
      candidate.generation.compaction = {
        state: 'substituted', provider: plan.provider, source: 'registration',
        presets: registration.presets, ...originRevision(token.origin),
      }
      this.attribute(candidate.generation, registration)
      candidate.generation.providerFiber = providerRowFiber(candidate.generation.mount, plan.provider)
      if (!await this.publishCandidate(record, candidate.generation, token)) continue
    }
  }

  /**
   * Record the real owners of one registration-selected revision: the
   * registering fiber, that plugin's Loader row ids when it has any, and the
   * Host fibers that satisfied the requirements it declared.
   */
  private attribute(generation: Generation, registration: CompactionRegistration): void {
    generation.registrationOrigin = registration.origin
    generation.registrationRevision = registration.revision
    generation.registrationRequirements = registration.requires
    generation.registrationFiber = registration.ownerFiber
    const entry = registration.ownerFiber.entry
    if (entry !== undefined) {
      generation.registrationOwnerEntryId = entry.id
      generation.registrationOwnerPatchId = entry.options.id
    }
    generation.registrationRequirementFibers = this.requirementFibers(registration.requires)
    generation.capturedRequirements = new Map(registration.requires.flatMap((requirement) => {
      const matches = this.matchingFibers(requirement)
      const fiber = matches.length === 1 ? matches[0] : undefined
      return fiber === undefined ? [] : [[requirementKey(requirement), fiber] as const]
    }))
  }

  /**
   * Host fibers that uniquely satisfy one registration's declared
   * requirements at publication time, kept for diagnostics; availability is
   * re-read from {@link AgentPresetRegistry.requirementAlive} on every read, so
   * a requirement that only becomes injectable later is reflected then.
   */
  private requirementFibers(requirements: readonly CompactionHostRequirement[]): Fiber[] {
    const fibers: Fiber[] = []
    for (const requirement of requirements) {
      const matches = this.matchingFibers(requirement)
      if (matches.length === 1) fibers.push(...matches)
    }
    return fibers
  }

  /** Withdraw one registration and return future bindings to the declarations themselves. */
  private async withdraw(registration: CompactionRegistration): Promise<void> {
    if (this.selected !== registration) return
    this.selected = undefined
    // The increment invalidates every attempt that was planned from the
    // selection this call is withdrawing.
    this.registrationEpoch++
    this.retained++
    const epoch = this.registrationEpoch
    for (const record of [...this.definitions.values()]) {
      const generation = record.generation
      if (generation === undefined || generation.registrationOrigin !== registration.origin) continue
      // A newer registration already took over: this withdrawal stops here
      // instead of demoting the remaining declarations under its authority.
      if (this.currentSelection() !== undefined) return
      const token = this.attempt(record, epoch)
      const declared = await this.mountAttempt(record, record.config.plugins, token.epoch)
      if (!declared.ok) {
        this.recordCompaction(token, {
          state: 'skipped',
          reason: `the declared composition cannot be mounted: ${declared.reason}`,
        })
        continue
      }
      declared.generation.compaction = { state: 'declared' }
      await this.publishCandidate(record, declared.generation, token)
    }
  }

  /**
   * Make one revision the one future bindings select, retiring the revision it
   * replaced for the Agents still holding it.
   */
  private async publish(record: Definition, generation: Generation): Promise<void> {
    const previous = record.generation
    record.generation = generation
    record.compaction = generation.compaction
    this.retained++
    if (previous === undefined || previous === generation) return
    previous.retired = true
    await this.collect(previous)
  }

  /** The registration selecting one declaration, when one does. */
  private registrationFor(presetId: string): CompactionRegistration | undefined {
    return this.selected !== undefined && this.selected.presets.includes(presetId) ? this.selected : undefined
  }

  /** Default preset for a subsequently created session. */
  get defaultId(): string { return this.config.selectedDefault.get() ?? this.config.default }

  /** Register and eagerly load a definition; activation failure remains visible in the roster.
   * @param definition Parsed configuration supplied by the declaring plugin.
   * @param identity Real Loader identity of the declaring row, when it has one.
   * @returns Definition disposer after activation or its diagnostic settles; the declaring plugin owns it.
   */
  async register(definition: PresetDefinition, identity: PresetDeclarationIdentity = {}): Promise<() => Promise<void>> {
    const context = this.ctx
    if (!definition.id.trim()) throw new Error('Preset id must not be empty')
    if (this.definitions.has(definition.id)) throw new Error(`Duplicate agent preset: ${definition.id}`)
    const profile = this.owner.get('profileContext')
    const record: Definition = {
      config: definition, context, ready: Promise.resolve(), identity, compaction: { state: 'declared' },
      declarationFiber: identity.fiber,
      origin: presetEnhancementOrigin(profile, identity.patchId),
    }
    this.definitions.set(definition.id, record)
    let disposed = false
    const unregister = async (): Promise<void> => {
      if (disposed) return
      disposed = true
      this.definitions.delete(definition.id)
      await record.ready
      if (record.generation !== undefined) {
        record.generation.retired = true
        this.retained++
        await this.collect(record.generation)
      }
    }
    record.ready = this.activate(record)
    await record.ready
    return unregister
  }

  /**
   * Activate one declaration: the selected provider first, the declared rows
   * as the fallback that keeps the preset usable.
   *
   * A candidate that cannot be planned, cannot mount, is not selected any
   * more, or is not vouched for by the declaration's origin leaves the
   * declared composition in place and is reported as a structured skip
   * instead of a broken preset.
   */
  private async activate(record: Definition): Promise<void> {
    const declared = record.config.plugins
    const problem = entryListProblem(declared)
    if (problem !== undefined) {
      this.markBroken(record, problem)
      return
    }
    const registration = this.registrationFor(record.config.id)
    const requested = registration?.module ?? record.config.compactionProvider
    const source = registration === undefined ? 'declaration' as const : 'registration' as const
    const token = this.attempt(record)
    const origin = token.origin
    // One gate for both selection paths: a trusted in-box origin is required,
    // so an unrecorded or non-trusted origin never authorizes an enhancement.
    const vouched = origin?.trusted === true
    if (requested === undefined) {
      record.compaction = { state: 'declared' }
    } else if (!vouched) {
      this.recordCompaction(token, {
        state: 'skipped',
        reason: origin?.reason ?? 'no trusted in-box layer vouches for this declaration',
        ...originRevision(origin),
      })
    } else {
      const plan = planCompactionSubstitution(declared, requested)
      if (plan.kind === 'skipped') {
        this.recordCompaction(token, { state: 'skipped', reason: plan.reason, ...originRevision(origin) })
      } else {
        const candidate = await this.mountAttempt(record, plan.rows, this.registrationEpoch, origin)
        const problem = candidate.ok ? await this.candidateProblem(candidate, registration) : candidate.reason
        if (candidate.ok && problem === undefined) {
          candidate.generation.compaction = {
            state: 'substituted', provider: plan.provider, source,
            ...(registration === undefined ? {} : { presets: registration.presets }),
            ...originRevision(token.origin),
          }
          // A declaration activated after the registration must record the same
          // real owners as one that was re-prepared by it.
          if (registration !== undefined) this.attribute(candidate.generation, registration)
          candidate.generation.providerFiber = providerRowFiber(candidate.generation.mount, plan.provider)
          if (await this.publishCandidate(record, candidate.generation, token)) return
        }
        this.recordCompaction(token, {
          state: 'skipped',
          reason: problem ?? 'the candidate could not be selected',
          ...originRevision(origin),
        })
      }
    }
    const fallback = await this.mountAttempt(record, declared, token.epoch)
    if (!fallback.ok) {
      // A superseded attempt reports nothing: a newer generation or roster
      // stays authoritative.
      if (this.tokenValid(token)) this.markBroken(record, fallback.reason)
      return
    }
    fallback.generation.compaction = record.compaction
    await this.publishCandidate(record, fallback.generation, token)
  }

  /**
   * Mount one candidate row list under a fresh scope, publishing nothing that
   * a withdrawal or a replaced registration already invalidated.
   */
  private async mountAttempt(
    record: Definition, rows: PresetDefinition['plugins'], epoch: number,
    expectedOrigin?: PresetEnhancementOrigin,
  ): Promise<MountedCandidate | { ok: false; reason: string }> {
    const key = {}
    const scope = createScope(this.owner, key)
    try {
      const context = scope.ctx.extend({ baseUrl: record.context.baseUrl })
      const mount = await mountPreset(context, record.config.id, rows)
      // A revocation, a replacement, or a withdrawn registration that landed
      // while this mount was in flight must not publish a revision.
      if (this.definitions.get(record.config.id) !== record) {
        await scope.dispose()
        return { ok: false, reason: 'the declaration was withdrawn while its composition mounted' }
      }
      if (this.registrationEpoch !== epoch) {
        await scope.dispose()
        return { ok: false, reason: 'the provider registration changed while the composition mounted' }
      }
      if (expectedOrigin !== undefined) {
        // The composition the decision was read from may have moved while this
        // candidate mounted: a withdrawn voucher or a new composition revision
        // invalidates the candidate before anything can select it.
        const current = this.currentOrigin(record)
        if (current === undefined
          || current.trusted !== expectedOrigin.trusted || current.revision !== expectedOrigin.revision) {
          await scope.dispose()
          return { ok: false, reason: 'the declaration origin changed while the composition mounted' }
        }
      }
      const generation: Generation = {
        scope, key, mount, users: 0, retired: false, ordinal: ++this.ordinal,
        compaction: { state: 'declared' },
        declarationPatchId: record.identity.patchId, declarationEntryId: record.identity.entryId,
        declarationFiber: record.declarationFiber,
        registrationRequirements: [], registrationRequirementFibers: [], capturedRequirements: new Map(),
        providerFiber: undefined,
      }
      context.effect(() => {
        this.generations.set(key, generation)
        return () => { this.generations.delete(key) }
      }, 'agent-preset.mount')
      return { ok: true, generation, pending: await pendingRows(mount.tree) }
    } catch (error) {
      await scope.dispose()
      return { ok: false, reason: (error as Error).message }
    }
  }

  /**
   * Why one mounted candidate cannot serve new bindings yet.
   *
   * A candidate whose own rows wait for a Host node this composition does not
   * supply is not serviceable: its scope is disposed so nothing is published,
   * and the pending rows are reported verbatim. Every selection path runs this
   * check, so a provider that is not injectable yet is never selected.
   */
  private async candidateProblem(
    candidate: MountedCandidate, registration?: CompactionRegistration,
  ): Promise<string | undefined> {
    if (candidate.pending.length > 0) {
      await candidate.generation.scope.dispose()
      return `the selected provider is not injectable yet: ${candidate.pending.join('; ')}`
    }
    // A registration's own declared requirements are part of readiness even
    // when the provider does not inject them itself: a missing or ambiguous
    // node must not be published and then merely reported unavailable.
    const unresolved = (registration?.requires ?? []).filter(requirement => !this.requirementReady(requirement))
    if (unresolved.length === 0) return undefined
    await candidate.generation.scope.dispose()
    const names = unresolved.map(requirement => requirement.rowId ?? requirement.module ?? 'unnamed node')
    return `the registration's required Host nodes are not available yet: ${names.join(', ')}`
  }

  /** Record a declaration that cannot compose any revision. */
  private markBroken(record: Definition, reason: string): void {
    record.broken = reason
    record.compaction = { state: 'declared' }
    this.owner.logger.warn(`agent preset ${record.config.id}: ${reason}`)
  }

  /**
   * Current activation diagnostic of a definition.
   *
   * A mount failure is final. A mounted tree is re-audited on every read: a
   * row waiting for a Host service activates by itself once that provider
   * finishes, so the audit waits for the Host Loader tree to settle before
   * reporting the row as unusable. Callers therefore must not run inside a
   * Host row's own activation, which the settlement would wait on.
   * @param record - the definition to audit.
   * @returns one line per unusable row, or undefined when the definition is usable.
   */
  private async diagnostic(record: Definition): Promise<string | undefined> {
    await record.ready
    if (record.generation === undefined) return record.broken
    const tree = record.generation.mount.tree
    let audit = await auditRows(tree)
    if (audit.pending.length > 0) {
      await this.owner.loader.await()
      audit = await auditRows(tree)
    }
    const lines = [...audit.failed, ...audit.pending]
    return lines.length === 0 ? undefined : lines.join('\n')
  }

  private async collect(generation: Generation): Promise<void> {
    if (!generation.retired || generation.users !== 0) return
    this.generations.delete(generation.key)
    this.retained++
    await generation.scope.dispose()
  }

  private generationFor(ctx: Context): Generation | undefined {
    const key = scopeOf(ctx)
    const parent = key === undefined ? undefined : scopeParentOf(key)
    return parent === undefined ? undefined : this.generations.get(parent)
  }

  /** Whether one captured fiber is still active; an absent fiber imposes no requirement. */
  private static fiberAlive(fiber: Fiber | undefined): boolean {
    return fiber === undefined || fiber.state === FiberState.ACTIVE
  }

  /**
   * Whether every real owner of one revision is still active.
   *
   * Owners are captured fibers compared by identity: the declaring plugin, the
   * revision's own mounted tree, the plugin that registered its provider, and
   * the Host fibers that satisfied that registration. A replacement row or
   * plugin that happens to carry the same name is a different fiber and does
   * not count as the old owner.
   */
  private ownerAlive(generation: Generation): boolean {
    // A declared revision is retained by the registry's own scope, so it keeps
    // serving after an ordinary preset edit retires its declaring row. Only an
    // enhanced revision, whose binding depends on the plugin that registered it,
    // becomes unavailable when that real owner stops.
    const declarationAlive = generation.registrationOrigin === undefined
      || AgentPresetRegistry.fiberAlive(generation.declarationFiber)
    return declarationAlive
      && AgentPresetRegistry.fiberAlive(generation.mount.fiber)
      && AgentPresetRegistry.fiberAlive(generation.providerFiber)
      && AgentPresetRegistry.fiberAlive(generation.registrationFiber)
      // Every declared requirement must resolve to exactly one active Host
      // fiber right now: a missing, ambiguous, or inactive node is never
      // reported as alive.
      && generation.registrationRequirements.every(requirement => this.requirementAlive(generation, requirement))
  }

  /** Fibers that satisfy one declared requirement right now, deduplicated by identity. */
  private matchingFibers(requirement: CompactionHostRequirement): Fiber[] {
    const fibers: Fiber[] = []
    for (const entry of this.owner.loader.entries()) {
      const fiber = entry.fiber
      if (fiber === undefined || fibers.includes(fiber)) continue
      const named = requirement.rowId !== undefined && entry.options.id === requirement.rowId
      const packaged = requirement.module !== undefined && entry.options.name === requirement.module
      if (named || packaged) fibers.push(fiber)
    }
    return fibers
  }

  /**
   * Whether one declared requirement resolves to exactly one active Host fiber
   * right now, before any revision is published from it.
   */
  private requirementReady(requirement: CompactionHostRequirement): boolean {
    const fibers = this.matchingFibers(requirement)
    return fibers.length === 1 && AgentPresetRegistry.fiberAlive(fibers[0])
  }

  /** Whether one declared requirement resolves to exactly one active Host fiber. */
  private requirementAlive(generation: Generation, requirement: CompactionHostRequirement): boolean {
    const captured = generation.capturedRequirements.get(requirementKey(requirement))
    // A requirement never uniquely captured stays unsatisfied: a revision does
    // not migrate onto a node mounted later under the same name.
    if (captured === undefined) return false
    const fibers = this.matchingFibers(requirement)
    return fibers.length === 1 && fibers[0] === captured && AgentPresetRegistry.fiberAlive(captured)
  }

  /** The binding one retained revision actually installed, or undefined for no revision. */
  private describeBinding(generation: Generation | undefined): AgentPresetBinding | undefined {
    if (generation === undefined) return undefined
    const modules = activeCompositionModules(generation.mount.tree).map(row => row.moduleName)
    const provider = generation.compaction.provider
      ?? (modules.includes(BASIC_COMPACTION_PROVIDER) ? BASIC_COMPACTION_PROVIDER : undefined)
    const alive = this.ownerAlive(generation)
    const held = this.holdsFor(generation).length > 0
    const record = this.definitions.get(generation.mount.presetId)
    return {
      agentPreset: generation.mount.presetId,
      owner: generation.declarationPatchId ?? generation.declarationEntryId ?? generation.mount.presetId,
      generation: generation.ordinal,
      ownerAlive: alive,
      available: alive && !held,
      selectable: alive && !generation.retired && !held && record?.generation === generation
        && this.withdrawalReason(record, generation) === undefined,
      ...(provider === undefined ? {} : { compactionProvider: provider }),
      compactionSource: generation.compaction.source === 'registration' ? 'registration' : 'declaration',
      ...(this.substitutionFor(generation) ?? {}),
    }
  }

  /** The registration identity that selected one revision's provider, when one did. */
  private substitutionFor(generation: Generation): { registrationOrigin: string; registrationRevision: string } | undefined {
    if (generation.registrationOrigin === undefined) return undefined
    return {
      registrationOrigin: generation.registrationOrigin,
      registrationRevision: generation.registrationRevision ?? '',
    }
  }

  /**
   * Why one retained revision depends on the rows and modules a change touches.
   *
   * Only real owners are protected: the declaration row itself, and — for a
   * revision a registration enhanced — the registered provider, the plugin
   * that registered it, and the Host nodes that registration declared it
   * needs. A Native Basic revision protects nothing else, so unrelated
   * configuration and ordinary preset changes stay allowed.
   */
  private dependenciesOf(
    generation: Generation, rows: ReadonlySet<string>, modules: ReadonlySet<string>,
    fibers: readonly Fiber[] = [],
  ): CompositionOwnerBlock[] {
    const preset = generation.mount.presetId
    const blocks: CompositionOwnerBlock[] = []
    // Only a revision that a real registration enhanced protects owners. A
    // Native Basic revision - and a Host with no registration at all - keeps
    // the existing preset composition semantics, where restarting a
    // declaration rolls the revision for future bindings while Agents already
    // bound keep theirs. Protecting every declaration row here would lock
    // presets the Context never touches into restart-required.
    if (generation.registrationFiber === undefined) return blocks
    if (fibers.length > 0) {
      const owners: readonly [string, Fiber | undefined, CompositionOwnerRole][] = [
        [generation.declarationPatchId ?? generation.declarationEntryId ?? preset, generation.declarationFiber, 'declaration'],
        [generation.mount.presetId, generation.mount.fiber, 'composition'],
        [generation.registrationOrigin ?? 'registered provider', generation.registrationFiber, 'host'],
        [generation.compaction.provider ?? 'selected provider', generation.providerFiber, 'host'],
      ]
      for (const [owner, fiber, role] of owners) {
        if (fiber !== undefined && fibers.includes(fiber)) blocks.push({ agentPreset: preset, owner, role })
      }
      for (const fiber of generation.registrationRequirementFibers) {
        if (fibers.includes(fiber)) {
          blocks.push({ agentPreset: preset, owner: generation.registrationOrigin ?? 'required host', role: 'host' })
        }
      }
      if (blocks.length > 0) return blocks
    }
    // Both real ids name the same row: a caller may report a patch-local target
    // or a hierarchical Loader entry id, and neither is derived from the other.
    const declaring = [generation.declarationPatchId, generation.declarationEntryId]
      .filter((id): id is string => id !== undefined)
    for (const id of declaring) {
      if (rows.has(id)) blocks.push({ agentPreset: preset, owner: id, role: 'declaration' })
    }
    if (modules.has(PRESET_DECLARATION_MODULE)) {
      blocks.push({ agentPreset: preset, owner: PRESET_DECLARATION_MODULE, role: 'declaration' })
    }
    const provider = generation.compaction.provider
    if (provider !== undefined && modules.has(packageIdentity(provider))) {
      blocks.push({ agentPreset: preset, owner: provider, role: 'host' })
    }
    const registering = [generation.registrationOwnerPatchId, generation.registrationOwnerEntryId]
      .filter((id): id is string => id !== undefined)
    for (const id of registering) {
      if (rows.has(id)) blocks.push({ agentPreset: preset, owner: id, role: 'host' })
    }
    for (const requirement of generation.registrationRequirements) {
      const named = requirement.rowId !== undefined && rows.has(requirement.rowId)
      const packaged = requirement.module !== undefined && modules.has(packageIdentity(requirement.module))
      if (named || packaged) {
        blocks.push({ agentPreset: preset, owner: requirement.rowId ?? requirement.module ?? '', role: 'host' })
      }
    }
    return blocks
  }

  /**
   * Decide one proposed change and take the barrier over the revisions it
   * touches.
   *
   * The barrier is installed before the first await and covers exactly the
   * revisions this change reaches, so a binding created while the caller
   * writes cannot attach to an owner the change removes or restarts; bindings
   * of unrelated revisions continue.
   */
  private async exclusive<T>(
    change: ProposedCompositionChange, run: () => Promise<T>,
  ): Promise<CompositionOwnerOutcome<T>> {
    const rows = new Set(change.rows.map(row => row.id))
    const modules = new Set([
      ...change.modules.map(packageIdentity),
      ...change.rows.flatMap(row => row.module === undefined ? [] : [packageIdentity(row.module)]),
    ])
    const blocked: CompositionOwnerBlock[] = []
    const affected: Generation[] = []
    const fibers = change.fibers
    for (const generation of this.generations.values()) {
      // A change whose reach is unknown is judged against every retained
      // revision, so an unresolved identity never passes as harmless.
      // An unbounded change is conservative only about revisions a real
      // registration enhanced; a Host that composes Native Basic alone keeps
      // the ordinary management behaviour it had before this contract.
      const blocks = change.unbounded === true
        ? generation.registrationFiber === undefined ? [] : [{
          agentPreset: generation.mount.presetId,
          owner: generation.declarationPatchId ?? generation.declarationEntryId ?? generation.mount.presetId,
          role: 'declaration' as const,
        }]
        : this.dependenciesOf(generation, rows, modules, fibers)
      if (blocks.length === 0) continue
      affected.push(generation)
      if (generation.users > 0) blocked.push(...blocks)
    }
    blocked.sort((left, right) => left.agentPreset.localeCompare(right.agentPreset) || left.owner.localeCompare(right.owner))
    if (blocked.length > 0) return { kind: 'blocked', operation: change.operation, blocked }
    // The transaction covers the whole apply: a revision published while it
    // runs is judged by the same owner set, so it cannot become bindable
    // before the change that affects it settles.
    const { promise, resolve } = Promise.withResolvers<void>()
    const transaction: Transaction = { rows, modules, fibers: change.fibers ?? [], unbounded: change.unbounded === true, released: promise }
    this.transactions.add(transaction)
    const held = affected.map(generation => this.suspend(generation))
    try {
      return { kind: 'applied', value: await run() }
    } finally {
      for (const suspension of held) suspension.release()
      this.transactions.delete(transaction)
      resolve()
    }
  }

  /**
   * The barriers one revision's next binding must clear before it commits.
   *
   * Revisions that exist when a change starts are suspended; a revision
   * published while the change runs is judged by the live transaction, so
   * publication during a change cannot open a binding the change invalidates.
   */
  private holdsFor(generation: Generation): Promise<void>[] {
    const holds: Promise<void>[] = []
    const suspension = this.suspensions.get(generation)
    if (suspension !== undefined) holds.push(suspension.released)
    for (const transaction of this.transactions) {
      if (generation.registrationFiber !== undefined
        && (transaction.unbounded
          || this.dependenciesOf(generation, transaction.rows, transaction.modules, transaction.fibers).length > 0)) {
        holds.push(transaction.released)
      }
    }
    return holds
  }

  /** Hold new bindings of one revision until the returned suspension is released. */
  private suspend(generation: Generation): Suspension {
    const existing = this.suspensions.get(generation)
    if (existing !== undefined) {
      existing.count++
      return existing
    }
    const { promise, resolve } = Promise.withResolvers<void>()
    const suspension: Suspension = {
      count: 1,
      released: promise,
      release: () => {
        suspension.count--
        if (suspension.count > 0) return
        this.suspensions.delete(generation)
        resolve()
      },
    }
    this.suspensions.set(generation, suspension)
    return suspension
  }

  /** Inspect retained revisions, or the exact revision an Agent joined.
   * @param ctx - optional Agent context; omission includes all retained revisions.
   * @returns detached module references and isolation diagnostics; no match returns an empty list.
   */
  inspectCompositions(ctx?: Context): AgentPresetInspection[] {
    const joined = ctx === undefined ? undefined : this.generationFor(ctx)
    const generations = ctx === undefined ? [...this.generations.values()] : joined === undefined ? [] : [joined]
    return generations.map(({ mount }) => ({
      id: mount.presetId,
      modules: activeCompositionModules(mount.tree),
      leakedServices: leakedServices(this.owner, mount.fiber),
    }))
  }

  /** Read every declared preset, including activation failures.
   * @returns Display metadata and loading diagnostics.
   */
  async list(): Promise<AgentPreset[]> {
    const rows = await Promise.all([...this.definitions.values()].map(async (record) => {
      const broken = await this.diagnostic(record)
      return {
        id: record.config.id,
        ...(record.config.name === undefined ? {} : { name: record.config.name }),
        ...(record.config.description === undefined ? {} : { description: record.config.description }),
        ...(record.config.order === undefined ? {} : { order: record.config.order }),
        ...(broken === undefined ? {} : { broken }),
        compaction: record.compaction,
      }
    }))
    return rows.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.id.localeCompare(b.id))
  }

  /** Read the selection roster.
   * @returns Current presets, each marked when it is the default.
   */
  @Remote('list')
  async remoteExportList(): Promise<AgentPresetRoster> {
    const defaultId = this.defaultId
    return { presets: (await this.list()).map(row => ({ ...row, isDefault: row.id === defaultId })) }
  }

  /** Resolve an identity without starting an Agent.
   * @param id Explicit preset or the current default.
   * @returns Current metadata, including failure when activation failed.
   */
  async resolve(id?: string): Promise<AgentPreset> {
    const wanted = id ?? this.defaultId
    const record = this.definitions.get(wanted)
    if (record === undefined) throw new RemoteError('agent-preset/not-found', `Unknown agent preset: ${wanted}`,
      { agentPreset: wanted, available: [...this.definitions.keys()] })
    const broken = await this.diagnostic(record)
    return { id: wanted, ...(broken === undefined ? {} : { broken }), compaction: record.compaction }
  }

  /** Read one declaration's child plugin list as YAML, for viewing only.
   * @param agentPreset Preset identity.
   * @returns The declared composition beside its published metadata.
   */
  @Remote('read')
  readDocument(agentPreset: string): Promise<AgentPresetDocument> {
    const record = this.definitions.get(agentPreset)
    if (record === undefined) {
      return Promise.reject(new RemoteError('agent-preset/not-found', `Unknown agent preset: ${agentPreset}`,
        { agentPreset, available: [...this.definitions.keys()] }))
    }
    const { id, name, description, plugins } = record.config
    // The Loader's own dialect, so `!!js` conditions read as declared rather than as expression objects.
    const content = dump(plugins, { schema: entryListSchema, noRefs: true, lineWidth: -1 })
    return Promise.resolve({
      agentPreset: id, content, ...(name === undefined ? {} : { name }), ...(description === undefined ? {} : { description }),
    })
  }

  /**
   * The decision one selection attempt was started with: the declaration, the
   * registration epoch, and the composition origin revision it read.
   */
  private attempt(record: Definition, epoch: number = this.registrationEpoch): AttemptToken {
    return { record, epoch, origin: this.currentOrigin(record) }
  }

  /**
   * Read the live selection.
   *
   * A call boundary keeps a read taken before an await from being narrowed
   * into a constant: the selection can change while this loop suspends.
   * @returns the registration future revisions select, or undefined.
   */
  private currentSelection(): CompactionRegistration | undefined {
    return this.selected
  }

  /** Whether one attempt may still publish or write a diagnostic. */
  private tokenValid(token: AttemptToken): boolean {
    if (this.definitions.get(token.record.config.id) !== token.record) return false
    if (this.registrationEpoch !== token.epoch) return false
    if (token.origin === undefined) return true
    const current = this.currentOrigin(token.record)
    return current !== undefined
      && current.trusted === token.origin.trusted && current.revision === token.origin.revision
  }

  /** Write one declaration's structured state only while its attempt still holds. */
  private recordCompaction(token: AttemptToken, state: PresetCompactionState): void {
    if (this.tokenValid(token)) token.record.compaction = state
  }

  /**
   * Why the serving revision may not accept new bindings: its registration is
   * no longer the selected one, or the applied composition stopped vouching
   * for its declaration. A trusted origin alone is not authorization.
   */
  private withdrawalReason(record: Definition, generation: Generation): string | undefined {
    if (generation.registrationOrigin === undefined) return undefined
    if (this.selected?.origin !== generation.registrationOrigin) {
      return 'the provider registration that selected this revision was revoked'
    }
    // The current registration must still cover this preset: narrowing the
    // selection leaves the presets it dropped without a future binding.
    if (!this.selected.presets.includes(record.config.id)) {
      return 'the current provider registration no longer selects this preset'
    }
    const origin = this.currentOrigin(record)
    if (origin?.trusted !== true) {
      return origin?.reason ?? 'no trusted in-box layer vouches for this declaration'
    }
    return undefined
  }

  /**
   * Publish one prepared candidate only if the decision that authorized it is
   * still current after every await that followed it.
   *
   * A revoke, a replacement registration, a withdrawn voucher, or a new
   * composition revision invalidates the candidate: its scope is disposed, the
   * roster is left untouched, and the caller keeps serving what it already had.
   * @returns whether the candidate is now the revision future bindings select.
   */
  private async publishCandidate(record: Definition, generation: Generation, token: AttemptToken): Promise<boolean> {
    if (!this.tokenValid(token)) {
      await generation.scope.dispose()
      return false
    }
    await this.publish(record, generation)
    return true
  }

  /**
   * Return future bindings to the declared composition of a revision whose
   * voucher was withdrawn. Agents already bound keep the revision they hold.
   */
  private async demote(record: Definition, serving: Generation, reason: string): Promise<boolean> {
    if (record.generation !== serving || serving.registrationOrigin === undefined) return true
    const token = this.attempt(record)
    const origin = token.origin
    const declared = await this.mountAttempt(record, record.config.plugins, token.epoch)
    if (!declared.ok) {
      // Future bindings are refused explicitly: joining a withdrawn or
      // untrusted enhanced revision is not an option, and the roster keeps the
      // reason instead of pretending the declared composition took over.
      this.recordCompaction(token, {
        state: 'skipped',
        reason: `the declared composition cannot be mounted: ${declared.reason}`,
        ...originRevision(origin),
      })
      return false
    }
    declared.generation.compaction = { state: 'declared' }
    if (!await this.publishCandidate(record, declared.generation, token)) return false
    this.recordCompaction(token, { state: 'skipped', reason, ...originRevision(origin) })
    return true
  }

  /**
   * Retain one revision for a new binding.
   *
   * The suspension check is the last await before the binding commits, so a
   * composition change that holds this revision cannot be overtaken: no await
   * separates the check from the membership increment.
   */
  private async retain(id?: string): Promise<Generation> {
    const wanted = id ?? this.defaultId
    while (true) {
      const record = this.definitions.get(wanted)
      if (record === undefined) throw new RemoteError('agent-preset/not-found', `Unknown agent preset: ${wanted}`,
        { agentPreset: wanted, available: [...this.definitions.keys()] })
      const broken = await this.diagnostic(record)
      if (this.definitions.get(wanted) !== record) continue
      const generation = record.generation
      if (broken !== undefined || generation === undefined) {
        const reason = broken as string
        throw new RemoteError('agent-preset/invalid', reason, { agentPreset: wanted, reason })
      }
      // A revision an earlier registration enhanced stops being selectable the
      // moment the applied composition stops vouching for its declaration, even
      // when the effective configuration - and therefore the Entry - is
      // unchanged and nothing registers again.
      const withdrawal = this.withdrawalReason(record, generation)
      if (withdrawal !== undefined) {
        if (!await this.demote(record, generation, withdrawal)) {
          const reason = record.compaction.reason ?? withdrawal
          throw new RemoteError('agent-preset/invalid', reason, { agentPreset: wanted, reason })
        }
        continue
      }
      const holds = this.holdsFor(generation)
      if (holds.length > 0) {
        await Promise.all(holds)
        continue
      }
      // Every barrier is released, so this is the real state: a revision whose
      // own owner stopped serving cannot be handed to a new binding, even when
      // its diagnostic tree still looks healthy. A transaction that merely held
      // it is not a permanent failure and was resolved above.
      if (generation.registrationOrigin !== undefined && !this.ownerAlive(generation)) {
        // The failure is external and nothing is going to restore that owner, so
        // a new binding is refused outright: the retained revision keeps its
        // generation and no automatic Basic takeover is claimed. Only a revoked
        // or narrowed registration, or a withdrawn voucher, rolls future
        // bindings back to the declared composition.
        const reason = 'the enhanced revision is no longer serviceable: a real owner stopped serving'
        throw new RemoteError('agent-preset/invalid', reason, { agentPreset: wanted, reason })
      }
      if (this.definitions.get(wanted) !== record || record.generation !== generation) continue
      generation.users++
      this.retained++
      return generation
    }
  }

  private async bind(ctx: Context, generation: Generation): Promise<void> {
    const key = scopeOf(ctx)
    if (key === undefined) throw new Error('Agent preset binding requires a scoped context')
    const binding = this.bindings.get(key)
    if (binding?.generation === generation) return
    if (binding !== undefined) {
      binding.parent.rebind(generation.key)
      const old = binding.generation
      generation.users++
      binding.generation = generation
      old.users--
      await this.collect(old)
    } else this.join(ctx, key, generation)
  }

  private join(ctx: Context, key: ScopeKey, generation: Generation): void {
    const binding = { parent: bindScopeParent(key, generation.key), generation }
    generation.users++
    this.bindings.set(key, binding)
    ctx.effect(() => async () => {
      this.bindings.delete(key)
      binding.generation.users--
      await this.collect(binding.generation)
    }, 'agent-preset.binding')
  }

  /** Bind an unpublished Agent to the current preset revision.
   * @param ctx Agent context from its setup callback.
   * @param id Requested preset, or the default.
   * @returns Bound preset identity.
   */
  async mount(ctx: Context, id?: string): Promise<AgentPreset> {
    const generation = await this.retain(id)
    try {
      await this.bind(ctx, generation)
      return { id: generation.mount.presetId }
    } finally {
      generation.users--
      await this.collect(generation)
    }
  }

  /** Join a child to the exact revision retained by its parent.
   *
   * This path is synchronous, so it cannot queue behind a composition change
   * that holds the parent's revision: it refuses instead of joining a
   * revision the change is about to remove or restart.
   * @param ctx Child Agent context.
   * @param parent Parent Agent context.
   * @returns Inherited preset id, or undefined in a preset-free composition.
   * @throws when the parent's revision is held by a composition change.
   */
  composeFrom(ctx: Context, parent: Context): string | undefined {
    const generation = this.generationFor(parent)
    if (generation !== undefined && this.holdsFor(generation).length > 0) {
      throw new Error('Parent preset revision is held by a composition change; create the child after it settles')
    }
    // A child must not inherit a revision that can no longer serve.
    if (generation !== undefined && generation.registrationOrigin !== undefined && !this.ownerAlive(generation)) {
      throw new Error('Parent preset revision is no longer serviceable; create the child after a new selection')
    }
    if (generation === undefined) {
      if (parent.get('agentPresets')?.composedPreset(parent) !== undefined) {
        throw new Error('Parent preset revision is unavailable')
      }
      return undefined
    }
    // A child has no existing binding, so this path has no asynchronous cleanup.
    const key = scopeOf(ctx)
    if (key === undefined) throw new Error('Child preset binding requires a scope')
    if (this.bindings.has(key)) throw new Error('Child already joined a preset')
    this.join(ctx, key, generation)
    return generation.mount.presetId
  }

  /** Read the preset a live Agent uses.
   * @param ctx Agent context.
   * @returns Its preset id, if bound.
   */
  composedPreset(ctx: Context): string | undefined { return this.generationFor(ctx)?.mount.presetId }

  /** Identify a tool owner's tree within the exact preset revision this Agent joined.
   * @param ctx Agent context.
   * @param tree Loader tree owning the registration.
   * @returns Preset id only for the joined revision's tree.
   */
  presetForTree(ctx: Context, tree: EntryTree): string | undefined {
    const mount = this.generationFor(ctx)?.mount
    return mount?.tree === tree ? mount.presetId : undefined
  }

  /** Read a service supplied inside an Agent's isolated preset group.
   * @param agent Agent whose composition is queried.
   * @param name Cordis service name.
   * @returns The service, or undefined.
   */
  serviceFor<K extends string & keyof Context>(agent: { ctx: Context }, name: K): Context[K] | undefined {
    const mount = this.generationFor(agent.ctx)?.mount
    return mount === undefined ? undefined : serviceForMount(this.owner, mount, name)
  }

  /** Rebind a blank Agent; the caller owns the blank-session check.
   * @param ctx Agent context.
   * @param id Requested preset.
   * @returns The bound identity.
   */
  async recompose(ctx: Context, id: string): Promise<AgentPreset> {
    const preset = await this.mount(ctx, id)
    try { this.owner.emit('tools/change') }
    catch (error) { this.owner.logger.warn(`Preset tools observer: ${String(error)}`) }
    return preset
  }

  /** Select a preset before a session starts its first turn.
   * @param agent Target Agent.
   * @param agentPreset Requested identity.
   * @returns Committed preset identity.
   */
  @Remote('select')
  async select(agent: Agent, agentPreset: string): Promise<string> {
    const turn = (this.switches.get(agent.id) ?? Promise.resolve()).then(async () => {
      const boundary = this.owner.sessionProjections.stateOf(agent.session, 'turnBoundary')
      if (boundary !== undefined && (boundary.openTurnStartSeq !== null || boundary.lastTurn > 0)) {
        throw new RemoteError('agent-preset/locked', 'This session has already started', { sessionId: agent.id, agentPreset })
      }
      const preset = await this.recompose(agent.ctx, agentPreset)
      agent.session.append('agent-preset/selected', { agentPreset: preset.id })
      return preset.id
    })
    const guard = turn.catch(() => undefined)
    this.switches.set(agent.id, guard)
    try { return await turn } finally {
      if (this.switches.get(agent.id) === guard) this.switches.delete(agent.id)
    }
  }

  /** Read current registrations for cold transcript presentation.
   * @param id Preset identity or the default.
   * @returns A revision lease; dispose it after the scoped read completes.
   */
  async acquireScope(id?: string): Promise<{ key: ScopeKey } & AsyncDisposable> {
    const generation = await this.retain(id)
    let disposed = false
    return { key: generation.key, [Symbol.asyncDispose]: async () => {
      if (disposed) return
      disposed = true
      generation.users--
      await this.collect(generation)
    } }
  }

  /** Read plugin rows without creating an Agent.
   * @returns Current declaration metadata and activation states.
   */
  compositionInventory(): Promise<AgentPresetComposition[]> {
    return Promise.all([...this.definitions.values()].map(async (record) => {
      const { id, name, description } = record.config
      const broken = await this.diagnostic(record)
      const read = definitionComposition(record.config.plugins, () => { throw new Error('Inactive definition') })
      return { id, ...(name === undefined ? {} : { name }), ...(description === undefined ? {} : { description }),
        isDefault: id === this.defaultId,
        ...(broken === undefined ? {} : { broken }),
        rows: record.generation === undefined ? ('rows' in read ? read.rows : []) : mountedCompositionRows(record.generation.mount.tree) }
    }))
  }
}
export default AgentPresetRegistry
