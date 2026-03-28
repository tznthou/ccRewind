import type { IndexerStatus, ParsedSession } from '../shared/types'
import type { Database } from './database'
import { scanProjects } from './scanner'
import { parseSession } from './parser'

export type ProgressCallback = (status: IndexerStatus) => void

/**
 * 執行首次/增量索引。
 * 掃描 baseDir 下所有 JSONL，比對 file_mtime 決定哪些需要（重新）索引，
 * 解析後寫入 DB。
 */
export async function runIndexer(
  db: Database,
  onProgress?: ProgressCallback,
  baseDir?: string,
): Promise<void> {
  // 1. SCANNING
  onProgress?.({ phase: 'scanning', progress: 0, total: 0, current: 0 })
  const projects = await scanProjects(baseDir)

  // 確保所有 project 都寫入 DB（含空 project）
  for (const project of projects) {
    db.upsertProject(project.projectId, project.displayName)
  }

  // 2. DIFFING — 批次取得所有已索引 mtime，避免 N+1 query
  interface SessionToIndex {
    filePath: string
    fileSize: number
    fileMtime: string
    sessionId: string
    projectId: string
    projectDisplayName: string
  }

  const existingMtimes = db.getAllSessionMtimes()
  const sessionsToIndex: SessionToIndex[] = []
  const scannedSessionIds = new Set<string>()
  const affectedProjects = new Set<string>()

  for (const project of projects) {
    for (const session of project.sessions) {
      scannedSessionIds.add(session.sessionId)
      const existingMtime = existingMtimes.get(session.sessionId)
      if (existingMtime === undefined || existingMtime !== session.fileMtime) {
        sessionsToIndex.push({
          ...session,
          projectId: project.projectId,
          projectDisplayName: project.displayName,
        })
        affectedProjects.add(project.projectId)
      }
    }
  }

  // 移除 DB 中存在但掃描不到的 stale session
  db.removeStaleSessionsExcept(scannedSessionIds)

  // 3. INDEXING
  const total = sessionsToIndex.length

  for (let i = 0; i < total; i++) {
    onProgress?.({
      phase: 'indexing',
      progress: Math.round((i / total) * 100),
      total,
      current: i,
    })

    const s = sessionsToIndex[i]

    // 解析 JSONL — 讀取失敗跳過，不中斷
    let parsed: ParsedSession
    try {
      parsed = await parseSession(s.filePath, s.sessionId)
    } catch {
      continue
    }

    // DB 寫入 — 失敗向上拋出（不應靜默）
    db.indexSession({
      sessionId: s.sessionId,
      projectId: s.projectId,
      projectDisplayName: s.projectDisplayName,
      title: parsed.title,
      messageCount: parsed.messages.length,
      filePath: s.filePath,
      fileSize: s.fileSize,
      fileMtime: s.fileMtime,
      startedAt: parsed.startedAt,
      endedAt: parsed.endedAt,
      messages: parsed.messages.map((msg, idx) => ({
        type: msg.type,
        role: msg.role,
        contentText: msg.contentText,
        contentJson: msg.contentJson,
        hasToolUse: msg.hasToolUse,
        hasToolResult: msg.hasToolResult,
        toolNames: msg.toolNames,
        timestamp: msg.timestamp,
        sequence: idx,
        rawJson: msg.rawJson,
      })),
    })
  }

  // 4. FINALIZE — 更新所有 project 統計（stale cleanup 可能影響任何 project）
  for (const project of projects) {
    db.updateProjectStats(project.projectId)
  }

  onProgress?.({ phase: 'done', progress: 100, total, current: total })
}
