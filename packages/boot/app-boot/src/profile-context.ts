/** Launcher-owned profile locations and composition inputs. */
import { join } from 'node:path'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { applyEntryPatches, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { bundleLayerStale, composeEntries, loadProfileDirectory, PROFILE_PATCH_FILENAME, type PresetEnhancementOrigin, type Profile, type ProfilePatchLayer } from './profile.ts'
import { loadOptionalPatches } from './index.ts'

/** Application-owned package manager executable; environment applies only to package operations. */
export interface ProfilePnpmInvocation {
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
}

/** Current profile facts; scheduling and mutation belong to their callers. */
export interface ProfileContext {
  readonly name: string
  /** Packaged applications supply their bundled runtime instead of a PATH executable. */
  readonly packageManager?: ProfilePnpmInvocation
  readonly dir: string
  readonly patchPath: string
  readonly installAnchor: string
  readonly cwd: string
  readonly home: string
  /** Bundle packages used to start this process, before any persisted edits. */
  readonly startedBundles: readonly string[]
  /** Parsed command-line overlays, applied above profile and home patches. */
  readonly overlays: readonly PatchOptions[]
  /** Launch-time DSH_TELEMETRY_DISABLED value; any non-empty value opts out. */
  readonly telemetryDisabledEnv: string | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Present only in a profile launched by dsh. */
    profileContext: ProfileContext
  }
}

const TELEMETRY_ROW_ID = 'session-telemetry-otel'

/** Module of the plugin row that declares one Agent preset. */
const PRESET_DECLARATION_MODULE = '@deepseek-ai/dsh-agent-preset'

/** Patch diagnostics are reported by the Loader when the composition mounts. */
const ignorePatchWarning = (): void => {}

/**
 * Resolve the telemetry opt-out switch into its boot patch. ANY non-empty
 * value (including `'0'`/`'false'`) disables: a privacy switch prefers
 * off-by-mistake over on-by-mistake. A composition without the telemetry row
 * exports nothing, so the switch is then trivially satisfied and no patch is
 * generated — custom profiles need not mount telemetry to run with the
 * switch set.
 * @param disabledEnv - the raw `DSH_TELEMETRY_DISABLED` value (`undefined` when unset).
 * @param hasRow - whether the composition carries the telemetry row.
 * @returns the disable patch, or `undefined` when no hard-disable patch is required.
 */
export function resolveTelemetryPatch(disabledEnv: string | undefined, hasRow: boolean): PatchOptions | undefined {
  if ((disabledEnv ?? '') === '' || !hasRow) return undefined
  return { id: TELEMETRY_ROW_ID, disabled: true }
}

/** The preset id one declaration row publishes, when its config carries one. */
function presetDeclarationId(row: EntryOptions): string | undefined {
  if (row.name !== PRESET_DECLARATION_MODULE) return undefined
  const config: unknown = row.config
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return undefined
  const id = (config as Record<string, unknown>).id
  return typeof id === 'string' && id !== '' ? id : undefined
}

/**
 * Declaration row ids with the identity of the row that carries them.
 *
 * The fingerprint covers the row's position and the preset id it publishes,
 * so a layer that appends, re-declares, repositions, or reconfigures a
 * declaration is visible as a change even when the row id is unchanged. Patch
 * application only appends rows, so an untouched row keeps its fingerprint.
 * @param rows - composed entry rows to walk, nested groups included.
 * @returns declaration row id to fingerprint.
 */
function declarationFingerprints(rows: readonly EntryOptions[]): Map<string, string> {
  const found = new Map<string, string>()
  const visit = (items: readonly EntryOptions[], ancestors: readonly string[]): void => {
    for (const [index, row] of items.entries()) {
      const path = [...ancestors, `${row.id}#${String(index)}`].join('/')
      if (row.name === PRESET_DECLARATION_MODULE) {
        found.set(row.id, `${path}|${presetDeclarationId(row) ?? ''}`)
      }
      if (row.group === true && Array.isArray(row.config)) visit(row.config as EntryOptions[], [...ancestors, path])
    }
  }
  visit(rows, [])
  return found
}

/** Declaration row ids beneath one group row, at any nesting depth. */
function declarationsUnder(rows: readonly EntryOptions[], groupId: string): string[] {
  const found: string[] = []
  const collect = (items: readonly EntryOptions[]): void => {
    for (const row of items) {
      if (row.name === PRESET_DECLARATION_MODULE) found.push(row.id)
      if (row.group === true && Array.isArray(row.config)) collect(row.config as EntryOptions[])
    }
  }
  const visit = (items: readonly EntryOptions[]): void => {
    for (const row of items) {
      if (row.group !== true || !Array.isArray(row.config)) continue
      if (row.id === groupId) collect(row.config as EntryOptions[])
      visit(row.config as EntryOptions[])
    }
  }
  visit(rows)
  return found
}

