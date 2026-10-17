/** One structured observer failure. */
export interface ObserverFailure {
  readonly stage: string
  readonly code: string
}

/** Evidence the observer records for one dsh process. */
export interface ObserverEvidence {
  readonly state: 'runtime-observer'
  readonly runNonce: string
  readonly expectedHead: string | null
  readonly pid: number
  readonly observedAt: string
  readonly ok: boolean
  readonly failures: ObserverFailure[]
  readonly profileDir: string | null
  readonly installAnchor: string | null
  readonly observed: {
    readonly host: { readonly installAnchor: string | null; readonly manifest: string | null; readonly bin: string | null }
    readonly chain: { readonly cordis: string | null; readonly sandboxLocal: string | null; readonly subprocessLocal: string | null }
    readonly acl: { readonly main: string | null; readonly runner: string | null }
  }
  readonly expected: Record<string, string | null>
  readonly hashes: {
    readonly hostEntry: string | null
    readonly cordis: string | null
    readonly sandboxLocal: string | null
    readonly subprocessLocal: string | null
    readonly aclMain: string | null
    readonly aclRunner: string | null
  }
}

/** Observer configuration supplied by the generated overlay. */
export interface ObserverConfig {
  readonly checkout: string
  readonly expectedHead: string
  readonly runNonce: string
  readonly outFile: string
}

/**
 * Inspect the runtime the profile actually resolved.
 * @param profileContext the profile's own `{ dir, installAnchor }`
 * @param config observer configuration
 * @returns the evidence object (also appended to `config.outFile`)
 */
export declare function inspectRuntime(
  profileContext: { readonly dir: string; readonly installAnchor: string },
  config: ObserverConfig,
): ObserverEvidence

/** Plugin entry exported to the Loader. */
export declare const name: string
/** Injected services (none: the observer only reads `profileContext`). */
export declare const inject: readonly string[]
/**
 * Plugin entry: inspect once, throw on mismatch.
 * @param ctx the profile context
 * @param config observer configuration
 */
export declare function apply(ctx: { readonly profileContext: { readonly dir: string; readonly installAnchor: string }; readonly effect?: (run: () => void) => unknown }, config: ObserverConfig): void
