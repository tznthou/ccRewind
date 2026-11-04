import path from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeBrowserWindow } from './fixtures/fakeBrowserWindow'

// 主視窗的建立原本寫在 index.ts(Electron 入口, 測試載入不了): 拿掉 show: false 或 showWhenReady 的呼叫,
// typecheck / lint / 測試 / CI smoke(不開窗)都照樣綠 → 搬進 mainWindow.ts, 用假的 BrowserWindow 驗
const electronState = vi.hoisted(() => ({ isPackaged: false }))
vi.mock('electron', async () => {
  const { FakeBrowserWindow: Fake } = await import('./fixtures/fakeBrowserWindow')
  return {
    BrowserWindow: Fake,
    app: {
      get isPackaged() {
        return electronState.isPackaged
      },
    },
    shell: { openExternal: vi.fn() },
  }
})

import { shell } from 'electron'
import { createMainWindow } from '../src/main/mainWindow'
import { SHOW_FOCUS_GRACE_MS } from '../src/main/showWhenReady'

// 只驗建立視窗本身的測試不在乎索引
const noIndex = (): void => {}

function lastWindow(): FakeBrowserWindow {
  const win = FakeBrowserWindow.instances[FakeBrowserWindow.instances.length - 1]
  if (!win) throw new Error('no window was created')
  return win
}

beforeEach(() => {
  FakeBrowserWindow.reset()
  electronState.isPackaged = false
  vi.stubEnv('ELECTRON_RENDERER_URL', undefined)
  vi.mocked(shell.openExternal).mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('createMainWindow', () => {
  it('creates the window hidden, with an isolated and sandboxed renderer', () => {
    createMainWindow(noIndex)
    const { options } = lastWindow()
    expect(options.show).toBe(false)
    expect(options.webPreferences).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true })
    expect((options.webPreferences as { preload: string }).preload.endsWith(path.join('preload', 'index.js'))).toBe(true)
  })

  it('shows the window only once the renderer has painted', () => {
    createMainWindow(noIndex)
    const win = lastWindow()
    expect(win.showCalls).toBe(0)
    win.emit('ready-to-show')
    expect(win.showCalls).toBe(1)
  })

  // #4: 只有開發中才載入 dev server
  it('loads the built page in a packaged app even when ELECTRON_RENDERER_URL is set', () => {
    electronState.isPackaged = true
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    createMainWindow(noIndex)
    const win = lastWindow()
    expect(win.loadedURL).toBeNull()
    expect(win.loadedFile?.endsWith(path.join('renderer', 'index.html'))).toBe(true)
  })

  it('loads the dev server in development', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    createMainWindow(noIndex)
    expect(lastWindow().loadedURL).toBe('http://localhost:5173')
    expect(lastWindow().loadedFile).toBeNull()
  })

  it('loads the built page when there is no dev server', () => {
    createMainWindow(noIndex)
    const win = lastWindow()
    expect(win.loadedURL).toBeNull()
    expect(win.loadedFile?.endsWith(path.join('renderer', 'index.html'))).toBe(true)
  })

  it('denies every new window', () => {
    createMainWindow(noIndex)
    expect(lastWindow().webContents.openHandler?.()).toEqual({ action: 'deny' })
  })
})

describe('createMainWindow: navigation', () => {
  function navigate(url: string): ReturnType<typeof vi.fn> {
    createMainWindow(noIndex)
    const preventDefault = vi.fn()
    lastWindow().webContents.emit('will-navigate', { preventDefault }, url)
    return preventDefault
  }

  it.each(['https://example.com/a', 'http://example.com/b'])('keeps the page and opens %s in the browser', (url) => {
    const preventDefault = navigate(url)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(shell.openExternal).toHaveBeenCalledWith(url)
  })

  it.each(['file:///etc/hosts', 'javascript:alert(1)', 'mailto:a@example.com'])('keeps the page and does not open %s', (url) => {
    const preventDefault = navigate(url)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(shell.openExternal).not.toHaveBeenCalled()
  })

  it('keeps the page and ignores a URL it cannot parse', () => {
    const preventDefault = navigate('http://[')
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(shell.openExternal).not.toHaveBeenCalled()
  })

  it('lets the page navigate to its own URL', () => {
    const preventDefault = navigate('file:///app/out/renderer/index.html')
    expect(preventDefault).not.toHaveBeenCalled()
    expect(shell.openExternal).not.toHaveBeenCalled()
  })
})

