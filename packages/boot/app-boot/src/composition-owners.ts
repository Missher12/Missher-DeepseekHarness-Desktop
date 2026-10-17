/** Protected composition owners and the bounded transaction every Host mutation entry point runs. */
import type { Context, Fiber } from '@deepseek-ai/cordis'

/**
 * Version of the protected-owner composition contract this Host implements.
 *
 * A consumer that requires a newer version treats the Host as read-only
 * instead of negotiating a partial contract. Version 1 protects retained
 * preset revisions: revocation applies to future selection only, and ordinary
 * disposal drains started work without waiting for idle users.
 */
export const COMPOSITION_OWNER_GUARD_VERSION = 1

/** One Loader row a proposed composition change removes, replaces, or reconfigures. */
export interface ProposedRowChange {
  /** Loader row id the caller is about to write, remove, or replace. */
  readonly id: string
  /** Module the row mounts, when the caller already resolved it. */
  readonly module?: string
}

/** What a composition mutation entry point proposes to apply. */
export interface ProposedCompositionChange {
  /**
   * Rows whose effective configuration, presence, or enablement the change
   * alters. A caller re-applying an unchanged composition reports no rows, so
   * an unrelated change is never refused.
   */
  readonly rows: readonly ProposedRowChange[]
  /**
   * Package or module specifiers the change removes, replaces, or restarts.
   * A subpath specifier is compared by its package identity.
   */
  readonly modules: readonly string[]
  /**
   * Runtime fibers the change destroys or replaces, when the caller knows them
   * by identity rather than by a Loader row. A code hot-replacement reaches
   * mounted owners that no row id names, so identity is the only exact match.
   */
  readonly fibers?: readonly Fiber[]
  /**
   * Whether the change's reach cannot be bounded before it runs, such as a
   * package install whose real identity is only resolved during preparation. A
   * guard judges an unbounded change conservatively against every retained
   * owner instead of letting an empty row set pass as harmless.
   */
  readonly unbounded?: boolean
  /** One-line description of the operation, quoted in the restart-required refusal. */
  readonly operation: string
}

/** How one retained preset revision depends on a changed row or module. */
export type CompositionOwnerRole = 'declaration' | 'composition' | 'host'

/** One retained owner that refuses a proposed change. */
export interface CompositionOwnerBlock {
  /** Preset whose retained revision depends on the changed row or module. */
  readonly agentPreset: string
  /** Host row id or module the retained revision depends on. */
  readonly owner: string
  /** Whether the dependency is the declaration row, a mounted row, or a Host provider row. */
  readonly role: CompositionOwnerRole
}

/** Outcome of one bounded composition transaction. */
export type CompositionOwnerOutcome<T> =
  | { readonly kind: 'applied'; readonly value: T }
  | { readonly kind: 'blocked'; readonly operation: string; readonly blocked: readonly CompositionOwnerBlock[] }

/** Decides whether a composition change may proceed while preset revisions are retained. */
export interface CompositionOwnerGuard {
  /** Contract version the implementing Host provides. */
  readonly version: number
  /** Monotonic revision of the retained-owner set; every retained-revision change advances it. */
  readonly revision: number
  /**
   * Decide one change and run it under a barrier that holds new bindings of
   * the affected owners.
   *
   * The barrier is taken before the first await and covers exactly the
   * generations the change touches, so a binding created while the caller
   * writes or recomposes cannot attach to an owner this change removes or
   * restarts. Bindings of unaffected owners continue; a synchronous binding
   * entry point that cannot queue refuses instead of joining a held owner.
   * @param change - rows and modules the caller is about to write, remove, or replace.
   * @param run - the mutating step, executed inside the barrier.
   * @returns the applied value, or the owners blocking the change.
   */
  exclusive<T>(change: ProposedCompositionChange, run: () => Promise<T>): Promise<CompositionOwnerOutcome<T>>
}

/** Guard registrations by the root context they belong to; one runtime protects its own owners. */
const guards = new WeakMap<Context, CompositionOwnerGuard>()

/**
 * Publish the guard that protects retained preset revisions in this runtime.
 * @param ctx - any context of the runtime; its root keys the registration.
 * @param guard - the guard the runtime's mutation entry points will read.
 * @returns the disposer withdrawing this guard; a guard installed later for the same root stays.
 */
export function provideCompositionOwnerGuard(ctx: Context, guard: CompositionOwnerGuard): () => void {
  const root = ctx.root
  guards.set(root, guard)
  return () => {
    if (guards.get(root) === guard) guards.delete(root)
  }
}

/**
 * The guard protecting retained preset revisions, when this runtime composes presets.
 * @param ctx - any context of the runtime.
 * @returns the installed guard, or undefined when the runtime retains no preset revisions.
 */
export function compositionOwnerGuard(ctx: Context): CompositionOwnerGuard | undefined {
  return guards.get(ctx.root)
}

/**
 * The stable refusal every entry point raises for a blocked change.
 * @param binName - command name the refusal is reported under.
 * @param operation - one-line description of the refused change.
 * @param blocked - retained owners that refuse the change, in report order.
 * @returns the error naming the presets and the owners that still use them.
 */
export function compositionOwnerRefusal(
  binName: string, operation: string, blocked: readonly CompositionOwnerBlock[],
): Error {
  const presets = [...new Set(blocked.map(block => block.agentPreset))].join(', ')
  const owners = blocked.map(block => `${block.owner} (${block.role})`).join(', ')
  return new Error(`${binName}: ${operation} needs a normal restart: agent preset ${presets} still uses ${owners}`)
}

/**
 * Run one composition change inside the runtime's retained-owner barrier.
 *
 * The caller names the rows and modules it is about to write, remove, or
 * replace; `run` performs every mutation, so a refusal leaves the disk, the
 * entries, the mounts, and the queues exactly as the operation found them.
 * @param ctx - any context of the runtime.
 * @param change - rows and modules this operation changes.
 * @param run - the mutating step, executed only when the change is allowed.
 * @param binName - diagnostic prefix for the refusal.
 * @returns the value `run` produced.
 * @throws when a retained preset revision still depends on a changed row or module.
 */
export async function withCompositionOwners<T>(
  ctx: Context, change: ProposedCompositionChange, run: () => Promise<T>, binName = 'dsh',
): Promise<T> {
  const guard = compositionOwnerGuard(ctx)
  if (guard === undefined) return await run()
  const outcome = await guard.exclusive(change, run)
  if (outcome.kind === 'blocked') throw compositionOwnerRefusal(binName, outcome.operation, outcome.blocked)
  return outcome.value
}
