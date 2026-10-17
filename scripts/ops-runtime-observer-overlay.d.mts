/** Overlay generator options. */
export interface OverlayOptions {
  readonly observer: string
  readonly checkout: string
  readonly expectedHead: string
  readonly runNonce: string
  readonly outFile: string
}

/**
 * Build the overlay patch document that inserts the read-only observer.
 * @param options observer file, checkout, expected head, run nonce and output
 * @returns one YAML patch list as a string
 */
export declare function overlayDocument(options: OverlayOptions): string
