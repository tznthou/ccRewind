import path from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import type { ExclusionRule, IndexerProgress, IndexerStatus, ParsedLine, ParsedSession, ScannedTask, ParsedTaskContent } from '../shared/types'
import type { Database, MessageInput } from './database'
import { scanProjects, scanSubagents, scanTasks, DEFAULT_TASKS_BASE_DIR } from './scanner'
import { parseSession } from './parser'
import { parseTaskFile } from './task-parser'
import { summarizeSession, SUMMARY_VERSION } from './summarizer'

export type ProgressCallback = (status: IndexerProgress) => void

/**
 * 掃整份 JSONL，回傳第一個帶 timestamp 的行。與 parser.parseSession 的 startedAt
 * 來源一致（整檔掃）——否則 applyExclusion 依完整掃描的 started_at 刪了 session，
 * re-index 時因 peek 截斷拿不到 timestamp 就會讓它被 re-import，破壞 skip 契約。
 * DoS guard：大於 maxBytes 的檔案直接回 null（null 對 date rule 保守不匹配，
 * 下游走 parseSession 路徑保持原有行為）。
 */
export const READ_FIRST_TIMESTAMP_MAX_BYTES = 64 * 1024 * 1024

export async function readFirstTimestamp(
  filePath: string,
  maxBytes: number = READ_FIRST_TIMESTAMP_MAX_BYTES,
): Promise<string | null> {
  let content: string
  try {
    const { size } = await stat(filePath)
    if (size > maxBytes) return null
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
  const nearestVersions = resolveNearestVersions(lines)
  return lines.map((msg, idx) => ({
    type: msg.type,
    uuid: msg.uuid,
    parentUuid: msg.parentUuid,
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
    toolErrorCount: msg.toolErrorCount,
    hasImage: msg.hasImage,
    attributionSkill: msg.attributionSkill,
    attributionPlugin: msg.attributionPlugin,
    attributionMcpServer: msg.attributionMcpServer,
    attributionMcpTool: msg.attributionMcpTool,
    attributionAgent: msg.attributionAgent,
    systemSubtype: msg.systemSubtype,
    apiErrorStatus: msg.apiErrorStatus,
    isCompactSummary: msg.isCompactSummary,
    isSidechain: msg.isSidechain,
    isAbandonedBranch: msg.isAbandonedBranch ?? false,
    version: nearestVersions[idx],
  }))
}

/**
 * 每行往前找最近一個非 null 的 version；檔案開頭找不到前值時，往後找第一個非 null 值回填。
 * 用途：message_archive 封存 unknown-type entry 時常缺 version 欄位（mode/last-prompt 等 type
 * 本身不帶版本字串），但同檔案鄰近的 assistant/user entry 有——用鄰近值回填才能回答
 * 「這個 shape 是哪個版本引入的」，逐行硬讀 obj.version 對這批目標資料會全部是 null。
 */
export function resolveNearestVersions(lines: ParsedLine[]): Array<string | null> {
  const result = new Array<string | null>(lines.length).fill(null)
  let lastSeen: string | null = null
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].version) lastSeen = lines[i].version
    result[i] = lastSeen
  }
  let nextSeen: string | null = null
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].version) nextSeen = lines[i].version
    if (result[i] == null) result[i] = nextSeen
  }
  return result
}

/** 是否為「真人輸入」的 user turn：排除 tool_result 回應、sidechain（subagent）、compact 摘要注入 */
function isRealHumanTurn(line: ParsedLine): boolean {
  return line.type === 'user' && line.role === 'user' &&
    !line.hasToolResult && !line.isSidechain && !line.isCompactSummary
}

/**
 * 計算每個 uuid 沿 parentUuid 鏈往下可推導到的最大陣列 index（含自身）。
 * JSONL 為 append-only：child 的 index 必大於 parent，故由後往前單趟掃描，
 * 處理到某 entry 時其所有 children 已計算完畢，不需遞迴。
 * 用於比較 rewind 分岔各分支「實際走了多遠」，而非只看 1-hop 有無子節點——
 * 真實棄用分支常帶 1 筆 bookkeeping entry（如 attachment）才真正斷鏈，只查 1-hop 會漏抓
 * （2026-07-07 對真實 markdown-tool session 實測驗證：棄用分支「繼續」1-hop 有子節點但
 * 整條鏈只多 1 筆即斷，勝出分支「git init...」則延續 77 筆）。
 */
