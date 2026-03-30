import type { ParsedLine, SessionSummary } from '../shared/types'

const MAX_SUMMARY_LEN = 200
const MAX_INTENT_LEN = 80
const MAX_FILES = 20

/** 從 tool_use block 提取檔案路徑的 tool 名稱 → input key 對應 */
const FILE_PATH_KEYS: Record<string, string> = {
  Read: 'file_path',
  Edit: 'file_path',
  Write: 'file_path',
  Glob: 'path',
  Grep: 'path',
}

/** 關鍵字 → 標籤 */
const TAG_RULES: Array<{ pattern: RegExp; tag: string }> = [
  { pattern: /\b(fix|bug|error|broken|crash)\b/, tag: 'bug-fix' },
  { pattern: /\b(refactor|rename|restructure|cleanup)\b/, tag: 'refactor' },
  { pattern: /\b(test|spec|vitest|jest)\b/, tag: 'testing' },
  { pattern: /\b(deploy|release|version|publish)\b/, tag: 'deployment' },
  { pattern: /\b(auth|login|token|password|oauth)\b/, tag: 'auth' },
  { pattern: /\b(style|css|theme|layout)\b/, tag: 'ui' },
  { pattern: /\b(doc|readme|jsdoc)\b/, tag: 'docs' },
  { pattern: /\b(config|env|setup|install)\b/, tag: 'config' },
]

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max - 1) + '…'
}

/** 為一組 ParsedLine 產生 heuristic 摘要 */
export function summarizeSession(messages: ParsedLine[]): SessionSummary {
  if (messages.length === 0) {
    return { summaryText: '', tags: '', filesTouched: '', toolsUsed: '' }
  }

  // ── summaryText ──
  const userMessages = messages.filter(m => m.role === 'user' && m.contentText)
  const intent = userMessages[0]?.contentText ?? ''
  const lastUser = userMessages[userMessages.length - 1]?.contentText ?? ''
  const conclusion = lastUser && lastUser !== intent ? lastUser : ''

  let summaryText = truncate(intent, MAX_INTENT_LEN)
  if (conclusion) {
    summaryText += ' → ' + truncate(conclusion, MAX_INTENT_LEN)
  }
  summaryText = truncate(summaryText, MAX_SUMMARY_LEN)

  // ── filesTouched ──
  const files = new Set<string>()
  for (const msg of messages) {
    if (!msg.hasToolUse || !msg.contentJson) continue
    try {
      const content = JSON.parse(msg.contentJson) as unknown[]
      for (const block of content) {
        if (
          typeof block === 'object' &&
          block !== null &&
          (block as Record<string, unknown>).type === 'tool_use'
        ) {
          const b = block as Record<string, unknown>
          const name = b.name as string
          const key = FILE_PATH_KEYS[name]
          if (!key) continue
          const input = b.input as Record<string, unknown> | undefined
          const filePath = input?.[key]
          if (typeof filePath === 'string' && filePath) {
            files.add(filePath)
          }
        }
      }
    } catch {
      // malformed contentJson — skip
    }
  }
  const filesTouched = [...files].slice(0, MAX_FILES).join(',')

  // ── toolsUsed ──
  const toolCounts = new Map<string, number>()
  for (const msg of messages) {
    for (const name of msg.toolNames) {
      toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1)
    }
  }
  const toolsUsed = [...toolCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name}:${count}`)
    .join(',')

  // ── tags ──
  const corpus = messages
    .map(m => m.contentText ?? '')
    .join(' ')
    .toLowerCase()
  const tags = TAG_RULES.filter(r => r.pattern.test(corpus))
    .map(r => r.tag)
    .join(',')

  return { summaryText, tags, filesTouched, toolsUsed }
}
