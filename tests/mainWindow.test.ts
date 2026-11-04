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
    createMainWindow()
    const { options } = lastWindow()
    expect(options.show).toBe(false)
    expect(options.webPreferences).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true })
    expect((options.webPreferences as { preload: string }).preload.endsWith(path.join('preload', 'index.js'))).toBe(true)
  })

  it('shows the window only once the renderer has painted', () => {
    createMainWindow()
    const win = lastWindow()
    expect(win.showCalls).toBe(0)
    win.emit('ready-to-show')
    expect(win.showCalls).toBe(1)
  })

  // #4: 只有開發中才載入 dev server
  it('loads the built page in a packaged app even when ELECTRON_RENDERER_URL is set', () => {
    electronState.isPackaged = true
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    createMainWindow()
    const win = lastWindow()
    expect(win.loadedURL).toBeNull()
    expect(win.loadedFile?.endsWith(path.join('renderer', 'index.html'))).toBe(true)
  })

  it('loads the dev server in development', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    createMainWindow()
    expect(lastWindow().loadedURL).toBe('http://localhost:5173')
    expect(lastWindow().loadedFile).toBeNull()
  })

  it('loads the built page when there is no dev server', () => {
    createMainWindow()
    const win = lastWindow()
    expect(win.loadedURL).toBeNull()
    expect(win.loadedFile?.endsWith(path.join('renderer', 'index.html'))).toBe(true)
  })

  it('denies every new window', () => {
    createMainWindow()
    expect(lastWindow().webContents.openHandler?.()).toEqual({ action: 'deny' })
  })
})

describe('createMainWindow: navigation', () => {
  function navigate(url: string): ReturnType<typeof vi.fn> {
    createMainWindow()
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
