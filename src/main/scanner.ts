import { readdir, stat, readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { ScannedProject, ScannedSession, ScannedSubagent, ScannedTask } from '../shared/types'
import { logSafe, logSafeError } from './logSafe'

const DEFAULT_BASE_DIR = path.join(os.homedir(), '.claude', 'projects')

/** ~/.claude/tasks/ 是 Claude Code TaskCreate/TaskUpdate 寫入位置，與 projects/ 平行 */
export const DEFAULT_TASKS_BASE_DIR = path.join(os.homedir(), '.claude', 'tasks')

/** 將編碼後的資料夾名稱還原為可讀路徑（所有 - 替換為 /） */
export function decodeProjectPath(encoded: string): string {
  return encoded.replace(/-/g, '/')
}

/**
 * 掃描層的失敗記錄。ENOENT 靜音：多數 session 沒有 subagents/ 或 tasks/ 目錄，
 * 而 readdir 之後檔案被 Claude Code 刪掉也是日常，逐次 warn 只會蓋掉真正的訊號。
 *
 * 其餘錯誤（權限、I/O、掛載點消失）必須出聲：掃不到的東西不會進 DB，
 * 而掃描層是把錯誤轉成空陣列的地方 —— indexer 的 catch 永遠等不到它們，
 * skipped 計數也就數不到。這裡不出聲，那條路徑上的資料遺失就沒有任何人知道。
 *
 * @returns 是否為真正的失敗（非 ENOENT）。呼叫端據此區分「東西本來就不在」
 *          與「這次讀不到」——後者不能拿掃描結果當磁碟現況的定論。
 */
function warnUnlessMissing(action: string, target: string, err: unknown): boolean {
  if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return false
  console.warn(`[scanner] ${action}: ${logSafe(target)} - ${logSafeError(err)}`)
  return true
}

/**
 * sessionId 會被當成路徑片段拼進 ~/.claude/tasks/<sessionId>/，所以它必須擋得住
 * 路徑語意。sessionId 來自檔名（`file.replace(/\.jsonl$/, '')`）——一個叫
 * `...jsonl` 的檔案就會產生 `..`，讓 tasks 掃描跳到 ~/.claude/ 本身並讀取
 * 那裡的 *.json（settings.json 就在那裡）。這是唯讀工具，但「讀什麼」同樣有邊界。
 *
 * 只要求「不帶路徑語意」而不硬綁 UUID 格式：Claude Code 換命名規則時，
 * 過嚴的規則會讓整個索引安靜地掉光。
 */
export function isPathSafeSegment(id: string): boolean {
  if (!id || id === '.' || id === '..') return false
  if (id.includes('/') || id.includes('\\')) return false
  if (id.includes('\0')) return false
  return !path.isAbsolute(id)
}

/**
 * 掃描 ~/.claude/projects/，回傳所有專案及其 JSONL 檔案。
 *
 * @param onScanFailure 掃描過程遇到非 ENOENT 錯誤時呼叫。讀不到的 project 與 session
 *   會從結果中缺席，而缺席在下游長得跟「檔案被刪了」一模一樣——理由同 scanSubagents。
 */
export async function scanProjects(
  baseDir: string = DEFAULT_BASE_DIR,
  onScanFailure?: () => void,
): Promise<ScannedProject[]> {
  let entries: string[]
  try {
    entries = await readdir(baseDir)
  } catch (err) {
    // 目錄不存在或不可讀 → 回傳空陣列
    if (warnUnlessMissing('cannot read projects dir', baseDir, err)) onScanFailure?.()
    return []
  }

  const projects: ScannedProject[] = []

  for (const entry of entries) {
    // 專案目錄以 - 開頭（編碼路徑的首字元 / → -）
    if (!entry.startsWith('-')) continue

    const projectDir = path.join(baseDir, entry)

    // 確認是目錄
    let dirStat
    try {
      dirStat = await stat(projectDir)
    } catch (err) {
      if (warnUnlessMissing('cannot stat project dir', projectDir, err)) onScanFailure?.()
      continue
    }
    if (!dirStat.isDirectory()) continue

    // 列出根層級 *.jsonl（不遞迴進 subagents/）
    let files: string[]
    try {
      files = await readdir(projectDir)
    } catch (err) {
      if (warnUnlessMissing('cannot list project dir', projectDir, err)) onScanFailure?.()
      continue
    }

    const sessions: ScannedSession[] = []
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue

      const filePath = path.join(projectDir, file)
      let fileStat
      try {
        fileStat = await stat(filePath)
      } catch (err) {
        if (warnUnlessMissing('cannot stat session file', filePath, err)) onScanFailure?.()
        continue
      }
      if (!fileStat.isFile()) continue

      // 第二道：不讓帶路徑語意的 id 進入系統。下游把它當路徑片段用（tasks 掃描），
      // 也當 DB primary key 用，擋在 ingestion boundary 比逐個下游補防呆可靠。
      const sessionId = file.replace(/\.jsonl$/, '')
      if (!isPathSafeSegment(sessionId)) {
        console.warn(`[scanner] skipping session file with unsafe id: ${logSafe(filePath)}`)
        continue
      }

      sessions.push({
        filePath,
        fileSize: fileStat.size,
        fileMtime: fileStat.mtime.toISOString(),
        sessionId,
      })
    }

    projects.push({
      projectId: entry,
      displayName: decodeProjectPath(entry),
      sessions,
    })
  }

  return projects
}

