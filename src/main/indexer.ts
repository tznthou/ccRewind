import path from 'node:path'
import type { IndexerStatus, ParsedSession } from '../shared/types'
import type { Database } from './database'
import { scanProjects, scanSubagents } from './scanner'
import { parseSession } from './parser'
import { summarizeSession } from './summarizer'

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
      const existing = existingMtimes.get(session.sessionId)
      // 重新索引條件：新 session、mtime 變更、或 archived session 重新出現
      if (!existing || existing.mtime !== session.fileMtime || existing.archived) {
        sessionsToIndex.push({
          ...session,
          projectId: project.projectId,
          projectDisplayName: project.displayName,
        })
        affectedProjects.add(project.projectId)
      }
    }
  }

  // 標記 DB 中存在但掃描不到的 session 為 archived
  db.archiveStaleSessionsExcept(scannedSessionIds)

  // 3. INDEXING — 按 fileMtime 升冪排序，確保舊 session 先索引（UUID 去重依賴此順序）
  sessionsToIndex.sort((a, b) => a.fileMtime.localeCompare(b.fileMtime))
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

    // UUID 去重：過濾掉其他 session 已索引的 replay entries
    const uuids = parsed.messages.filter(m => m.uuid).map(m => m.uuid!)
    const existingUuids = uuids.length > 0 ? db.getExistingUuids(uuids) : new Set<string>()
    const messages = parsed.messages.filter(m => !(m.uuid && existingUuids.has(m.uuid)))

    // 純 replay session（所有 messages 都被去重）→ 跳過，不寫入 DB
    if (messages.length === 0 && parsed.messages.length > 0) continue

    // 去重後的時間範圍
    let startedAt = parsed.startedAt
    let endedAt = parsed.endedAt
    if (existingUuids.size > 0 && messages.length > 0) {
      const timestamps = messages.filter(m => m.timestamp).map(m => m.timestamp!)
      if (timestamps.length > 0) {
        startedAt = timestamps.reduce((a, b) => a < b ? a : b)
        endedAt = timestamps.reduce((a, b) => a > b ? a : b)
      }
    }

    // 用去重後的 messages 產生 session 摘要 + session_files
    const { summary, sessionFiles } = summarizeSession(messages, startedAt, endedAt)

    // DB 寫入 — 失敗向上拋出（不應靜默）
    db.indexSession({
      sessionId: s.sessionId,
      projectId: s.projectId,
      projectDisplayName: s.projectDisplayName,
      title: parsed.title,
      messageCount: messages.length,
      filePath: s.filePath,
      fileSize: s.fileSize,
      fileMtime: s.fileMtime,
      startedAt,
      endedAt,
      summaryText: summary.summaryText,
      intentText: summary.intentText || null,
      outcomeStatus: summary.outcomeStatus,
      outcomeSignals: JSON.stringify(summary.outcomeSignals),
      durationSeconds: summary.durationSeconds,
      activeDurationSeconds: summary.activeDurationSeconds,
      summaryVersion: summary.summaryVersion,
      tags: summary.tags,
      filesTouched: summary.filesTouched,
      toolsUsed: summary.toolsUsed,
      sessionFiles,
      messages: messages.map((msg, idx) => ({
        type: msg.type,
        uuid: msg.uuid,
        role: msg.role,
        contentText: msg.contentText,
        contentJson: msg.contentJson,
        hasToolUse: msg.hasToolUse,
        hasToolResult: msg.hasToolResult,
        toolNames: msg.toolNames,
        timestamp: msg.timestamp,
        sequence: idx,
        rawJson: msg.rawJson,
        inputTokens: msg.inputTokens,
        outputTokens: msg.outputTokens,
        cacheReadTokens: msg.cacheReadTokens,
        cacheCreationTokens: msg.cacheCreationTokens,
        model: msg.model,
      })),
    })
  }

  // 4. SUBAGENT SCANNING — 對有變動的 session，掃描 subagents/
  const existingSubMtimes = db.getAllSubagentMtimes()
  for (const project of projects) {
    for (const session of project.sessions) {
      // session 目錄：<project>/<sessionId>/
      const sessionDir = path.join(path.dirname(session.filePath), session.sessionId)
      let subagents
      try {
        subagents = await scanSubagents(sessionDir, session.sessionId)
      } catch {
        continue
      }
      if (subagents.length === 0) continue

      // 清理磁碟已刪除的 stale subagents
      const scannedSubIds = new Set(subagents.map(s => s.subagentId))
      const storedSubIds = db.getSubagentSessionIds(session.sessionId)
      for (const storedId of storedSubIds) {
        if (!scannedSubIds.has(storedId)) {
          db.deleteSubagentSession(storedId)
        }
      }

      for (const sub of subagents) {
        // 增量比對：mtime 沒變就跳過
        const existingMtime = existingSubMtimes.get(sub.subagentId)
        if (existingMtime && existingMtime === sub.fileMtime) continue

        // 解析 subagent JSONL
        let parsed: ParsedSession
        try {
          parsed = await parseSession(sub.filePath, sub.subagentId)
        } catch {
          continue
        }

        // 在單一 transaction 中寫入 metadata + content，避免不一致
        db.runTransaction(() => {
          db.indexSubagentSession({
            id: sub.subagentId,
            parentSessionId: sub.parentSessionId,
            agentType: sub.agentType,
            filePath: sub.filePath,
            fileSize: sub.fileSize,
            fileMtime: sub.fileMtime,
            messageCount: parsed.messages.length,
            startedAt: parsed.startedAt,
            endedAt: parsed.endedAt,
          })

          db.indexSession({
            sessionId: sub.subagentId,
            projectId: project.projectId,
            projectDisplayName: project.displayName,
            title: parsed.title,
            messageCount: parsed.messages.length,
            filePath: sub.filePath,
            fileSize: sub.fileSize,
            fileMtime: sub.fileMtime,
            startedAt: parsed.startedAt,
            endedAt: parsed.endedAt,
            messages: parsed.messages.map((msg, idx) => ({
              type: msg.type,
              uuid: msg.uuid,
              role: msg.role,
              contentText: msg.contentText,
              contentJson: msg.contentJson,
              hasToolUse: msg.hasToolUse,
              hasToolResult: msg.hasToolResult,
              toolNames: msg.toolNames,
              timestamp: msg.timestamp,
              sequence: idx,
              rawJson: msg.rawJson,
              inputTokens: msg.inputTokens,
              outputTokens: msg.outputTokens,
              cacheReadTokens: msg.cacheReadTokens,
              cacheCreationTokens: msg.cacheCreationTokens,
              model: msg.model,
            })),
          })
        })
      }
    }
  }

  // 5. FINALIZE — 更新所有 project 統計（stale cleanup 可能影響任何 project）
  for (const project of projects) {
    db.updateProjectStats(project.projectId)
  }

  onProgress?.({ phase: 'done', progress: 100, total, current: total })
}
