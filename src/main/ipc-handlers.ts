import { ipcMain, BrowserWindow } from 'electron'
import type { Database } from './database'
import type { IndexerStatus } from '../shared/types'

/** 註冊所有 IPC handlers（invoke/handle 模式） */
export function registerIpcHandlers(db: Database): void {
  ipcMain.handle('projects:list', () => db.getProjects())

  ipcMain.handle('sessions:list', (_event, projectId: string) =>
    db.getSessions(projectId),
  )

  ipcMain.handle('session:load', (_event, sessionId: string) =>
    db.getMessages(sessionId),
  )

  ipcMain.handle('search:query', (_event, query: string, projectId?: string | null) =>
    db.search(query, projectId),
  )
}

/** 廣播 indexer 進度到所有 renderer window */
export function sendIndexerStatus(status: IndexerStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('indexer:status', status)
  }
}
