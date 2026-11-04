import { app, BrowserWindow, session } from 'electron'
import path from 'path'
import os from 'os'
import { Database } from './database'
import { registerIpcHandlers, sendIndexerStatus } from './ipc-handlers'
import { triggerIndexer } from './indexer'
import { createMainWindow } from './mainWindow'
import { isFocusFromShowing } from './showWhenReady'

const DB_PATH = path.join(os.homedir(), '.ccrewind', 'index.db')

let db: Database | null = null

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

  const mainWindow = createMainWindow()

  // 等 renderer 載入完成再啟動索引，避免早期狀態事件遺失
  mainWindow.webContents.once('did-finish-load', () => {
    triggerIndexer(db!, sendIndexerStatus).catch((err) => {
      console.error('Indexer failed:', err)
    })

    // focus listener 也在 did-finish-load 後才註冊：避免冷啟時 OS focus
    // 早於 renderer ready 觸發 reindex，使快速跑完的 done event 在 renderer
    // 訂閱前被靜默丟棄，連帶讓後續 did-finish-load triggerIndexer 因
    // inFlight 已重置而重跑一次。
    mainWindow.on('focus', () => {
      // 視窗畫好才顯示（showWhenReady），顯示帶來的 focus 多半會落在這之後：它不是使用者切回來，上面才剛索引過
      if (isFocusFromShowing(mainWindow)) return
      triggerIndexer(db!, sendIndexerStatus).catch((err) => {
        console.error('Focus reindex failed:', err)
      })
    })
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
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
