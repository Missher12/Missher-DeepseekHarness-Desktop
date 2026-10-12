import { describe, expect, it } from 'vitest'
import { isDesktopUiReady } from '../scripts/community-shell-readiness.mjs'

describe('community Desktop renderer acceptance', () => {
  const mounted = { ready: 'complete', boot: false, controls: 4, width: 1280, height: 820, text: 'New conversation\nSettings\nPlugins' }

  it('accepts the mounted application with usable controls', () => {
    expect(isDesktopUiReady(mounted)).toBe(true)
  })

  it('rejects the nonempty loading screenshot previously accepted by CI', () => {
    expect(isDesktopUiReady({ ...mounted, boot: true, controls: 0, text: 'HARNESS\nLoading plugins…' })).toBe(false)
  })

  it('rejects the renderer while the Host is still reconnecting and settings are pending', () => {
    expect(isDesktopUiReady({ ...mounted,
      text: 'New Session\nPlugins\nNo sessions yet\nReconnecting...\nChoose a workspace to start\nLoading settings…' })).toBe(false)
  })

  it('rejects the mounted shell before a workspace session is open', () => {
    expect(isDesktopUiReady({ ...mounted, text: 'New Session\nPlugins\nNo sessions yet\nChoose a workspace to start' })).toBe(false)
  })

  it('rejects the Chinese first-run shell before the default workspace is usable', () => {
    expect(isDesktopUiReady({ ...mounted, text: '新会话\n插件\n暂无会话\n选择工作区\n选择一个工作区开始' })).toBe(false)
  })

  it('rejects a reported default-workspace failure even with a mounted shell', () => {
    expect(isDesktopUiReady({ ...mounted, text: 'New Session\nUnable to create default workspace. Use Choose workspace to select a folder.' })).toBe(false)
  })

  it('rejects the Chinese Host failure toast', () => {
    expect(isDesktopUiReady({ ...mounted, text: '新会话\n无法创建默认工作区，请通过“选择工作区”选择文件夹' })).toBe(false)
  })

  it('rejects the Chinese renderer while the Host is reconnecting and settings are pending', () => {
    expect(isDesktopUiReady({ ...mounted, text: '新会话\n重新连接中...\n正在加载设置…' })).toBe(false)
  })

  it('rejects an error page even when it offers a retry button', () => {
    expect(isDesktopUiReady({ ...mounted, text: 'Failed to load plugins\nRetry' })).toBe(false)
  })

  it('rejects incomplete, empty and noninteractive documents', () => {
    expect(isDesktopUiReady(undefined)).toBe(false)
    expect(isDesktopUiReady({ ...mounted, ready: 'loading' })).toBe(false)
    expect(isDesktopUiReady({ ...mounted, controls: 0 })).toBe(false)
    expect(isDesktopUiReady({ ...mounted, text: '' })).toBe(false)
  })
})
