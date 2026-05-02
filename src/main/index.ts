import { app, BrowserWindow, session, shell } from 'electron'
import path from 'path'
import os from 'os'
import { Database } from './database'
import { registerIpcHandlers, sendIndexerStatus } from './ipc-handlers'
import { triggerIndexer } from './indexer'

const DB_PATH = path.join(os.homedir(), '.ccrewind', 'index.db')

let db: Database | null = null

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    titleBarStyle: 'hiddenInset',
    title: 'ccRewind'
  })

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

app.whenReady().then(() => {
  // CSP — production 由 index.html <meta> 處理；dev 放行 Vite HMR 所需
  if (!app.isPackaged) {
    const devCsp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self' ws://localhost:*"
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [devCsp]
        }
      })
    })
  }

  // 初始化 Database + IPC
  db = new Database(DB_PATH)
  registerIpcHandlers(db)

  const mainWindow = createWindow()

  // 等 renderer 載入完成再啟動索引，避免早期狀態事件遺失
  mainWindow.webContents.once('did-finish-load', () => {
    triggerIndexer(db!, sendIndexerStatus).catch((err) => {
      console.error('Indexer failed:', err)
    })
  })

  // 視窗 focus → 自動 reindex（in-flight 合併防 thrashing；
  // 跨平台行為：macOS cmd+H/cmd+tab/dock click 與 Win/Linux 切回前台均觸發）
  mainWindow.on('focus', () => {
    triggerIndexer(db!, sendIndexerStatus).catch((err) => {
      console.error('Focus reindex failed:', err)
    })
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  db?.close()
  db = null
})
