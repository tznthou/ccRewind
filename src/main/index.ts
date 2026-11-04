import { app, BrowserWindow, session } from 'electron'
import path from 'path'
import os from 'os'
import { Database } from './database'
import { registerIpcHandlers, sendIndexerStatus } from './ipc-handlers'
import { triggerIndexer } from './indexer'
import { createMainWindow, type ReindexTrigger } from './mainWindow'

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

  // 每個主視窗(包括 macOS 從 Dock 重開的)都在頁面載入完、與使用者切回來時索引(觸發在 createMainWindow 裡)
  const reindex = (trigger: ReindexTrigger): void => {
    triggerIndexer(db!, sendIndexerStatus).catch((err) => {
      console.error(trigger === 'load' ? 'Indexer failed:' : 'Focus reindex failed:', err)
    })
  }
  createMainWindow(reindex)

  // 留在 whenReady 裡: ready 之前 db 還沒開
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(reindex)
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
