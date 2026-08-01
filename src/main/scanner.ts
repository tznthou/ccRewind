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
 */
function warnUnlessMissing(action: string, target: string, err: unknown): void {
  if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return
  console.warn(`[scanner] ${action}: ${logSafe(target)} - ${logSafeError(err)}`)
}

/** 掃描 ~/.claude/projects/，回傳所有專案及其 JSONL 檔案 */
export async function scanProjects(baseDir: string = DEFAULT_BASE_DIR): Promise<ScannedProject[]> {
  let entries: string[]
  try {
    entries = await readdir(baseDir)
  } catch (err) {
    // 目錄不存在或不可讀 → 回傳空陣列
    warnUnlessMissing('cannot read projects dir', baseDir, err)
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
      warnUnlessMissing('cannot stat project dir', projectDir, err)
      continue
    }
    if (!dirStat.isDirectory()) continue

    // 列出根層級 *.jsonl（不遞迴進 subagents/）
    let files: string[]
    try {
      files = await readdir(projectDir)
    } catch (err) {
      warnUnlessMissing('cannot list project dir', projectDir, err)
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
        warnUnlessMissing('cannot stat session file', filePath, err)
        continue
      }
      if (!fileStat.isFile()) continue

      sessions.push({
        filePath,
        fileSize: fileStat.size,
        fileMtime: fileStat.mtime.toISOString(),
        sessionId: file.replace(/\.jsonl$/, ''),
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

/** 掃描 session 目錄下的 subagents/*.jsonl，回傳 SubagentFile 清單 */
export async function scanSubagents(sessionDir: string, parentSessionId: string): Promise<ScannedSubagent[]> {
  const subagentsDir = path.join(sessionDir, 'subagents')

  let entries: string[]
  try {
    entries = await readdir(subagentsDir)
  } catch (err) {
    warnUnlessMissing('cannot list subagents dir', subagentsDir, err)
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
      warnUnlessMissing('cannot stat subagent file', filePath, err)
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
      // meta.json 不存在是常態（不是每個 subagent 都有）；JSON 壞掉才需要知道
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
