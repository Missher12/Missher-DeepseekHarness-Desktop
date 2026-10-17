/** Prove the smoke profile resolves Documents inside its isolated root before an expensive package build. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { documentsIsolation, isolatedProfileEnv, macosDocumentsDirectory } from './community-shell-documents.mjs'

if (process.platform !== 'darwin') throw new Error('macOS Documents isolation preflight requires darwin')
const output = resolve(process.argv[2] ?? 'desktop-verification')
await mkdir(output, { recursive: true })
const root = await mkdtemp(join(tmpdir(), 'missher-documents-preflight-'))
try {
  await mkdir(join(root, 'Documents'), { recursive: true })
  const env = isolatedProfileEnv(root)
  const profile = { HOME: env.HOME ?? null, CFFIXED_USER_HOME: env.CFFIXED_USER_HOME ?? null }
  let verdict
  try {
    const documents = macosDocumentsDirectory(env)
    verdict = documentsIsolation(documents, root)
    if (!verdict.isolated) {
      throw new Error(`macOS Documents lookup left the isolated profile: '${documents}' does not resolve inside '${root}'`)
    }
  } catch (error) {
    await writeFile(join(output, 'documents-preflight.json'), JSON.stringify({ ...(verdict ?? {}), profile, error: error.message }, null, 2) + '\n')
    throw error
  }
  await writeFile(join(output, 'documents-preflight.json'), JSON.stringify({ ...verdict, profile }, null, 2) + '\n')
  console.log(`macOS Documents isolation verified: '${verdict.directory}' resolves inside '${root}'`)
} finally {
  await rm(root, { recursive: true, force: true })
}