function computeMaxReachableIndex(lines: ParsedLine[]): Map<string, number> {
  const childIndexesByParentUuid = new Map<string, number[]>()
  lines.forEach((line, idx) => {
    if (!line.parentUuid) return
    const arr = childIndexesByParentUuid.get(line.parentUuid)
    if (arr) arr.push(idx)
    else childIndexesByParentUuid.set(line.parentUuid, [idx])
  })

  const maxReachByUuid = new Map<string, number>()
  for (let idx = lines.length - 1; idx >= 0; idx--) {
    const line = lines[idx]
    if (!line.uuid) continue
    let best = idx
    const childIndexes = childIndexesByParentUuid.get(line.uuid)
    if (childIndexes) {
      for (const childIdx of childIndexes) {
        const childUuid = lines[childIdx].uuid
        best = Math.max(best, childUuid ? maxReachByUuid.get(childUuid) ?? childIdx : childIdx)
      }
    }
    maxReachByUuid.set(line.uuid, best)
  }
  return maxReachByUuid
}

/**
 * 分支深度低於同組最長分支這個比例，才視為棄用（而非單純較短的平行對話）。
 * 2026-07-07 子超裁決：真實案例 1/77（≈1.3%）與 5/563（≈0.9%）皆需標記，10% 兩者皆涵蓋。
 */
const ABANDONED_BRANCH_RATIO = 0.1

/**
 * 標記同檔案內 rewind 造成的棄用分支：同一個 parentUuid 下有 2 個以上「真人輸入」子節點，
 * 其中分支深度（可推導到的最遠 index 距離）明顯短於同組最長分支（< 10%）的視為棄用分支。
 * 只計入真人輸入子節點分組，排除 tool_use/tool_result 平行呼叫鏈結（同一 assistant turn
 * 產生的多筆 entry 共享 parentUuid 是正常結構，並非對話分岔）；深度推導則走全部 entry（見
 * computeMaxReachableIndex），因為分支延續的路徑本身含 assistant/attachment 等非真人節點。
 * 2026-07-07 B2 驗證：真實 409 個 session 檔案中 ~30 個檔案命中此模式。
 */
