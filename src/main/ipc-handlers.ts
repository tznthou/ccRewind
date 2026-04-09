import { ipcMain, BrowserWindow } from 'electron'
import type { Database } from './database'
import type { IndexerStatus, SearchOptions } from '../shared/types'
import { exportSessionAsMarkdown } from './exporter'
import { checkForUpdates, getUpdateState, openReleasePage, dismissUpdate } from './updater'

/** 將 unknown 轉為 optional string（IPC 參數驗證用） */
function parseOptionalString(v: unknown): string | null {
  return v != null && typeof v === 'string' ? v : null
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 將 unknown 轉為 SearchOptions（IPC 參數驗證用） */
function parseSearchOptions(v: unknown): SearchOptions | undefined {
  if (v == null || typeof v !== 'object') return undefined
  const obj = v as Record<string, unknown>
  const opts: SearchOptions = {}
  if (typeof obj.dateFrom === 'string' && ISO_DATE_RE.test(obj.dateFrom)) opts.dateFrom = obj.dateFrom
  if (typeof obj.dateTo === 'string' && ISO_DATE_RE.test(obj.dateTo)) opts.dateTo = obj.dateTo
  if (obj.sortBy === 'rank' || obj.sortBy === 'date') opts.sortBy = obj.sortBy
  return opts
}

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

  ipcMain.handle('search:query', (_event, query: unknown, projectId?: unknown, offset?: unknown, options?: unknown) => {
    if (typeof query !== 'string') throw new Error('Invalid query')
    if (query.length > 500) throw new Error('Query too long')
    const pid = projectId == null ? null : typeof projectId === 'string' ? projectId : String(projectId)
    const off = typeof offset === 'number' ? offset : 0
    return db.search(query, pid, off, undefined, parseSearchOptions(options))
  })

  ipcMain.handle('search:sessions', (_event, query: unknown, projectId?: unknown, offset?: unknown, options?: unknown) => {
    if (typeof query !== 'string') throw new Error('Invalid query')
    if (query.length > 500) throw new Error('Query too long')
    const pid = projectId == null ? null : typeof projectId === 'string' ? projectId : String(projectId)
    const off = typeof offset === 'number' ? offset : 0
    return db.searchSessions(query, pid, off, undefined, parseSearchOptions(options))
  })

  ipcMain.handle('message:context', (_event, messageId: unknown, range?: unknown) => {
    if (typeof messageId !== 'number') throw new Error('Invalid messageId')
    const r = typeof range === 'number' ? Math.min(Math.max(range, 0), 10) : 2
    return db.getMessageContext(messageId, r)
  })

  ipcMain.handle('session:token-stats', (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') throw new Error('Invalid sessionId')
    return db.getSessionTokenStats(sessionId)
  })

  ipcMain.handle('export:markdown', async (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') throw new Error('Invalid sessionId')
    return exportSessionAsMarkdown(db, sessionId)
  })

  // ── Phase 3.5: 檔案考古 ──

  ipcMain.handle('files:history', (_event, filePath: unknown) => {
    if (typeof filePath !== 'string') throw new Error('Invalid filePath')
    return db.getFileHistory(filePath)
  })

  ipcMain.handle('files:session', (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') throw new Error('Invalid sessionId')
    return db.getSessionFiles(sessionId)
  })

  ipcMain.handle('session:related', (_event, sessionId: unknown, limit?: unknown) => {
    if (typeof sessionId !== 'string') throw new Error('Invalid sessionId')
    const l = typeof limit === 'number' ? Math.min(Math.max(limit, 1), 20) : 5
    return db.getRelatedSessions(sessionId, l)
  })

  ipcMain.handle('session:subagents', (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') throw new Error('Invalid sessionId')
    return db.getSubagentSessions(sessionId)
  })

  // ── Phase 3.5: 統計儀表板 ──

  ipcMain.handle('stats:usage', (_event, projectId?: unknown, days?: unknown) => {
    const pid = parseOptionalString(projectId)
    const d = typeof days === 'number' && Number.isFinite(days) ? Math.max(1, Math.min(Math.round(days), 365)) : 30
    return db.getUsageStats(pid, d)
  })

  ipcMain.handle('stats:projects', () => db.getProjectStats())

  ipcMain.handle('stats:tools', (_event, projectId?: unknown) => {
    const pid = parseOptionalString(projectId)
    return db.getToolDistribution(pid)
  })

  ipcMain.handle('stats:tags', (_event, projectId?: unknown) => {
    const pid = parseOptionalString(projectId)
    return db.getTagDistribution(pid)
  })

  ipcMain.handle('stats:patterns', (_event, projectId?: unknown) => {
    const pid = parseOptionalString(projectId)
    return db.getWorkPatterns(pid)
  })

  // ── Phase 4: Dashboard 進階功能 ──

  ipcMain.handle('stats:efficiency', (_event, projectId?: unknown, days?: unknown) => {
    const pid = parseOptionalString(projectId)
    const d = Number.isFinite(days) ? (days as number) : 30
    return db.getEfficiencyTrend(pid, d)
  })

  ipcMain.handle('stats:waste', (_event, projectId?: unknown, limit?: unknown) => {
    const pid = parseOptionalString(projectId)
    const l = Number.isFinite(limit) ? Math.min(Math.max(limit as number, 1), 50) : 20
    return db.getWasteSessions(pid, l)
  })

  ipcMain.handle('stats:project-health', () => db.getProjectHealth())

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
