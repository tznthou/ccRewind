import { app, BrowserWindow, shell } from 'electron'
import path from 'path'
import { isFocusFromShowing, showWhenReady } from './showWhenReady'

/** 索引從哪裡觸發: 頁面載入完(load)或使用者切回視窗(focus) */
export type ReindexTrigger = 'load' | 'focus'

// 主視窗的建立(從 index.ts 搬出來), 由 tests/mainWindow.test.ts 用 vi.mock('electron') 換成假的 BrowserWindow 驗。
// 索引的兩個觸發掛在每個建出來的視窗上: macOS 關掉最後一個視窗後 app 還在, 從 Dock 點開時 activate 會再建一個
export function createMainWindow(reindex: (trigger: ReindexTrigger) => void): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    // 畫好再顯示（showWhenReady）：一建立就顯示的話，網頁第一次畫出來之前整個視窗是預設的白底
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    titleBarStyle: 'hiddenInset',
    title: 'ccRewind'
  })
  showWhenReady(mainWindow)

  // #4: Only load dev server URL in development
  if (process.env.ELECTRON_RENDERER_URL && !app.isPackaged) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // #3: Deny new window creation
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' }
  })

  // #3: External links open in default browser (protocol whitelist)
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault()
      try {
        const parsed = new URL(url)
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
          shell.openExternal(url)
        }
      } catch {
        // invalid URL — silently ignore
      }
    }
  })

  // 等 renderer 載入完成再啟動索引，避免早期狀態事件遺失
  mainWindow.webContents.once('did-finish-load', () => {
    reindex('load')

    // focus listener 也在 did-finish-load 後才註冊：避免冷啟時 OS focus
    // 早於 renderer ready 觸發 reindex，使快速跑完的 done event 在 renderer
    // 訂閱前被靜默丟棄，連帶讓後續 did-finish-load triggerIndexer 因
    // inFlight 已重置而重跑一次。
    mainWindow.on('focus', () => {
      // 視窗畫好才顯示（showWhenReady），顯示帶來的 focus 多半會落在這之後：它不是使用者切回來，上面才剛索引過
      if (isFocusFromShowing(mainWindow)) return
      reindex('focus')
    })
  })

  return mainWindow
}
