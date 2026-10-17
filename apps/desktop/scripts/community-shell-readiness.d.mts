export interface DesktopDocumentState {
  ready: string
  boot: boolean
  controls: number
  width: number
  height: number
  text: string
}
export const FAILURE_TEXT: RegExp
export const WORKSPACE_PLACEHOLDER_TEXT: RegExp
export function isDesktopUiReady(document: DesktopDocumentState | undefined): boolean