/**
 * Which preset declarations each layer may enhance, decided from the layers
 * before they were flattened.
 *
 * No patch is dropped here: the composed result keeps every layer's own
 * effect, and a declaration a non-trusted layer supplied, reconfigured, or
 * reached through a containing group is recorded as ineligible for the
 * versioned compaction enhancement while remaining the effective declaration.
 * @param layers - ordered layers with their origins.
 * @param revision - composition revision the decision is recorded for.
 * @returns a decision for every declaration row the layers compose.
 */
function collectEnhancementOrigins(
  layers: readonly ProfilePatchLayer[], revision: number,
): ReadonlyMap<string, PresetEnhancementOrigin> {
  const origins = new Map<string, PresetEnhancementOrigin>()
  const disqualify = (rowId: string, reason: string): void => {
    // The first non-trusted layer to reach a declaration names the reason.
    if (!origins.has(rowId)) origins.set(rowId, { trusted: false, reason, revision })
  }
  let composed: EntryOptions[] = []
  for (const layer of layers) {
    const before = declarationFingerprints(composed)
    if (layer.patches.length > 0) composed = applyEntryPatches(composed, layer.patches, ignorePatchWarning)
    if (layer.origin.trusted) continue
    const label = `${layer.origin.kind} layer ${layer.origin.label}`
    const after = declarationFingerprints(composed)
    for (const [rowId, fingerprint] of after) {
      if (before.get(rowId) !== fingerprint) {
        disqualify(rowId, `preset declaration supplied or changed by the ${label}`)
      }
    }
    for (const patch of layer.patches) {
      if (patch.id === undefined) continue
      if (after.has(patch.id)) disqualify(patch.id, `preset declaration reconfigured by the ${label}`)
      for (const rowId of declarationsUnder(composed, patch.id)) {
        disqualify(rowId, `containing group ${patch.id} reconfigured by the ${label}`)
      }
    }
  }
  for (const rowId of declarationFingerprints(composed).keys()) {
    if (!origins.has(rowId)) origins.set(rowId, { trusted: true, revision })
  }
  return origins
}

/** A stable key of the resolved layer inputs. */
function compositionKey(layers: readonly ProfilePatchLayer[]): string {
  return JSON.stringify(layers.map(layer => [layer.origin, layer.patches]))
}

/** The composition one profile has applied, with the decisions read from its layers. */
interface AppliedComposition {
  /** Revision of the applied inputs; 1 for the first applied composition. */
  readonly revision: number
  /** Key of the applied inputs. */
  readonly key: string
  /** Enhancement decision per declaration row of that composition. */
  readonly origins: ReadonlyMap<string, PresetEnhancementOrigin>
}

/**
 * Per-profile composition state.
 *
 * `next` is a monotonic allocation counter: a rollback restores what was in
 * effect but never frees a number, so a later, different composition can never
 * inherit the identity of one that was rolled back.
 */
interface AppliedCompositionState {
  next: number
  applied?: AppliedComposition
}

/** Applied compositions by the profile context they belong to. */
const appliedCompositions = new WeakMap<ProfileContext, AppliedCompositionState>()

/**
 * Composition revision one profile has applied.
 * @param context - the profile context.
 * @returns the revision, or 0 before the first commit.
 */
export function profileCompositionRevision(context: ProfileContext): number {
  return appliedCompositions.get(context)?.applied?.revision ?? 0
}

/** One applied composition and the restore point it replaced. */
export interface AppliedCompositionHandle {
  /** Revision the applied composition is recorded at. */
  readonly revision: number
  /**
   * Restore what was applied before this candidate.
   *
   * An applier whose Loader update rejected calls this, so a candidate that
   * never mounted is not left recorded as the composition in effect.
   */
  rollback(): void
}

/**
 * Record the composition one profile is applying, at the point its layers are
 * handed to the Loader.
 *
 * Only the applier applies a composition: reading layers for a proposed or
 * rejected configuration leaves the running composition's decision and
 * revision untouched. Re-applying identical inputs keeps the revision
 * unchanged, and each profile context keeps its own, so reading one profile
 * never advances another root's composition.
 * @param context - the profile context whose Loader is being updated.
 * @param layers - the layers the applier is about to mount.
 * @returns the applied revision beside the restore point for a rejected update.
 */
