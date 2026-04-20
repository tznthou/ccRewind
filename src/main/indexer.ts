import path from 'node:path'
import { readFile } from 'node:fs/promises'
import type { ExclusionRule, IndexerStatus, ParsedLine, ParsedSession } from '../shared/types'
import type { Database, MessageInput } from './database'
import { scanProjects, scanSubagents } from './scanner'
import { parseSession } from './parser'
import { summarizeSession } from './summarizer'

export type ProgressCallback = (status: IndexerStatus) => void

/**
 * 掃整份 JSONL，回傳第一個帶 timestamp 的行。與 parser.parseSession 的 startedAt
 * 來源一致（整檔掃）——否則 applyExclusion 依完整掃描的 started_at 刪了 session，
 * re-index 時因 peek 截斷拿不到 timestamp 就會讓它被 re-import，破壞 skip 契約。
 */
export async function readFirstTimestamp(filePath: string): Promise<string | null> {
  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch {
    return null
  }
  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    try {
      const obj = JSON.parse(line) as { timestamp?: unknown }
      if (typeof obj.timestamp === 'string') return obj.timestamp
    } catch {
      // 該行非合法 JSON → 跳過繼續找
    }
  }
  return null
}

/**
 * 對應 database.buildExclusionWhere 的純 JS 版本，用於 indexer 階段 skip 判斷。
 * 日期比對採 UTC date（new Date → toISOString）以對齊 SQLite `DATE(started_at)`——
 * 後者對帶 offset 的 timestamp 會先 normalize 到 UTC 再截日期。invalid timestamp
 * 視為保守不匹配，避免誤 skip。沒 timestamp 時若 rule 有 date range → 不匹配。
 */
export function matchesExclusionRule(
  projectId: string,
  firstTimestamp: string | null,
  rule: ExclusionRule,
): boolean {
  if (rule.projectId != null && rule.projectId !== projectId) return false
  if (rule.dateFrom != null || rule.dateTo != null) {
    if (firstTimestamp == null) return false
    const d = new Date(firstTimestamp)
    if (Number.isNaN(d.getTime())) return false
    const date = d.toISOString().substring(0, 10)
    if (rule.dateFrom != null && date < rule.dateFrom) return false
    if (rule.dateTo != null && date > rule.dateTo) return false
  }
  return true
}

/**
 * 同一 requestId 的 assistant entries 只保留最後一個的 token 值，其他清零為 null。
 * 修正 Claude Code JSONL 將單次 API response 拆成多個 entries 造成的 token 重複計算。
 */
export function deduplicateTokensByRequestId(lines: ParsedLine[]): ParsedLine[] {
  // 收集同一 requestId 的最後一個 assistant entry index
  const lastIndex = new Map<string, number>()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.role === 'assistant' && line.requestId) {
      lastIndex.set(line.requestId, i)
    }
  }

  return lines.map((line, i) => {
    if (line.role === 'assistant' && line.requestId && lastIndex.get(line.requestId) !== i) {
      return { ...line, inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheCreationTokens: null }
    }
    return line
  })
}

/** ParsedLine[] → MessageInput[]（加上 sequence，去除 parser-only 欄位） */
function toMessageInputs(lines: ParsedLine[]): MessageInput[] {
  return lines.map((msg, idx) => ({
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
  }))
}

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

  // Exclusion rules（v1.9.0）：防止新 session 被重建（尤其 applyExclusion 硬刪後磁碟還在的場景）
  // 只攔截新 session（!existing），已 indexed 的保持 mtime 同步邏輯不變
  const exclusionRules = db.getExclusionRules()

  for (const project of projects) {
    for (const session of project.sessions) {
      scannedSessionIds.add(session.sessionId)
      const existing = existingMtimes.get(session.sessionId)
      // 重新索引條件：新 session、mtime 變更、或 archived session 重新出現
      if (!existing || existing.mtime !== session.fileMtime || existing.archived) {
        if (exclusionRules.length > 0 && !existing) {
          const firstTs = await readFirstTimestamp(session.filePath)
          const excluded = exclusionRules.some(r => matchesExclusionRule(project.projectId, firstTs, r))
          if (excluded) continue
        }
        sessionsToIndex.push({
          ...session,
          projectId: project.projectId,
          projectDisplayName: project.displayName,
        })
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

    // requestId token 去重：同一 API response 的多個 entries 只保留最後一個的 token
    const dedupedLines = deduplicateTokensByRequestId(parsed.messages)

    // UUID 去重：過濾掉其他 session 已索引的 replay entries（排除自身，避免 re-index 時自己匹配自己）
    const uuids = dedupedLines.filter(m => m.uuid).map(m => m.uuid!)
    const existingUuids = uuids.length > 0 ? db.getExistingUuids(uuids, s.sessionId) : new Set<string>()
    const messages = dedupedLines.filter(m => !(m.uuid && existingUuids.has(m.uuid)))

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
      messages: toMessageInputs(messages),
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
            messages: toMessageInputs(deduplicateTokensByRequestId(parsed.messages)),
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
