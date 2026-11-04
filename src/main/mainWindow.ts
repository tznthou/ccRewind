import { app, BrowserWindow, shell } from 'electron'
import path from 'path'
import { showWhenReady } from './showWhenReady'

// 主視窗的建立(從 index.ts 搬出來): index.ts 是 Electron 入口, 測試載入不了;
// 這裡由 tests/mainWindow.test.ts 用 vi.mock('electron') 換成假的 BrowserWindow 驗
export function createMainWindow(): BrowserWindow {
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

  return mainWindow
}
