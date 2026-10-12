export interface DocumentsCommandResult {
  status: number | null
  stdout?: string | null
  stderr?: string | null
  error?: Error
}
export interface DocumentsCommandOptions {
  env: NodeJS.ProcessEnv
  encoding: 'utf8'
  timeout: number
}
export type DocumentsCommandRunner = (command: string, args: readonly string[], options: DocumentsCommandOptions) => DocumentsCommandResult
export interface DocumentsIsolation {
  root: string
  directory: string
  resolvedRoot: string | null
  resolvedDirectory: string | null
  isolated: boolean
}
export const MACOS_DOCUMENTS_SCRIPT: string
export const DOCUMENTS_LOOKUP_TIMEOUT_MS: number
export function isolatedProfileEnv(root: string, platform?: NodeJS.Platform): NodeJS.ProcessEnv
export function macosDocumentsDirectory(env: NodeJS.ProcessEnv, run?: DocumentsCommandRunner, timeoutMs?: number): string
export function documentsIsolation(directory: string, root: string): DocumentsIsolation
