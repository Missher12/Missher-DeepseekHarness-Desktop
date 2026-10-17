/** One prepared host-root link set: package name to absolute checkout directory. */
export declare function hostLinks(checkout: string): Record<string, string>

/** One structured, stage-tagged failure. */
export interface BindingFailure {
  readonly stage: string
  readonly code?: string
  readonly reason: string
}

/** Result of preparing or verifying a binding. */
export interface BindingFacts {
  readonly ok: boolean
  readonly failures: BindingFailure[]
  readonly stage?: string
  readonly hostPackage?: {
    readonly manifest: string | null
    readonly dir: string | null
    readonly builtEntry: string | null
    readonly builtEntrySha256: string | null
  } | null
  readonly chain?: Record<string, { readonly entry: string | null; readonly entrySha256: string | null }>
  readonly head?: { readonly expected: string | null; readonly actual: string | null; readonly source: string }
  readonly [key: string]: unknown
}

/**
 * Create one fresh isolated host root owned by this call. Refuses an existing
 * root instead of repairing it.
 * @param hostRoot absolute directory that must not exist yet
 * @param checkout absolute repository root
 * @param links package name to absolute checkout directory
 * @returns whether every link target exists
 */
export declare function prepareHostRoot(hostRoot: string, checkout: string, links: Record<string, string>): BindingFacts

/**
 * Read-only verification of one prepared root against one checkout.
 * @param hostRoot absolute isolated root
 * @param checkout absolute repository root
 * @param options expected and actual `git rev-parse HEAD`
 * @returns facts including `ok` and structured `failures`
 */
export declare function verifyBinding(hostRoot: string, checkout: string, options?: { expectedHead?: string; actualHead?: string | null }): BindingFacts