// 索引的兩個觸發掛在每個建出來的視窗上: macOS 關掉最後一個視窗後 app 還在, 從 Dock 點開會由 activate
// 再建一個視窗; 觸發原本只掛在啟動時那一個上, 重開的視窗不會索引, 也收不到任何索引狀態(Sync 那列不出現)
describe('createMainWindow: indexing', () => {
  it('indexes once the page has loaded, not before', () => {
    const reindex = vi.fn()
    createMainWindow(reindex)
    expect(reindex).not.toHaveBeenCalled()
    lastWindow().webContents.emit('did-finish-load')
    expect(reindex).toHaveBeenCalledTimes(1)
    expect(reindex).toHaveBeenCalledWith('load')
  })

  it('reindexes when the user comes back to the window after the page has loaded', () => {
    vi.useFakeTimers()
    const reindex = vi.fn()
    createMainWindow(reindex)
    const win = lastWindow()
    win.webContents.emit('did-finish-load')
    win.emit('ready-to-show')
    vi.advanceTimersByTime(SHOW_FOCUS_GRACE_MS)
    reindex.mockClear()
    win.emit('focus')
    expect(reindex).toHaveBeenCalledTimes(1)
    expect(reindex).toHaveBeenCalledWith('focus')
  })

  // 監聽在頁面載入完才註冊: 太早的 focus 觸發的索引跑完時, renderer 還沒訂閱狀態
  it('does not reindex on a focus before the page has loaded', () => {
    const reindex = vi.fn()
    createMainWindow(reindex)
    lastWindow().emit('focus')
    expect(reindex).not.toHaveBeenCalled()
  })

  it('skips the focus that showing the window brings', () => {
    vi.useFakeTimers()
    const reindex = vi.fn()
    createMainWindow(reindex)
    const win = lastWindow()
    win.webContents.emit('did-finish-load')
    win.emit('ready-to-show')
    reindex.mockClear()
    vi.advanceTimersByTime(30)
    win.emit('focus')
    expect(reindex).not.toHaveBeenCalled()
  })

  // reload 會再送一次 did-finish-load: 不再索引, 也不多掛一個 focus 監聽
  it('counts the page load once per window, even when the page reloads', () => {
    vi.useFakeTimers()
    const reindex = vi.fn()
    createMainWindow(reindex)
    const win = lastWindow()
    win.webContents.emit('did-finish-load')
    win.webContents.emit('did-finish-load')
    vi.advanceTimersByTime(SHOW_FOCUS_GRACE_MS)
    win.emit('focus')
    expect(reindex.mock.calls).toEqual([['load'], ['focus']])
  })

  it('gives a window created later, as on a Dock click after closing it, its own triggers', () => {
    vi.useFakeTimers()
    const reindex = vi.fn()
    createMainWindow(reindex)
    lastWindow().webContents.emit('did-finish-load')
    createMainWindow(reindex)
    const reopened = lastWindow()
    expect(FakeBrowserWindow.instances).toHaveLength(2)
    reindex.mockClear()
    reopened.webContents.emit('did-finish-load')
    expect(reindex).toHaveBeenCalledWith('load')
    reopened.emit('ready-to-show')
    vi.advanceTimersByTime(SHOW_FOCUS_GRACE_MS)
    reindex.mockClear()
    reopened.emit('focus')
    expect(reindex).toHaveBeenCalledWith('focus')
  })
})
