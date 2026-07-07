import { readFile } from 'node:fs/promises'
import type { ParsedLine, ParsedSession } from '../shared/types'

interface ContentResult {
  contentText: string | null
  hasToolUse: boolean
  hasToolResult: boolean
  hasImage: boolean
  toolNames: string[]
  isCommandWrapped: boolean
  toolErrorCount: number
}

/** 完全移除的系統標籤（標籤+內容一起刪）*/
const STRIP_TAGS = ['local-command-caveat', 'task-notification', 'ide_opened_file', 'system-reminder']
/** 只移除標籤殼、保留內文的系統標籤 */
const UNWRAP_TAGS = ['command-name', 'command-message', 'command-args', 'local-command-stdout']

const STRIP_RE = new RegExp(
  STRIP_TAGS.map(t => `<${t}>[\\s\\S]*?</${t}>`).join('|'), 'g',
)
const UNWRAP_RE = new RegExp(
  `<(${UNWRAP_TAGS.join('|')})>([\\s\\S]*?)</\\1>`, 'g',
)
const COMMAND_TAG_PROBE_RE = new RegExp(`<(${UNWRAP_TAGS.join('|')})>`)

/** 原始 content 是否含 slash command 包裹標籤（含 local-command-stdout 等命令輸出）*/
export function hasCommandWrapper(raw: string): boolean {
  return COMMAND_TAG_PROBE_RE.test(raw)
}

/**
 * parser 認識的 JSONL type 白名單。
 * 不在此集合 → parseFailed=true，保留 raw_json 作為未來除錯 / re-parse 證據。
 * 新增 type 時同步更新此列表。
 */
const KNOWN_MESSAGE_TYPES = new Set([
  'user', 'assistant', 'system',
  'queue-operation', 'last-prompt',
  'progress', 'attachment', 'file-history-snapshot', 'permission-mode',
  'custom-title', 'ai-title', 'agent-name', 'pr-link',
])

/** 移除系統注入的 XML 標籤，保留使用者原始文字。白名單制，不認識的標籤不動 */
export function stripSystemXml(text: string): string {
  return text.replace(STRIP_RE, '').replace(UNWRAP_RE, (_, _tag: string, content: string) => content).trim()
}

/**
 * 把 lone surrogate 替換成 U+FFFD。
 * Claude Code 2.1.132 以前的 tool error truncation 會切到 emoji 中間，
 * 在 JSONL 留下未配對 UTF-16 surrogate；磁碟上的舊 session 仍含此資料。
 * 在 parser 出口 normalize 一次，下游 summarizer / FTS / UI / 匯出皆不必再處理。
 */
export function ensureWellFormed(s: string): string {
  return s.toWellFormed()
}

/** 解析 message.content 欄位，處理 string 和 array 兩種格式 */
export function parseContent(content: unknown): ContentResult {
  if (content == null) {
    return { contentText: null, hasToolUse: false, hasToolResult: false, hasImage: false, toolNames: [], isCommandWrapped: false, toolErrorCount: 0 }
  }

  if (typeof content === 'string') {
    const isCommandWrapped = hasCommandWrapper(content)
    const cleaned = ensureWellFormed(stripSystemXml(content))
    return { contentText: cleaned || null, hasToolUse: false, hasToolResult: false, hasImage: false, toolNames: [], isCommandWrapped, toolErrorCount: 0 }
  }

  if (!Array.isArray(content)) {
    return { contentText: null, hasToolUse: false, hasToolResult: false, hasImage: false, toolNames: [], isCommandWrapped: false, toolErrorCount: 0 }
  }

  const textParts: string[] = []
  let hasToolUse = false
  let hasToolResult = false
  let hasImage = false
  const toolNames: string[] = []
  let isCommandWrapped = false
  let toolErrorCount = 0

  for (const block of content) {
    if (block == null || typeof block !== 'object') continue
    const b = block as Record<string, unknown>

    switch (b.type) {
      case 'text':
        if (typeof b.text === 'string') {
          if (!isCommandWrapped && hasCommandWrapper(b.text)) isCommandWrapped = true
          const cleaned = ensureWellFormed(stripSystemXml(b.text))
          if (cleaned) textParts.push(cleaned)
        }
        break
      case 'tool_use':
        hasToolUse = true
        if (typeof b.name === 'string') toolNames.push(b.name)
        break
      case 'tool_result':
        hasToolResult = true
        if (b.is_error === true) toolErrorCount++
        break
      case 'image':
        hasImage = true
        break
    }
  }

  return {
    contentText: textParts.length > 0 ? textParts.join('\n') : null,
    hasToolUse,
    hasToolResult,
    hasImage,
    toolNames,
    isCommandWrapped,
    toolErrorCount,
  }
}

/** 安全轉換為整數，非數字回傳 null */
function toInt(v: unknown): number | null {
  return typeof v === 'number' ? Math.floor(v) : null
}

/** 從 message.usage 抽取 token 資料 */
function parseUsage(message: Record<string, unknown>): {
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
} {
  const usage = message.usage as Record<string, unknown> | undefined
  if (!usage || typeof usage !== 'object') {
    return { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheCreationTokens: null }
  }
  const base = toInt(usage.input_tokens) ?? 0
  const cacheRead = toInt(usage.cache_read_input_tokens) ?? 0
  const cacheCreation = toInt(usage.cache_creation_input_tokens) ?? 0
  return {
    inputTokens: base + cacheRead + cacheCreation,
    outputTokens: toInt(usage.output_tokens) ?? 0,
    cacheReadTokens: cacheRead,
    cacheCreationTokens: cacheCreation,
  }
}

