/** Versioned Host surface a compaction provider integration registers through. */
import type { Context, Fiber } from '@deepseek-ai/cordis'

/**
 * Version of the preset-registry surface this Host implements for a
 * compaction provider integration.
 *
 * Version 1 is new-bindings-only and future-selection-only: registering or
 * revoking governs the revisions activated afterwards, every retained
 * revision keeps the binding it already has, and a registration never rewrites
 * a declaration's own rows.
 */
export const COMPACTION_HOST_VERSION = 1

/** One Host node the registered provider needs to stay alive. */
export interface CompactionHostRequirement {
  /** Loader row id of the Host node, when the integration knows it. */
  readonly rowId?: string
  /** Module specifier of the Host node, when only the package is known. */
  readonly module?: string
}

/** One provider registration a compaction integration submits before its revision may serve. */
export interface CompactionProviderRegistration {
  /**
   * Identity of the registering integration.
   *
   * The same owner, the same origin, and the same module may register again to
   * replace their own selection with a newer revision. A different origin or a
   * different module must {@link CompactionRegistration.revoke} first: a live
   * selection is never overwritten by another.
   */
  readonly origin: string
  /** Revision string of the provider generation the integration prepared. */
  readonly revision: string
  /** Module specifier of the provider plugin, substituted for the bundled provider row. */
  readonly module: string
  /** Preset ids this registration selects, so the integration never rewrites a declaration. */
  readonly presets: readonly string[]
  /** Host rows or modules the provider needs; a change that removes one is refused while a revision is retained. */
  readonly requires?: readonly CompactionHostRequirement[]
}

/** The registration future revisions select. */
export interface CompactionRegistration {
  /** Identity of the registering integration. */
  readonly origin: string
  /** Revision string of the provider generation. */
  readonly revision: string
  /** Module specifier substituted for the bundled provider row. */
  readonly module: string
  /** Preset ids this registration selects. */
  readonly presets: readonly string[]
  /** Host rows or modules the provider needs. */
  readonly requires: readonly CompactionHostRequirement[]
  /** Fiber of the plugin that registered this selection; identity is how a competing owner is detected. */
  readonly ownerFiber: Fiber
  /**
   * Withdraw exactly this registration. Revisions activated afterwards keep
   * the declaration's own rows; a candidate still mounting from this
   * registration is never published.
   * @returns fulfillment after the selection is withdrawn.
   */
  revoke(): Promise<void>
}

/** How one declared preset supplies automatic compaction. */
export interface PresetCompactionState {
  /** `declared` runs the rows as written, `substituted` replaced the bundled provider, `skipped` names why not. */
  readonly state: 'declared' | 'substituted' | 'skipped'
  /** Provider module in effect; present for `substituted`. */
  readonly provider?: string
  /** Whether the module in effect came from a registration rather than the declaration itself. */
  readonly source?: 'declaration' | 'registration'
  /** Preset ids the selection covers when it came from a registration. */
  readonly presets?: readonly string[]
  /** Why a selected provider is not in effect; present for `skipped`. */
  readonly reason?: string
  /** Composition revision of the declaration origin the decision read, when one was recorded. */
  readonly revision?: number
}

/** The revision one Agent actually bound, as the Host installed it. */
export interface AgentPresetBinding {
  /** Preset identity. */
  readonly agentPreset: string
  /** Loader row id of the declaration that owns this revision. */
  readonly owner: string
  /** Monotonic ordinal of this retained revision. */
  readonly generation: number
  /**
   * Whether the owners this revision really depends on are still active.
   *
   * A revision a registration enhanced requires its declaring row, the plugin
   * that registered the provider, and the Host nodes that registration named.
   * A revision running the declaration's own rows is held by this registry's
   * own scope instead: its declaring row may be unloaded while the revision
   * and its Agents keep working, so it stays alive with no registration.
   */
  readonly ownerAlive: boolean
  /**
   * Whether this revision can still serve the Agents bound to it.
   *
   * An unavailable revision keeps reporting its own source and provider; it is
   * never reported as the declaration's own rows, so a caller never mistakes a
   * held or broken enhancement for the bundled provider.
   */
  readonly available: boolean
  /** Module supplying automatic compaction in this revision, when the composition carries one. */
  readonly compactionProvider?: string
  /** Whether that module replaced the bundled provider. */
  readonly compactionSource: 'declaration' | 'registration'
  /** Whether this revision is the one a new binding selects now. */
  readonly selectable: boolean
  /** Registration identity that selected the module; absent for a declared provider. */
  readonly registrationOrigin?: string
  /** Registration revision that selected the module; absent for a declared provider. */
  readonly registrationRevision?: string
}

/** What a compaction provider integration registers through and reads back. */
export interface CompactionHostCapability {
  /** Contract version this Host implements. */
  readonly version: number
  /** The registration future revisions select, or undefined when the declaration alone decides. */
  readonly selected: CompactionRegistration | undefined
  /**
   * Register one provider generation and the Host nodes it needs.
   *
   * Revisions already declared are re-prepared from this selection and
   * published for future bindings only once each candidate is ready; a
   * declaration whose candidate cannot be prepared keeps the composition it
   * already serves and reports a structured skip, and Agents already bound
   * keep their own revision. Registering again for the same owner, origin and
   * module replaces that selection in place, which is how one integration
   * moves to a newer revision; a different owner, origin, or module must
   * revoke first, because another integration's live selection is refused
   * rather than overwritten. A candidate still mounting from a withdrawn
   * selection is never published.
   * @param owner - the registering plugin's own context, whose unload withdraws the selection.
   * @param registration - provider module, identity, revision, selected presets, and required Host nodes.
   * @returns the live registration handle.
   * @throws when the registration names no origin, module, revision, or preset, when the owner is not the
   * registering runtime, when another owner or module already registered, or when a candidate is superseded.
   */
  register(owner: Context, registration: CompactionProviderRegistration): Promise<CompactionRegistration>
  /**
   * Read the revision one Agent actually bound.
   * @param ctx - the Agent context whose binding is read.
   * @returns the installed binding, or undefined when the Agent composes no preset revision.
   */
  bindingFor(ctx: Context): AgentPresetBinding | undefined
  /**
   * Read every retained revision with the owners each one still depends on.
   * @returns one entry per retained revision.
   */
  retained(): readonly AgentPresetBinding[]
}
