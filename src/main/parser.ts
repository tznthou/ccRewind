import { readFile } from 'node:fs/promises'
import type { ParsedLine, ParsedSession } from '../shared/types'

interface ContentResult {
  contentText: string | null
  hasToolUse: boolean
  hasToolResult: boolean
  toolNames: string[]
}

/** 解析 message.content 欄位，處理 string 和 array 兩種格式 */
export function parseContent(content: unknown): ContentResult {
  if (content == null) {
    return { contentText: null, hasToolUse: false, hasToolResult: false, toolNames: [] }
  }

  if (typeof content === 'string') {
    return { contentText: content, hasToolUse: false, hasToolResult: false, toolNames: [] }
  }

  if (!Array.isArray(content)) {
    return { contentText: null, hasToolUse: false, hasToolResult: false, toolNames: [] }
  }

  const textParts: string[] = []
  let hasToolUse = false
  let hasToolResult = false
  const toolNames: string[] = []

  for (const block of content) {
    if (block == null || typeof block !== 'object') continue
    const b = block as Record<string, unknown>

    switch (b.type) {
      case 'text':
        if (typeof b.text === 'string') textParts.push(b.text)
        break
      case 'tool_use':
        hasToolUse = true
        if (typeof b.name === 'string') toolNames.push(b.name)
        break
      case 'tool_result':
        hasToolResult = true
        break
      // thinking, server_tool_use 等 → 跳過
    }
  }

  return {
    contentText: textParts.length > 0 ? textParts.join('\n') : null,
    hasToolUse,
    hasToolResult,
    toolNames,
  }
}

/** 解析單行 JSONL，失敗回傳 null */
export function parseLine(line: string): ParsedLine | null {
  if (!line.trim()) return null

  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(line)
  } catch {
    return null
  }

  if (typeof obj !== 'object' || obj === null) return null

  const type = typeof obj.type === 'string' ? obj.type : 'unknown'
  const uuid = typeof obj.uuid === 'string' ? obj.uuid : null
  const parentUuid = typeof obj.parentUuid === 'string' ? obj.parentUuid : null
  const sessionId = typeof obj.sessionId === 'string' ? obj.sessionId : null
  const timestamp = typeof obj.timestamp === 'string' ? obj.timestamp : null

  let role: 'user' | 'assistant' | null = null
  let contentText: string | null = null
  let contentJson: string | null = null
  let hasToolUse = false
  let hasToolResult = false
  let toolNames: string[] = []

  const message = obj.message as Record<string, unknown> | undefined
  if (message && typeof message === 'object') {
    if (message.role === 'user' || message.role === 'assistant') {
      role = message.role
    }
    const result = parseContent(message.content)
    contentText = result.contentText
    hasToolUse = result.hasToolUse
    hasToolResult = result.hasToolResult
    toolNames = result.toolNames
    contentJson = message.content != null ? JSON.stringify(message.content) : null
  } else if (typeof obj.content === 'string') {
    // queue-operation 等 type 的 prompt 存在頂層 content 欄位
    contentText = obj.content as string
  }

  return {
    type,
    uuid,
    parentUuid,
    sessionId,
    timestamp,
    role,
    contentText,
    contentJson,
    hasToolUse,
    hasToolResult,
    toolNames,
    rawJson: line,
  }
}

const TITLE_MAX_LENGTH = 80

/** 解析整個 JSONL 檔案為結構化 session */
export async function parseSession(filePath: string, sessionId: string): Promise<ParsedSession> {
  const raw = await readFile(filePath, 'utf-8')
  const lines = raw.split('\n')

  const messages: ParsedLine[] = []
  let skippedLines = 0
  let totalLines = 0
  let title: string | null = null
  let startedAt: string | null = null
  let endedAt: string | null = null

  for (const line of lines) {
    if (!line.trim()) continue
    totalLines++

    const parsed = parseLine(line)
    if (!parsed) {
      skippedLines++
      continue
    }

    parsed.sessionId ??= sessionId
    messages.push(parsed)

    // 追蹤時間範圍
    if (parsed.timestamp) {
      if (!startedAt) startedAt = parsed.timestamp
      endedAt = parsed.timestamp
    }

    // Title 推導：queue-operation prompt 優先，其次第一筆 user 訊息
    if (!title && parsed.contentText) {
      const isQueuePrompt = parsed.type === 'queue-operation'
      const isFirstUser = parsed.role === 'user'
      if (isQueuePrompt || isFirstUser) {
        title = parsed.contentText.length > TITLE_MAX_LENGTH
          ? parsed.contentText.slice(0, TITLE_MAX_LENGTH) + '…'
          : parsed.contentText
      }
    }
  }

  return {
    sessionId,
    title: title ?? sessionId,
    messages,
    startedAt,
    endedAt,
    skippedLines,
    totalLines,
  }
}