export function applyProfileComposition(
  context: ProfileContext, layers: readonly ProfilePatchLayer[],
): AppliedCompositionHandle {
  const state = appliedCompositions.get(context) ?? { next: 0 }
  const previous = state.applied
  const key = compositionKey(layers)
  // Re-applying identical inputs keeps their identity; anything else takes the
  // next number, even when an earlier composition with that number was rolled
  // back, so a decision never validates against a different composition.
  const revision = previous !== undefined && previous.key === key ? previous.revision : ++state.next
  const applied: AppliedComposition = { revision, key, origins: collectEnhancementOrigins(layers, revision) }
  state.applied = applied
  appliedCompositions.set(context, state)
  let active = true
  return {
    revision,
    rollback: () => {
      if (!active) return
      active = false
      if (state.applied !== applied) return
      if (previous === undefined) delete state.applied
      else state.applied = previous
    },
  }
}

/**
 * Whether one preset declaration row may carry the versioned compaction
 * enhancement.
 *
 * The decision is the one the applied composition recorded from its layers,
 * so it cannot be inferred from a row id, a base URL, or a final composed
 * value. A declaration that no applied layer vouches for is not enhanceable.
 * @param context - the profile context those layers were read for, when the runtime has one.
 * @param rowId - Loader row id of the declaration.
 * @returns the recorded decision, or undefined when no profile layer produced this composition.
 */
export function presetEnhancementOrigin(
  context: ProfileContext | undefined, rowId: string | undefined,
): PresetEnhancementOrigin | undefined {
  if (context === undefined || rowId === undefined) return undefined
  const applied = appliedCompositions.get(context)?.applied
  if (applied === undefined) {
    return { trusted: false, reason: 'no profile composition has been applied in this process', revision: 0 }
  }
  return applied.origins.get(rowId)
    ?? { trusted: false, reason: 'the applied composition declares no origin for this row', revision: applied.revision }
}

/**
 * Read the ordered composition inputs with the origin that vouches for each,
 * before anything is flattened. Reading is pure: it neither advances the
 * composition revision nor changes the applied decisions.
 * @param binName - Diagnostic prefix for malformed or missing configuration.
 * @param context - Data supplied by the profile launcher.
 * @param initialProfile - Already loaded startup profile; omitted reads the current files.
 * @returns ordered layers, every patch exactly as written.
 */
export function readProfilePatchLayers(
  binName: string, context: ProfileContext, initialProfile?: Profile,
): ProfilePatchLayer[] {
  const revision = profileCompositionRevision(context)
  const profile = initialProfile ?? loadProfileDirectory(binName, context.dir, context.installAnchor, { userLayer: false })
  const layers: ProfilePatchLayer[] = profile.layers.map(layer => ({
    origin: initialProfile !== undefined && bundleLayerStale(layer, context.installAnchor)
      ? { ...layer.origin, trusted: false, stale: true }
      : layer.origin,
    patches: structuredClone(layer.patches),
    revision,
  }))
  const userPatches = initialProfile?.patches ?? loadOptionalPatches(binName, context.patchPath)
  layers.push({
    origin: { kind: 'profile', label: context.patchPath, trusted: false, installAnchor: context.installAnchor },
    patches: structuredClone(userPatches ?? []),
    revision,
  })
  const homePath = join(context.home, PROFILE_PATCH_FILENAME)
  const homePatches = loadOptionalPatches(binName, homePath)
  if (homePatches !== undefined) {
    layers.push({
      origin: { kind: 'home', label: homePath, trusted: false, installAnchor: context.installAnchor },
      patches: structuredClone(homePatches),
      revision,
    })
  }
  if (context.overlays.length > 0) {
    layers.push({
      origin: { kind: 'overlay', label: 'command-line overlays', trusted: false, installAnchor: context.installAnchor },
      patches: structuredClone([...context.overlays]),
      revision,
    })
  }
  const telemetryPatch = resolveTelemetryPatch(context.telemetryDisabledEnv,
    composeEntries(layers.map(layer => layer.patches)).some(row => row.id === TELEMETRY_ROW_ID))
  if (telemetryPatch !== undefined) {
    layers.push({
      origin: { kind: 'overlay', label: 'launcher overlays', trusted: false, installAnchor: context.installAnchor },
      patches: [telemetryPatch],
      revision,
    })
  }
  return layers
}

/** Read current bundle and user layers with the launch-time overlays.
 * @param binName Diagnostic prefix for malformed or missing configuration.
 * @param context Data supplied by the profile launcher.
 * @param initialProfile Already loaded startup profile; omitted reads the current files.
 * @returns Detached ordered patches; this function does not update the Loader.
 */
export function readProfilePatches(binName: string, context: ProfileContext, initialProfile?: Profile): PatchOptions[] {
  return readProfilePatchLayers(binName, context, initialProfile).flatMap(layer => layer.patches)
}
