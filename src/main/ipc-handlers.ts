import { ipcMain, BrowserWindow } from 'electron'
import type { Database } from './database'
import type { IndexerStatus } from '../shared/types'
import { exportSessionAsMarkdown } from './exporter'
import { checkForUpdates, getUpdateState, openReleasePage, dismissUpdate } from './updater'

/** 註冊所有 IPC handlers（invoke/handle 模式） */
export function registerIpcHandlers(db: Database): void {
  ipcMain.handle('projects:list', () => db.getProjects())

  ipcMain.handle('sessions:list', (_event, projectId: unknown) => {
    if (typeof projectId !== 'string') throw new Error('Invalid projectId')
    return db.getSessions(projectId)
  })

  ipcMain.handle('session:load', (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') throw new Error('Invalid sessionId')
    return db.getMessages(sessionId)
  })

  ipcMain.handle('search:query', (_event, query: unknown, projectId?: unknown) => {
    if (typeof query !== 'string') throw new Error('Invalid query')
    const pid = projectId == null ? null : typeof projectId === 'string' ? projectId : String(projectId)
    return db.search(query, pid)
  })

  ipcMain.handle('export:markdown', async (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') throw new Error('Invalid sessionId')
    return exportSessionAsMarkdown(db, sessionId)
  })

  // ── 更新檢查 ──

  ipcMain.handle('updates:check', () => checkForUpdates())

  ipcMain.handle('updates:get-state', () => getUpdateState())

  ipcMain.handle('updates:open-release', () => openReleasePage())

  ipcMain.handle('updates:dismiss', (_event, version: unknown) => {
    if (typeof version !== 'string') throw new Error('Invalid version')
    dismissUpdate(version)
  })
}

/** 廣播 indexer 進度到所有 renderer window */
export function sendIndexerStatus(status: IndexerStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('indexer:status', status)
  }
}
