import { readdir, stat, readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { ScannedProject, ScannedSession, ScannedSubagent } from '../shared/types'

const DEFAULT_BASE_DIR = path.join(os.homedir(), '.claude', 'projects')

/** 將編碼後的資料夾名稱還原為可讀路徑（所有 - 替換為 /） */
export function decodeProjectPath(encoded: string): string {
  return encoded.replace(/-/g, '/')
}

/** 掃描 ~/.claude/projects/，回傳所有專案及其 JSONL 檔案 */
export async function scanProjects(baseDir: string = DEFAULT_BASE_DIR): Promise<ScannedProject[]> {
  let entries: string[]
  try {
    entries = await readdir(baseDir)
  } catch {
    // 目錄不存在或不可讀 → 回傳空陣列
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
    } catch {
      continue
    }
    if (!dirStat.isDirectory()) continue

    // 列出根層級 *.jsonl（不遞迴進 subagents/）
    let files: string[]
    try {
      files = await readdir(projectDir)
    } catch {
      continue
    }

    const sessions: ScannedSession[] = []
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue

      const filePath = path.join(projectDir, file)
      let fileStat
      try {
        fileStat = await stat(filePath)
      } catch {
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
  } catch {
    return []
  }

  const results: ScannedSubagent[] = []

  for (const entry of entries) {
    if (!entry.endsWith('.jsonl')) continue

    const filePath = path.join(subagentsDir, entry)
    let fileStat
    try {
      fileStat = await stat(filePath)
    } catch {
      continue
    }
    if (!fileStat.isFile()) continue

    const subagentId = entry.replace(/\.jsonl$/, '')

    // 嘗試讀取對應 meta.json
    let agentType: string | null = null
    const metaPath = path.join(subagentsDir, `${subagentId}.meta.json`)
    try {
      const metaRaw = await readFile(metaPath, 'utf-8')
      const meta = JSON.parse(metaRaw)
      if (typeof meta.agentType === 'string') {
        agentType = meta.agentType
      }
    } catch {
      // meta.json 不存在或 JSON 格式錯誤 → agentType 為 null
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