export function markAbandonedBranches(lines: ParsedLine[]): ParsedLine[] {
  const candidatesByParent = new Map<string, ParsedLine[]>()
  for (const line of lines) {
    if (!line.parentUuid || !isRealHumanTurn(line)) continue
    const siblings = candidatesByParent.get(line.parentUuid)
    if (siblings) siblings.push(line)
    else candidatesByParent.set(line.parentUuid, [line])
  }
  const forkGroups = [...candidatesByParent.values()].filter(siblings => siblings.length >= 2)
  if (forkGroups.length === 0) return lines

  const indexByUuid = new Map<string, number>()
  lines.forEach((line, idx) => { if (line.uuid) indexByUuid.set(line.uuid, idx) })
  const maxReachByUuid = computeMaxReachableIndex(lines)

  const abandonedUuids = new Set<string>()
  for (const siblings of forkGroups) {
    const depths: Array<{ uuid: string; depth: number }> = []
    for (const s of siblings) {
      const ownIdx = s.uuid ? indexByUuid.get(s.uuid) : undefined
      if (s.uuid && ownIdx != null) {
        depths.push({ uuid: s.uuid, depth: (maxReachByUuid.get(s.uuid) ?? ownIdx) - ownIdx })
      }
    }
    if (depths.length < 2) continue
    const maxDepth = Math.max(...depths.map(d => d.depth))
    if (maxDepth === 0) continue // 全員即時死端，沒有「相對更短」的分支可比
    for (const d of depths) {
      if (d.depth < maxDepth * ABANDONED_BRANCH_RATIO) abandonedUuids.add(d.uuid)
    }
  }

  if (abandonedUuids.size === 0) return lines
  return lines.map(line =>
    line.uuid && abandonedUuids.has(line.uuid) ? { ...line, isAbandonedBranch: true } : line,
  )
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
      // 重新索引條件：新 session、mtime 變更、archived session 重新出現、或 summary engine 升版
      const summaryStale = existing && (existing.summaryVersion === null || existing.summaryVersion < SUMMARY_VERSION)
      if (!existing || existing.mtime !== session.fileMtime || existing.archived || summaryStale) {
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
    const dedupedMessages = dedupedLines.filter(m => !(m.uuid && existingUuids.has(m.uuid)))
    // 標記同檔案內 rewind 棄用分支（parentUuid 多重真人分岔、其中一支無後續）
    const messages = markAbandonedBranches(dedupedMessages)

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

  // 5. TASK SCANNING — 掃 ~/.claude/tasks/{sessionId}/*.json
  //    這層獨立於 session JSONL：task 可能單獨變動（TaskUpdate rewrite），
  //    session JSONL 未變也要重新 parse。每個 task 檔 per-file mtime 比對。
  //    只對 main session 跑（subagent 工具集沒有 TaskCreate/Update，不會寫 task）。
  await runTaskScanning(db, projects)

  // 6. FINALIZE — 更新所有 project 統計（stale cleanup 可能影響任何 project）
  for (const project of projects) {
    db.updateProjectStats(project.projectId)
  }

  onProgress?.({ phase: 'done', progress: 100, total, current: total })
}

/**
 * Task scanning phase：對所有 main session 掃描對應的 ~/.claude/tasks/{sessionId}/，
 * 用 per-file mtime 增量比對，變動者重新 parse 並 upsert 進 session_tasks。
 *
 * 不掛 FK 到 sessions：tasks 是 ~/.claude/projects 的 sibling source，獨立生命週期
 * 由本 phase 統一管理。stale cleanup（DB 有但磁碟沒了）在 v1 不處理。
 */
/** task JSON 檔大小上限（1MB）。超過視為異常（symlink 至 /dev/zero、誤寫等），跳過避免 OOM。 */
const MAX_TASK_FILE_BYTES = 1 * 1024 * 1024

async function runTaskScanning(
  db: Database,
  projects: Awaited<ReturnType<typeof scanProjects>>,
): Promise<void> {
  const existingTaskMtimes = db.getAllTaskMtimes()

  for (const project of projects) {
    for (const session of project.sessions) {
      // 排除 subagent session（雖然 scanProjects 只回 main session，這層 filter
      // 是 plan-locked 防呆，未來若 subagent 進入 sessions 集合也不會誤掃）
      if (session.sessionId.includes('/')) continue

      // 排除 DB 中已不存在的 session（被 exclusion rules 刪除）。不掛 FK 的代價：
      // 必須在 ingestion 端自行保證 task 只屬於 known sessions。
      if (!db.hasSession(session.sessionId)) continue

      let scanned: ScannedTask[]
      try {
        scanned = await scanTasks(DEFAULT_TASKS_BASE_DIR, session.sessionId)
      } catch {
        continue
      }
      if (scanned.length === 0) continue

      const toUpsert: Array<{ scanned: ScannedTask; content: ParsedTaskContent }> = []
      for (const task of scanned) {
        const key = `${task.sessionId}/${task.taskId}`
        const existingMtime = existingTaskMtimes.get(key)
        if (existingMtime && existingMtime === task.fileMtime) continue

        // 異常大的 task 檔（symlink 攻擊、誤寫等）→ 跳過避免 OOM
        if (task.fileSize > MAX_TASK_FILE_BYTES) continue

        const content = await parseTaskFile(task.filePath)
        if (!content) continue

        toUpsert.push({ scanned: task, content })
      }

      if (toUpsert.length === 0) continue

      db.runTransaction(() => {
        for (const { scanned, content } of toUpsert) {
          db.indexSessionTask({
            sessionId: scanned.sessionId,
            taskId: scanned.taskId,
            subject: content.subject,
            description: content.description,
            activeForm: content.activeForm,
            status: content.status,
            blocks: content.blocks,
            blockedBy: content.blockedBy,
            filePath: scanned.filePath,
            fileSize: scanned.fileSize,
            fileMtime: scanned.fileMtime,
          })
        }
      })
    }
  }
}

// ── Indexer runner（in-flight 合併 + lastIndexedAt 追蹤） ──
// focus auto-trigger 與手動 sync now 共用此入口；in-flight 期間並發呼叫
// 直接拿到同一個 Promise，runIndexer 不會重複跑。

let inFlight: Promise<void> | null = null
let lastIndexedAt: string | null = null

/** 取得最近一次成功索引的 ISO timestamp（done 時才有值，啟動到首次完成前為 null）*/
export function getLastIndexedAt(): string | null {
  return lastIndexedAt
}

/**
 * 觸發索引（in-flight 合併）。已在跑就 return 同一 Promise。
 * 完成時把 IndexerProgress 補成 IndexerStatus（done 時帶 lastIndexedAt）後給 caller。
 */
export async function triggerIndexer(
  db: Database,
  onStatus?: (status: IndexerStatus) => void,
  baseDir?: string,
): Promise<void> {
  if (inFlight) return inFlight
  inFlight = (async () => {
    try {
      await runIndexer(db, (progress) => {
        if (progress.phase === 'done') {
          lastIndexedAt = new Date().toISOString()
        }
        onStatus?.({
          ...progress,
          lastIndexedAt: progress.phase === 'done' ? lastIndexedAt : null,
        })
      }, baseDir)
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}