/** Strip base64 data from image content blocks before storage, preserving block structure for UI placeholder */
function stripImageBase64(content: unknown): unknown {
  if (!Array.isArray(content)) return content
  return content.map(block => {
    if (block == null || typeof block !== 'object') return block
    const b = block as Record<string, unknown>
    if (b.type !== 'image') return block
    const source = b.source as Record<string, unknown> | undefined
    if (!source || typeof source !== 'object' || source.type !== 'base64') return block
    return { ...b, source: { ...source, data: '[base64-stripped]' } }
  })
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
  const parseFailed = !KNOWN_MESSAGE_TYPES.has(type)
  const rawUuid = typeof obj.uuid === 'string' ? obj.uuid.trim() : null
  const uuid = rawUuid && rawUuid.length <= 128 ? rawUuid : null
  const parentUuid = typeof obj.parentUuid === 'string' ? obj.parentUuid : null
  const sessionId = typeof obj.sessionId === 'string' ? obj.sessionId : null
  const timestamp = typeof obj.timestamp === 'string' ? obj.timestamp : null
  const rawRequestId = typeof obj.requestId === 'string' ? obj.requestId : null
  const requestId = rawRequestId && rawRequestId.length <= 128 ? rawRequestId : null
  const rawVersion = typeof obj.version === 'string' ? obj.version : null
  const version = rawVersion && rawVersion.length <= 32 ? rawVersion : null
  const isCompactSummary = obj.isCompactSummary === true
  const isSidechain = obj.isSidechain === true

  let role: 'user' | 'assistant' | null = null
  let contentText: string | null = null
  let contentJson: string | null = null
  let hasToolUse = false
  let hasToolResult = false
  let hasImage = false
  let toolNames: string[] = []
  let inputTokens: number | null = null
  let outputTokens: number | null = null
  let cacheReadTokens: number | null = null
  let cacheCreationTokens: number | null = null
  let model: string | null = null
  let isCommandWrapped = false
  let toolErrorCount = 0

  const message = obj.message as Record<string, unknown> | undefined
  if (message && typeof message === 'object') {
    if (message.role === 'user' || message.role === 'assistant') {
      role = message.role
    }
    const result = parseContent(message.content)
    contentText = result.contentText
    hasToolUse = result.hasToolUse
    hasToolResult = result.hasToolResult
    hasImage = result.hasImage
    toolNames = result.toolNames
    isCommandWrapped = result.isCommandWrapped
    toolErrorCount = result.toolErrorCount
    const strippedContent = hasImage ? stripImageBase64(message.content) : message.content
    contentJson = strippedContent != null
      ? JSON.stringify(strippedContent, (_k, v) => typeof v === 'string' ? ensureWellFormed(v) : v)
      : null

    // Token usage（僅 assistant 訊息有值）
    const tokenData = parseUsage(message)
    inputTokens = tokenData.inputTokens
    outputTokens = tokenData.outputTokens
    cacheReadTokens = tokenData.cacheReadTokens
    cacheCreationTokens = tokenData.cacheCreationTokens
    model = typeof message.model === 'string' ? message.model : null
  } else if (typeof obj.content === 'string') {
    // queue-operation 等 type 的 prompt 存在頂層 content 欄位
    const rawContent = obj.content as string
    if (hasCommandWrapper(rawContent)) isCommandWrapped = true
    const cleaned = ensureWellFormed(stripSystemXml(rawContent))
    contentText = cleaned || null
  }

  // Attribution（頂層欄位，非 message 內；length cap 對齊 uuid/requestId guard）
  const attributionSkill = typeof obj.attributionSkill === 'string' && obj.attributionSkill.length <= 512 ? obj.attributionSkill : null
  const attributionPlugin = typeof obj.attributionPlugin === 'string' && obj.attributionPlugin.length <= 512 ? obj.attributionPlugin : null
  const attributionMcpServer = typeof obj.attributionMcpServer === 'string' && obj.attributionMcpServer.length <= 512 ? obj.attributionMcpServer : null
  const attributionMcpTool = typeof obj.attributionMcpTool === 'string' && obj.attributionMcpTool.length <= 512 ? obj.attributionMcpTool : null
  const attributionAgent = typeof obj.attributionAgent === 'string' && obj.attributionAgent.length <= 512 ? obj.attributionAgent : null

  // System subtype + API error
  let systemSubtype: string | null = null
  let apiErrorStatus: number | null = null
  if (type === 'system') {
    const rawSubtype = typeof obj.subtype === 'string' ? obj.subtype : null
    systemSubtype = rawSubtype && rawSubtype.length <= 128 ? rawSubtype : null
    if (systemSubtype === 'api_error') {
      const err = obj.error as Record<string, unknown> | undefined
      if (err && typeof err === 'object') {
        apiErrorStatus = typeof err.status === 'number' ? err.status : null
      }
    }
  }

  // Attachment: edited_text_file
  let editedFilePath: string | null = null
  if (type === 'attachment') {
    const att = obj.attachment as Record<string, unknown> | undefined
    if (att && typeof att === 'object' && att.type === 'edited_text_file') {
      const rawPath = typeof att.filename === 'string' ? att.filename : null
      editedFilePath = rawPath && rawPath.length <= 4096 ? rawPath : null
    }
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
    rawJson: parseFailed ? line : null,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    model,
    requestId,
    isCommandWrapped,
    toolErrorCount,
    hasImage,
    attributionSkill,
    attributionPlugin,
    attributionMcpServer,
    attributionMcpTool,
    attributionAgent,
    systemSubtype,
    apiErrorStatus,
    editedFilePath,
    version,
    isCompactSummary,
    isSidechain,
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
