import { dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import type { Database } from './database'
import type { Message } from '../shared/types'

/** sessionToMarkdown 的輸入資料 */
export interface ExportSessionData {
  title: string | null
  projectName: string
  startedAt: string | null
  endedAt: string | null
  messages: Message[]
}

// ── Tool block extraction（與 MessageBubble 同邏輯，main process 獨立實作）──

interface ToolUseBlock {
  type: 'tool_use'
  name: string
  input: unknown
}

interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: unknown
}

type ContentBlock = ToolUseBlock | ToolResultBlock

function extractToolBlocks(contentJson: string | null): ContentBlock[] {
  if (!contentJson) return []
  try {
    const parsed = JSON.parse(contentJson)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (block: unknown): block is ContentBlock => {
        if (block == null || typeof block !== 'object') return false
        const b = block as Record<string, unknown>
        if (b.type === 'tool_use') return typeof b.name === 'string'
        if (b.type === 'tool_result') return typeof b.tool_use_id === 'string'
        return false
      },
    )
  } catch {
    return []
  }
}

function formatToolContent(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

/** 產生足夠長的 backtick fence 來安全包裹 content（避免內容含 ``` 時破壞 Markdown） */
function makeFence(content: string, lang?: string): string {
  let ticks = 3
  const re = /`{3,}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    ticks = Math.max(ticks, m[0].length + 1)
  }
  const fence = '`'.repeat(ticks)
  return `${fence}${lang ?? ''}\n${content}\n${fence}`
}

// ── Markdown generation ──

/** 純函式：將 session 資料轉為 Markdown 字串 */
export function sessionToMarkdown(data: ExportSessionData): string {
  const title = data.title || 'Untitled Session'
  const visibleMessages = data.messages.filter((m) => {
    if (m.type === 'last-prompt' || m.type === 'queue-operation') return false
    const toolBlocks = extractToolBlocks(m.contentJson)
    return m.contentText || toolBlocks.length > 0
  })

  const lines: string[] = []

  // Header
  lines.push(`# ${title}`)
  lines.push('')
  lines.push('| Field | Value |')
  lines.push('|-------|-------|')
  lines.push(`| Project | ${data.projectName} |`)
  lines.push(`| Started | ${data.startedAt ?? '—'} |`)
  lines.push(`| Ended | ${data.endedAt ?? '—'} |`)
  lines.push(`| Messages | ${visibleMessages.length} |`)
  lines.push('')
  lines.push('---')
  lines.push('')

  // Messages
  for (const msg of visibleMessages) {
    const role = msg.role === 'user' ? 'User' : 'Assistant'
    lines.push(`## ${role}`)
    lines.push('')

    if (msg.contentText) {
      lines.push(msg.contentText)
      lines.push('')
    }

    const toolBlocks = extractToolBlocks(msg.contentJson)
    for (const block of toolBlocks) {
      if (block.type === 'tool_use') {
        const content = formatToolContent(block.input)
        lines.push('<details>')
        lines.push(`<summary>Tool: ${block.name}</summary>`)
        lines.push('')
        lines.push(makeFence(content, 'json'))
        lines.push('')
        lines.push('</details>')
        lines.push('')
      } else {
        const content = formatToolContent(block.content)
        lines.push('<details>')
        lines.push(`<summary>Result: ${block.tool_use_id}</summary>`)
        lines.push('')
        lines.push(makeFence(content))
        lines.push('')
        lines.push('</details>')
        lines.push('')
      }
    }
  }

  return lines.join('\n')
}

// ── File save orchestration ──

/** 清理檔名中不合法的字元 */
function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').replace(/_+/g, '_').trim()
}

/** 匯出 session 為 Markdown 檔案（含系統儲存對話框） */
export async function exportSessionAsMarkdown(
  db: Database,
  sessionId: string,
): Promise<'saved' | 'cancelled'> {
  const meta = db.getSessionForExport(sessionId)
  if (!meta) throw new Error('Session not found')

  const messages = db.getMessages(sessionId)
  const markdown = sessionToMarkdown({ ...meta, messages })

  const defaultName = sanitizeFilename(
    meta.title || sessionId.slice(0, 8),
  ) + '.md'

  const result = await dialog.showSaveDialog({
    title: 'Export Session as Markdown',
    defaultPath: defaultName,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  })

  if (result.canceled || !result.filePath) return 'cancelled'

  await writeFile(result.filePath, markdown, 'utf-8')
  return 'saved'
}
