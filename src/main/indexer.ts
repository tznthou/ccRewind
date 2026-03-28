import type { IndexerStatus } from '../shared/types'
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

  // 2. DIFFING — 收集需要索引的 session
  interface SessionToIndex {
    filePath: string
    fileSize: number
    fileMtime: string
    sessionId: string
    projectId: string
    projectDisplayName: string
  }

  const sessionsToIndex: SessionToIndex[] = []
  const affectedProjects = new Set<string>()

  for (const project of projects) {
    for (const session of project.sessions) {
      const existingMtime = db.getSessionMtime(session.sessionId)
      if (existingMtime === null || existingMtime !== session.fileMtime) {
        sessionsToIndex.push({
          ...session,
          projectId: project.projectId,
          projectDisplayName: project.displayName,
        })
        affectedProjects.add(project.projectId)
      }
    }
  }

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
    try {
      const parsed = await parseSession(s.filePath, s.sessionId)

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
        })),
      })
    } catch {
      // 檔案不可讀或解析失敗 → 跳過該 session，不中斷
      continue
    }
  }

  // 4. FINALIZE — 更新受影響 project 的統計 + 所有空 project 的統計
  for (const project of projects) {
    db.updateProjectStats(project.projectId)
  }

  onProgress?.({ phase: 'done', progress: 100, total, current: total })
}
