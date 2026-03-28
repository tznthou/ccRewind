import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { ScannedProject, ScannedSession } from '../shared/types'

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
