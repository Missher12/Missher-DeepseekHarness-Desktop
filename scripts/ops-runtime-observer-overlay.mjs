// Generate the read-only observer overlay the Ops smoke profile passes with
// `PROJECT_OPS_EXTRA_PATCH`. The Ops scripts stay untouched; this file only
// writes one patch document that inserts the observer row.
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Build the overlay patch document.
 * @param options observer file, checkout, expected head, run nonce and output
 * @returns one YAML patch list (JSON is valid YAML) as a string
 */
export function overlayDocument(options) {
  return `${JSON.stringify([{ insert: [{
    id: 'ops-runtime-observer',
    name: pathToFileURL(resolve(options.observer)).href,
    config: {
      checkout: resolve(options.checkout),
      expectedHead: options.expectedHead,
      runNonce: options.runNonce,
      outFile: resolve(options.outFile),
    },
  }] }], null, 2)}\n`
}

/**
 * CLI: write the overlay where the workflow points `PROJECT_OPS_EXTRA_PATCH`.
 * @param argv `--out`, `--observer`, `--checkout`, `--expected-head`, `--nonce`, `--out-file`
 */
function main(argv) {
  const option = name => {
    const index = argv.indexOf(`--${name}`)
    if (index < 0 || argv[index + 1] === undefined) throw new Error(`missing --${name}`)
    return argv[index + 1]
  }
  const out = resolve(option('out'))
  writeFileSync(out, overlayDocument({
    observer: option('observer'),
    checkout: option('checkout'),
    expectedHead: option('expected-head'),
    runNonce: option('nonce'),
    outFile: option('out-file'),
  }))
  process.stdout.write(`${out}\n`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2))