/**
 * 掃描 session 目錄下的 subagents/*.jsonl，回傳 SubagentFile 清單。
 *
 * @param onScanFailure 掃描過程遇到非 ENOENT 錯誤時呼叫。回傳的空陣列（或缺項的
 *   陣列）本身分不出「這個 session 沒有 subagent」與「這次讀不到」，而呼叫端會拿
 *   掃描結果去封存掃不到的記錄——沒有這個訊號，一次權限錯誤就會誤傷磁碟上還在的資料。
 */
export async function scanSubagents(
  sessionDir: string,
  parentSessionId: string,
  onScanFailure?: () => void,
): Promise<ScannedSubagent[]> {
  const subagentsDir = path.join(sessionDir, 'subagents')

  let entries: string[]
  try {
    entries = await readdir(subagentsDir)
  } catch (err) {
    if (warnUnlessMissing('cannot list subagents dir', subagentsDir, err)) onScanFailure?.()
    return []
  }

  const results: ScannedSubagent[] = []

  for (const entry of entries) {
    if (!entry.endsWith('.jsonl')) continue

    const filePath = path.join(subagentsDir, entry)
    let fileStat
    try {
      fileStat = await stat(filePath)
    } catch (err) {
      // 檔案 stat 不到同樣讓它從結果中缺席，判斷標準與整個目錄讀不到時一致
      if (warnUnlessMissing('cannot stat subagent file', filePath, err)) onScanFailure?.()
      continue
    }
    if (!fileStat.isFile()) continue

    const bareId = entry.replace(/\.jsonl$/, '')
    const subagentId = `${parentSessionId}/${bareId}`

    // 嘗試讀取對應 meta.json
    let agentType: string | null = null
    const metaPath = path.join(subagentsDir, `${bareId}.meta.json`)
    try {
      const metaRaw = await readFile(metaPath, 'utf-8')
      const meta = JSON.parse(metaRaw)
      if (typeof meta.agentType === 'string') {
        agentType = meta.agentType
      }
    } catch (err) {
      // meta.json 不存在是常態（不是每個 subagent 都有）；JSON 壞掉才需要知道。
      // 這裡不算掃描失敗：讀不到只是少了 agentType，subagent 本身照樣進結果，
      // 不會被誤判成從磁碟消失。
      warnUnlessMissing('cannot read subagent meta', metaPath, err)
    }

    results.push({
      filePath,
      fileSize: fileStat.size,
      fileMtime: fileStat.mtime.toISOString(),
      subagentId,
      parentSessionId,
      agentType,
    })
  }

  return results
}

/**
 * 掃描 ~/.claude/tasks/{sessionId}/*.json，回傳 task 檔案清單。
 *
 * - 目錄不存在 / 不可讀 → 回 []
 * - 過濾條件：`.json` 結尾，排除 `.lock` 與其他非 json 檔
 * - 空殼目錄（只有 .lock 或全空）→ 回 []
 */
export async function scanTasks(
  tasksBaseDir: string,
  sessionId: string,
): Promise<ScannedTask[]> {
  // 這裡是 sessionId 變成路徑的地方，也就是必須自己把關的地方
  if (!isPathSafeSegment(sessionId)) {
    console.warn(`[scanner] refusing to scan tasks for unsafe session id: ${logSafe(sessionId)}`)
    return []
  }

  const sessionTasksDir = path.join(tasksBaseDir, sessionId)

  let entries: string[]
  try {
    entries = await readdir(sessionTasksDir)
  } catch (err) {
    warnUnlessMissing('cannot list tasks dir', sessionTasksDir, err)
    return []
  }

  const results: ScannedTask[] = []

  for (const entry of entries) {
    // 排除 .lock 與非 .json 檔案
    if (!entry.endsWith('.json')) continue

    const filePath = path.join(sessionTasksDir, entry)
    let fileStat
    try {
      fileStat = await stat(filePath)
    } catch (err) {
      warnUnlessMissing('cannot stat task file', filePath, err)
      continue
    }
    if (!fileStat.isFile()) continue

    const taskId = entry.replace(/\.json$/, '')
    if (!taskId) continue

    results.push({
      filePath,
      fileSize: fileStat.size,
      fileMtime: fileStat.mtime.toISOString(),
      sessionId,
      taskId,
    })
  }

  return results
}
