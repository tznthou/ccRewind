import { readFile } from 'node:fs/promises'
import type { ParsedTaskContent } from '../shared/types'

/**
 * 解析單一 task JSON 檔（~/.claude/tasks/{sessionId}/{N}.json）。
 *
 * 寬容策略：
 * - 檔案不存在 / 不可讀 / JSON 格式錯誤 → 回 null
 * - 缺少必要欄位（id / subject / status）→ 回 null
 * - blocks / blockedBy 不存在或非 array → 空陣列
 * - description / activeForm 不存在或非 string → null
 * - 未知 status enum → 保留原字串，由 UI 層 fallback 顯示
 */
export async function parseTaskFile(filePath: string): Promise<ParsedTaskContent | null> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf-8')
  } catch {
    return null
  }

  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const obj = data as Record<string, unknown>

  const id = typeof obj.id === 'string' ? obj.id : null
  const subject = typeof obj.subject === 'string' ? obj.subject : null
  const status = typeof obj.status === 'string' ? obj.status : null

  if (!id || !subject || !status) return null

  return {
    id,
    subject,
    description: typeof obj.description === 'string' ? obj.description : null,
    activeForm: typeof obj.activeForm === 'string' ? obj.activeForm : null,
    status,
    blocks: toStringArray(obj.blocks),
    blockedBy: toStringArray(obj.blockedBy),
  }
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string')
}
