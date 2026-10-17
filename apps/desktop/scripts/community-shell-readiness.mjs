/** Renderer text that reports a failure to reject, even when a later snapshot replaces it. */
export const FAILURE_TEXT = /Unable to create default workspace|无法创建默认工作区|Failed to load plugins/u

/** Renderer text that marks a transient connecting or loading state that has not settled. */
const PENDING_TEXT = /Reconnecting|重新连接中|Loading settings|正在加载设置|Loading plugins/u

/** Input placeholder shown while no workspace session is open: the default workspace is not usable yet. */
export const WORKSPACE_PLACEHOLDER_TEXT = /选择一个工作区开始|Choose a workspace to start/u

/**
 * Distinguish a fully usable mounted application from the boot, connecting and
 * settings-loading pages. Controls present without `boot` only prove React
 * mounted; the Host connection must have settled, settings must be ready, a
 * workspace session must be open (the placeholder is gone), and reported
 * failure states reject instead of passing as ready.
 */
export function isDesktopUiReady(document) {
  return document?.ready === 'complete' && document.boot === false
    && document.controls > 0 && document.width > 0 && document.height > 0
    && document.text.trim().length > 10
    && !PENDING_TEXT.test(document.text)
    && !FAILURE_TEXT.test(document.text)
    && !WORKSPACE_PLACEHOLDER_TEXT.test(document.text)
}
