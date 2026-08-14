import path from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import type { ExclusionRule, IndexerProgress, IndexerStatus, ParsedLine, ParsedSession, ScannedTask, ParsedTaskContent } from '../shared/types'
import type { Database, MessageInput } from './database'
import { scanProjects, scanSubagents, scanTasks, DEFAULT_BASE_DIR, DEFAULT_TASKS_BASE_DIR } from './scanner'
import { logSafe, logSafeError } from './logSafe'
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
  } catch (err) {
    // 讀不到檔案 → exclusion rule 的日期比對會保守地不匹配，session 因此被留下來。
    // 結果不算錯，但「為什麼這個 session 沒被排除」需要有跡可循。
    // ENOENT 例外：檔案在掃描後被刪是 race 不是故障，與 scanner 的判準保持一致。
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn(`[indexer] cannot read first timestamp: ${logSafe(filePath)} - ${logSafeError(err)}`)
    }
    return null
  }
  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    try {
      const obj = JSON.parse(line) as { timestamp?: unknown }
      if (typeof obj.timestamp === 'string') return obj.timestamp
    } catch {
      // 該行非合法 JSON → 跳過繼續找。
      // 這裡刻意不 log：寬容 parser 下壞行是預期輸入，且這是 per-line 迴圈，
      // 逐行 warn 會把真正的失敗訊號淹掉。整檔都沒有合法 timestamp 才是問題，
      // 那由下面的 return null 交給 caller 判斷。
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
 * 這個 session 有沒有被任何一條規則涵蓋。
 *
 * 空規則清單直接回 false 而不碰磁碟——絕大多數使用者一條規則都沒設，這個短路
 * 省掉的是「每個 session 一次 readFirstTimestamp」。短路必須留在這裡而不是各
 * call site，否則兩邊又要各自記得寫一次。
 */
async function isExcludedByRules(
  rules: ExclusionRule[],
  projectId: string,
  filePath: string,
): Promise<boolean> {
  if (rules.length === 0) return false
  const firstTs = await readFirstTimestamp(filePath)
  return matchesAnyRule(rules, projectId, firstTs)
}

/** 已經知道 timestamp 時的同步版本，省下重讀檔案。空清單一律不匹配。 */
function matchesAnyRule(
  rules: ExclusionRule[],
  projectId: string,
  firstTimestamp: string | null,
): boolean {
  return rules.some(r => matchesExclusionRule(projectId, firstTimestamp, r))
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
    frameUrl: msg.frameUrl,
    bridgeSessionId: msg.bridgeSessionId,
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
 * 目錄存在。stat 失敗一律回 false——呼叫端用它決定要不要封存，猜錯的代價不對等，
 * 所以拿不準時一律當作「不在」而少做。（存在但讀不到的情況由 scanner 的
 * onScanFailure 在上游先攔下，走不到這裡。）
 */
async function dirExists(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory()
  } catch {
    return false
  }
}

/**
 * 執行首次/增量索引。
 * 掃描 baseDir 下所有 JSONL，比對 file_mtime 決定哪些需要（重新）索引，
 * 解析後寫入 DB。
 */
export async function runIndexer(
  db: Database,
  onProgress?: ProgressCallback,
  // 預設值在這裡解析而不是交給 scanProjects：下面要 stat 的必須是「剛剛掃過的那個目錄」，
  // 這個不變式不該靠讀另一個檔案的參數預設值來確認。
  baseDir: string = DEFAULT_BASE_DIR,
  tasksBaseDir: string = DEFAULT_TASKS_BASE_DIR,
): Promise<void> {
  // 解析失敗而沒進 DB 的項目數。累計後隨 progress 一路帶到 UI——
  // 這條路徑上的每個 continue 都是在丟資料，不能只有我們自己（甚至我們也不）知道。
  let skipped = 0

  // 1. SCANNING
  onProgress?.({ phase: 'scanning', progress: 0, total: 0, current: 0, skipped })
  // 掃描失敗會讓 project／session 從結果中缺席，而缺席在 archive 判斷裡等同「被刪了」。
  // 這個旗標讓下游分得出兩者——沒有它，一次權限錯誤就會誤封存磁碟上還在的資料。
  let scanFailed = false
  const projects = await scanProjects(baseDir, () => {
    scanFailed = true
    skipped++
  })

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
  // 被規則擋下的 session。subagent 階段要分辨得出「使用者主動排除」與其他沒進
  // sessions 表的原因——前者連 subagent 都不該索引，後者的 subagent 是該救的。
  const excludedSessionIds = new Set<string>()

  for (const project of projects) {
    for (const session of project.sessions) {
      scannedSessionIds.add(session.sessionId)
      const existing = existingMtimes.get(session.sessionId)
      // 重新索引條件：新 session、mtime 變更、archived session 重新出現、或 summary engine 升版
      const summaryStale = existing && (existing.summaryVersion === null || existing.summaryVersion < SUMMARY_VERSION)
      if (!existing || existing.mtime !== session.fileMtime || existing.archived || summaryStale) {
        // summary_version 為 null 的也要重評：那是「還沒真正索引完成」的狀態（parse
        // 失敗，或 phase 4 為了接住 subagent 補寫的 metadata-only parent），語義上更
        // 接近新 session 而不是已索引。少了這一半，一個在 parent 暫時讀不到時補寫的
        // metadata parent 會因為下一輪「已 existing」而永久豁免 date rule——等權限恢復
        // 就整段索引回來，使用者設的排除範圍等於沒設。
        if ((!existing || existing.summaryVersion === null)
          && await isExcludedByRules(exclusionRules, project.projectId, session.filePath)) {
          excludedSessionIds.add(session.sessionId)
          continue
        }
        sessionsToIndex.push({
          ...session,
          projectId: project.projectId,
          projectDisplayName: project.displayName,
        })
      }
    }
  }

  // 掃到 0 筆卻有既存記錄時，得先分清楚 baseDir 是「空的」還是「不在」——兩者在
  // 掃描結果上長得一模一樣，處置卻相反。ENOENT 在 scanner 裡不算掃描失敗（首次啟動
  // 時 ~/.claude/projects 本來就還不存在），所以 scanFailed 分不出這一組，只能自己確認
  // root 還在不在。真的被清空就該封存——擋著不做的話，下一輪掃描結果一樣是空的，
  // 狀態永遠停在「全部活躍」，那些 row 再也沒有機會被更正。
  const emptyScanFromMissingRoot = scannedSessionIds.size === 0
    && existingMtimes.size > 0
    && !(await dirExists(baseDir))

  // 標記 DB 中存在但掃描不到的 session 為 archived。
  // 守衛與下方 subagent 那套同源（完整推理見下方 subagent 封存守衛前的註解）：掃描層
  // 把讀取失敗轉成空陣列或 continue，缺席在這裡等同「被刪了」。差別只在訊號來源——
  // 主 session 的 project 層與 session 層失敗都由 scanProjects 的 onScanFailure 回報，
  // 一個 scanFailed 就涵蓋，不需要第二個旗標。
  if (scanFailed) {
    console.warn(`[indexer] skipped session archiving: a scan failed (cannot tell deletions from unreadable dirs)`)
  } else if (emptyScanFromMissingRoot) {
    console.warn(`[indexer] skipped session archiving: ${existingMtimes.size} indexed but the projects dir is gone (treating as an unmounted path, not deletions)`)
  } else {
    const archivedSessions = db.archiveStaleSessionsExcept(scannedSessionIds)
    if (archivedSessions > 0) {
      console.warn(`[indexer] archived ${archivedSessions} session(s) no longer on disk`)
    }
  }

  // 3. INDEXING — 按 fileMtime 升冪排序，確保舊 session 先索引（UUID 去重依賴此順序）
  sessionsToIndex.sort((a, b) => a.fileMtime.localeCompare(b.fileMtime))
  const total = sessionsToIndex.length

  // 內容已完整存在於別的 session、因而整個被去重掉的 session 數。
  let replayOnlySessionCount = 0
  // 主檔讀不到、因此沒進 sessions 表的 session。subagent 階段補 parent row 時要靠它
  // 分辨「這次讀失敗」與「本來就沒有自己的訊息」，兩者該不該重試完全相反。
  const parseFailedSessions = new Set<string>()

  for (let i = 0; i < total; i++) {
    onProgress?.({
      phase: 'indexing',
      progress: Math.round((i / total) * 100),
      total,
      current: i,
      skipped,
    })

    const s = sessionsToIndex[i]

    // 解析 JSONL — 讀取失敗跳過，不中斷
    let parsed: ParsedSession
    try {
      parsed = await parseSession(s.filePath, s.sessionId)
    } catch (err) {
      skipped++
      parseFailedSessions.add(s.sessionId)
      console.warn(`[indexer] session ${logSafe(s.sessionId)} not indexed (parse failed): ${logSafe(s.filePath)} - ${logSafeError(err)}`)
      continue
    }

    // requestId token 去重：同一 API response 的多個 entries 只保留最後一個的 token
    const dedupedLines = deduplicateTokensByRequestId(parsed.messages)

    // 標記同檔案內 rewind 棄用分支（parentUuid 多重真人分岔、其中一支延伸深度遠短於最長分支）。
    // 必須在 UUID 去重「之前」跑：resumed session 會把先前 entries replay 進新檔案，
    // 若先去重會抽掉分支鏈中的中繼 entry，讓真正延續的分支被誤判成深度驟降的棄用分支。
    const markedLines = markAbandonedBranches(dedupedLines)

    // UUID 去重：過濾掉其他 session 已索引的 replay entries（排除自身，避免 re-index 時自己匹配自己）
    const uuids = markedLines.filter(m => m.uuid).map(m => m.uuid!)
    const existingUuids = uuids.length > 0 ? db.getExistingUuids(uuids, s.sessionId) : new Set<string>()
    const messages = markedLines.filter(m => !(m.uuid && existingUuids.has(m.uuid)))

    // 純 replay session（所有 messages 都被去重）→ 跳過，不寫入 DB。
    // 不計入 skipped：那個數字在 UI 上的文案是「解析失敗的 session…已跳過」，而這裡
    // 一個位元組都沒丟——內容就在去重時匹配到的那個 session 裡。resume 過的 session
    // 每輪都會走這條，計進去等於把常態當成災情。改為整輪結束後彙總一行 log。
    if (messages.length === 0 && parsed.messages.length > 0) {
      replayOnlySessionCount++
      continue
    }

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

    // 寫入前再問一次規則。phase 2 的判斷代表「開始跑的時候」的意圖，而這個迴圈對大庫
    // 是分鐘級的：storage:apply 沒有跟索引協調，使用者中途按下排除時 applyExclusion
    // 會同步刪完就回、UI 顯示成功，然後這裡把整個 session 寫回去。而且不會自癒——下一
    // 輪 mtime 沒變就不再進佇列，它從此逃過所有規則。已完整索引的 session 在 phase 2
    // 本來就不做這個檢查（那時的分工是交給 applyExclusion 硬刪），race 一旦發生就沒有
    // 第二道防線。用手上已解出的 startedAt，不重讀檔案；它也正是 buildExclusionWhere
    // 比對的那個欄位，比 phase 2 的 readFirstTimestamp 更貼近 SQL 端的判準。
    if (matchesAnyRule(db.getExclusionRules(), s.projectId, startedAt)) {
      excludedSessionIds.add(s.sessionId)
      console.warn(`[indexer] session ${logSafe(s.sessionId)} was excluded while this run was in progress; not writing it back`)
      continue
    }

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

  if (replayOnlySessionCount > 0) {
    console.warn(`[indexer] ${replayOnlySessionCount} session(s) were pure replays of already-indexed content — their messages were not re-written, nothing lost (not counted as skipped)`)
  }

  // 4. SUBAGENT SCANNING — 掃描每個掃得到的 session 底下的 subagents/
  const existingSubMtimes = db.getAllSubagentMtimes()
  const scannedSubagentIds = new Set<string>()
  let subagentScanFailed = false
  // 重讀而非沿用 phase 2 的 exclusionRules：大庫跑完 phase 3 是分鐘級的事，這中間
  // 使用者可能新增了規則、或按下 applyExclusion 把某個 parent 硬刪掉。下面補寫
  // metadata parent 時要用得到當下的規則，拿舊快照判斷等於看著過期的意圖做事。
  const freshExclusionRules = db.getExclusionRules()
  for (const project of projects) {
    for (const session of project.sessions) {
      // 使用者用 exclusion rule 主動排除掉的 session，連它的 subagent 都不該進 DB，
      // 否則 applyExclusion 硬刪的資料會從這條路徑部分復活。
      if (excludedSessionIds.has(session.sessionId)) continue

      // session 目錄：<project>/<sessionId>/
      const sessionDir = path.join(path.dirname(session.filePath), session.sessionId)
      let subagents
      try {
        // 掃描層把失敗吞成空陣列，下面那個 catch 等不到它們——skipped 要在這裡數，
        // 否則整輪跑完會回報 skipped: 0，看起來像完整索引（見 scanner.ts 註解）。
        subagents = await scanSubagents(sessionDir, session.sessionId, () => {
          subagentScanFailed = true
          skipped++
        })
      } catch (err) {
        subagentScanFailed = true
        skipped++
        console.warn(`[indexer] subagents of session ${logSafe(session.sessionId)} not scanned: ${logSafe(sessionDir)} - ${logSafeError(err)}`)
        continue
      }
      if (subagents.length === 0) continue

      // subagent_sessions.parent_session_id 有 FK 指向 sessions(id) 且 foreign_keys=ON：
      // parent 不在表裡就是 constraint 失敗直接拋出，中斷的是整輪索引而不只這一個
      // session。主迴圈有兩條路會留下這個狀態——純 replay 被去重成空、主檔 parse 失敗。
      // 兩種情況下 subagent 的 JSONL 都是獨立、沒被去重過的檔案，內容不會因為 parent
      // 的主檔重複或壞掉而失去價值：Claude Code 的 30 天清理過後，index.db 這份就是
      // 它唯一還存在的地方。所以補一列 metadata-only 的 parent 把它接住，而不是連
      // 帶丟掉。判準是「現在在不在表裡」而非「這輪有沒有被跳過」：DB 裡已有 parent
      // 的 replay session 每輪都會走那條 continue，當成缺席處理會讓它的 subagent 掉出
      // scannedSubagentIds，反被誤判成磁碟上消失而封存。直接問 DB 而不查 existingMtimes，
      // 因為那份快照取於 phase 2，大庫跑完 phase 3 是分鐘級的事，這中間 applyExclusion
      // 可能已經把 row 刪掉了——照快照判斷會略過補寫，然後撞上這段要防的 FK 中斷。
      if (!db.hasSession(session.sessionId)) {
        // hasSession 為 false 有兩種來源，處置相反：parent 從沒進過表（replay 被去重
        // 成空、主檔 parse 失敗）是該救的；parent 剛被 applyExclusion 硬刪掉則是使用者
        // 主動要它消失，補寫等於把刪掉的東西接回來。phase 2 的 excludedSessionIds 蓋不到
        // 後者——那時 session 還在表裡，走的是 existing 分支，從來沒進過那個集合。
        // 所以這裡就地重評一次規則，讓「使用者不要」贏過「補寫救資料」。
        if (await isExcludedByRules(freshExclusionRules, project.projectId, session.filePath)) {
          console.warn(`[indexer] session ${logSafe(session.sessionId)} matches an exclusion rule; not restoring it as a metadata-only parent (its ${subagents.length} subagent(s) stay out too)`)
          continue
        }
        db.indexSession({
          sessionId: session.sessionId,
          projectId: project.projectId,
          projectDisplayName: project.displayName,
          title: null,
          messageCount: 0,
          filePath: session.filePath,
          fileSize: session.fileSize,
          fileMtime: session.fileMtime,
          startedAt: null,
          endedAt: null,
          // 讀失敗的留 null 讓 summaryStale 下一輪把它重新排回佇列：權限閃斷、掛載點
          // 掉線都會自己恢復，標成當前版本等於凍結它，mtime 不變就再也不會重試。
          // 純 replay 反過來——它沒有自己的訊息可讀，每輪重試只是白跑一趟。
          summaryVersion: parseFailedSessions.has(session.sessionId) ? null : SUMMARY_VERSION,
          messages: [],
        })
        console.warn(`[indexer] session ${logSafe(session.sessionId)} has no messages of its own; stored as a metadata-only parent so its ${subagents.length} subagent(s) survive`)
      }

      for (const sub of subagents) {
        scannedSubagentIds.add(sub.subagentId)
        // 增量比對：mtime 沒變「且未封存」才跳過。archived 條件讓 archive 可逆——
        // 還原檔案時 mtime 可能一模一樣（rsync -a、Time Machine 都保留 mtime），
        // 少了它就會在這裡 continue 掉，archived 標記永遠解不開。
        const existing = existingSubMtimes.get(sub.subagentId)
        if (existing && existing.mtime === sub.fileMtime && !existing.archived) continue

        // 解析 subagent JSONL
        let parsed: ParsedSession
        try {
          parsed = await parseSession(sub.filePath, sub.subagentId)
        } catch (err) {
          skipped++
          console.warn(`[indexer] subagent ${logSafe(sub.subagentId)} not indexed (parse failed): ${logSafe(sub.filePath)} - ${logSafeError(err)}`)
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

  // 磁碟上已消失的 subagent 標記為 archived（不刪 —— 理由見 archiveStaleSubagents）。
  // 守衛：掃描層把讀取失敗轉成空陣列（scanner.ts 三處 return []），indexer 分不出
  // 「使用者刪光了」與「掃描失敗」。照樣 archive，一次權限錯誤就會把 subagent
  // 標成已封存——寧可少做也不要誤傷。兩種失敗形態都要擋：
  //   - 部分失敗：某個 session 的 subagents/ 讀不到，但別的 session 掃得到。
  //     計數非零，只看數量的守衛放它過關，失敗那個 session 的 subagent 就遭殃。
  //   - 上游失敗：project 層級就讀不到（scanner 三處 continue），那底下的 session
  //     根本不會進上面的迴圈，subagentScanFailed 也就永遠是 false——要靠 scanProjects
  //     自己回報。
  //   - 全面失敗：整個 baseDir 讀不到，掃描結果全空。
  // 前兩者靠 scanner 回報的訊號，最後一個只能從「掃到 0 筆但 DB 有記錄」反推。
  if (subagentScanFailed || scanFailed) {
    console.warn(`[indexer] skipped subagent archiving: a scan failed (cannot tell deletions from unreadable dirs)`)
  } else if (scannedSubagentIds.size > 0) {
    const archivedSubagents = db.archiveStaleSubagents(scannedSubagentIds)
    if (archivedSubagents > 0) {
      console.warn(`[indexer] archived ${archivedSubagents} subagent session(s) no longer on disk`)
    }
  } else if (existingSubMtimes.size > 0) {
    console.warn(`[indexer] skipped subagent archiving: scan found none but ${existingSubMtimes.size} indexed (treating as a failed scan, not deletions)`)
  }

  // 5. TASK SCANNING — 掃 ~/.claude/tasks/{sessionId}/*.json
  //    這層獨立於 session JSONL：task 可能單獨變動（TaskUpdate rewrite），
  //    session JSONL 未變也要重新 parse。每個 task 檔 per-file mtime 比對。
  //    只對 main session 跑（subagent 工具集沒有 TaskCreate/Update，不會寫 task）。
  skipped += await runTaskScanning(db, projects, tasksBaseDir)

  // 6. FINALIZE — 更新所有 project 統計（stale cleanup 可能影響任何 project）
  for (const project of projects) {
    db.updateProjectStats(project.projectId)
  }

  if (skipped > 0) {
    console.warn(`[indexer] run finished with ${skipped} item(s) skipped — see warnings above for which`)
  }
  onProgress?.({ phase: 'done', progress: 100, total, current: total, skipped })
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
  tasksBaseDir: string,
): Promise<number> {
  let skipped = 0
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
        scanned = await scanTasks(tasksBaseDir, session.sessionId)
      } catch (err) {
        skipped++
        console.warn(`[indexer] tasks of session ${logSafe(session.sessionId)} not scanned - ${logSafeError(err)}`)
        continue
      }
      if (scanned.length === 0) continue

      const toUpsert: Array<{ scanned: ScannedTask; content: ParsedTaskContent }> = []
      for (const task of scanned) {
        const key = `${task.sessionId}/${task.taskId}`
        const existingMtime = existingTaskMtimes.get(key)
        if (existingMtime && existingMtime === task.fileMtime) continue

        // 異常大的 task 檔（symlink 攻擊、誤寫等）→ 跳過避免 OOM
        if (task.fileSize > MAX_TASK_FILE_BYTES) {
          skipped++
          console.warn(`[indexer] task ${logSafe(key)} not indexed (${task.fileSize} bytes exceeds ${MAX_TASK_FILE_BYTES}): ${logSafe(task.filePath)}`)
          continue
        }

        const content = await parseTaskFile(task.filePath)
        if (!content) {
          skipped++
          console.warn(`[indexer] task ${logSafe(key)} not indexed (unparsable): ${logSafe(task.filePath)}`)
          continue
        }

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

  return skipped
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
