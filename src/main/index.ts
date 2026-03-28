import { app, BrowserWindow, shell } from 'electron'
import path from 'path'
import os from 'os'
import { Database } from './database'
import { registerIpcHandlers, sendIndexerStatus } from './ipc-handlers'
import { runIndexer } from './indexer'

const DB_PATH = path.join(os.homedir(), '.ccrewind', 'index.db')

let db: Database | null = null

function createWindow(): void {
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

  // #3: External links open in default browser
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })
}

app.whenReady().then(() => {
  // 初始化 Database + IPC
  db = new Database(DB_PATH)
  registerIpcHandlers(db)

  createWindow()

  // 啟動索引（背景執行，不阻塞視窗）
  runIndexer(db, sendIndexerStatus).catch((err) => {
    console.error('Indexer failed:', err)
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
