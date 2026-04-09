import type { ParsedLine, SessionSummary, OutcomeSignals, OutcomeStatus, FileOperation } from '../shared/types'
import type { SessionFileInput } from './database'

/** 摘要引擎版本（每次規則改動時遞增，讓 backfill 可追蹤） */
export const SUMMARY_VERSION = 1

const MAX_INTENT_LEN = 120
const MAX_SUMMARY_LEN = 300
const MAX_ACTIVITY_LEN = 80
const MAX_FILES = 30

// ── Noise Filter ──

/** 排除的路徑模式（反向索引噪音過濾） */
const NOISE_PATH_PATTERNS = [
  /node_modules\//,
  /\.git\//,
  /\/dist\//,
  /\/build\//,
  /\/\.next\//,
  /\/\.cache\//,
  /\/\.vite\//,
  /\/coverage\//,
]

function isNoisePath(filePath: string): boolean {
  return NOISE_PATH_PATTERNS.some(p => p.test(filePath))
}

// ── Greeting / Continuation Filter ──

const SKIP_PATTERNS = [
  /^(hey|hi|hello|yo|sup)\b/i,
  /^(thanks|thank you|thx)\b/i,
  /^(ok|okay|sure|yes|no|yep|nope|got it|sounds good)\b/i,
  /^(continue|go ahead|proceed|keep going|carry on|let's go|go)\b/i,
  /^(繼續|好的|沒問題|開始|來吧)\b/,
]

/** 是否為空洞開頭（greeting / continuation / 太短） */
function isHollowMessage(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 5) return true
  return SKIP_PATTERNS.some(p => p.test(trimmed))
}

// ── Intent Extraction ──

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max - 1) + '…'
}

/** 從 user messages 提取意圖文字：跳過 greeting，找第一句實質內容 */
function extractIntent(userMessages: ParsedLine[]): string {
  for (const msg of userMessages) {
    const text = msg.contentText?.trim()
    if (!text) continue
    if (isHollowMessage(text)) continue
    // 取第一行或前 N 字作為意圖
    const firstLine = text.split('\n')[0].trim()
    return truncate(firstLine, MAX_INTENT_LEN)
  }
  // fallback: 如果所有 user message 都是空洞的，取第一筆有內容的
  for (const msg of userMessages) {
    const text = msg.contentText?.trim()
    if (text && text.length > 0) {
      return truncate(text.split('\n')[0].trim(), MAX_INTENT_LEN)
    }
  }
  return ''
}

// ── Activity Summary ──

/** 從 tool 使用統計和檔案數量生成動作概要 */
function buildActivityText(toolCounts: Map<string, number>, fileCount: number): string {
  if (toolCounts.size === 0 && fileCount === 0) return ''

  const parts: string[] = []

  // 主要 mutation tools 優先顯示
  const mutationTools = ['Edit', 'Write', 'Bash']
  for (const tool of mutationTools) {
    const count = toolCounts.get(tool)
    if (count && count > 0) {
      parts.push(`${tool}×${count}`)
    }
  }

  // 如果沒有 mutation tools，顯示 discovery tools
  if (parts.length === 0) {
    const discoveryTools = ['Read', 'Grep', 'Glob']
    for (const tool of discoveryTools) {
      const count = toolCounts.get(tool)
      if (count && count > 0) {
        parts.push(`${tool}×${count}`)
      }
    }
  }

  if (fileCount > 0) {
    parts.push(`${fileCount} files`)
  }

  return truncate(parts.join(', '), MAX_ACTIVITY_LEN)
}

// ── Outcome Inference ──

const GIT_COMMIT_RE = /\bgit\s+commit\b/
const TEST_COMMAND_RE = /\b(npm\s+test|npx\s+vitest|pnpm\s+(test|vitest)|pytest|jest|cargo\s+test|go\s+test)\b/

const OUTCOME_LABELS: Record<string, string> = {
  'committed': '→ committed',
  'tested': '→ tested',
  'in-progress': '→ in-progress',
  'quick-qa': '(Q&A)',
}

/** 從最後幾輪的 tool 模式推斷 outcome */
function inferOutcome(messages: ParsedLine[]): { status: OutcomeStatus; signals: OutcomeSignals } {
  const signals: OutcomeSignals = {
    gitCommitInvoked: false,
    testCommandRan: false,
    endedWithEdits: false,
    isQuickQA: false,
  }

  // 掃描 Bash tool 的 input 內容尋找 git commit / test 指令（先掃再判 quick-qa）
  for (const msg of messages) {
    if (!msg.hasToolUse || !msg.contentJson) continue
    try {
      const content = JSON.parse(msg.contentJson) as unknown[]
      for (const block of content) {
        if (typeof block !== 'object' || block === null) continue
        const b = block as Record<string, unknown>
        if (b.type !== 'tool_use') continue
        const name = b.name as string
        if (name !== 'Bash') continue
        const input = b.input as Record<string, unknown> | undefined
        const command = (input?.command as string) ?? ''
        if (GIT_COMMIT_RE.test(command)) {
          signals.gitCommitInvoked = true
        }
        if (TEST_COMMAND_RE.test(command)) {
          signals.testCommandRan = true
        }
      }
    } catch { /* malformed contentJson */ }
  }

  // 最後 3 輪的 tool 模式
  const lastFew = messages.slice(-3)
  const lastToolNames = lastFew.flatMap(m => m.toolNames)
  if (lastToolNames.some(t => t === 'Edit' || t === 'Write')) {
    signals.endedWithEdits = true
  }

  // 推斷（保守：只在高信心時標記）
  // 先檢查具體 outcome，再判斷 quick-qa（避免短 session 有明確動作但被誤判）
  if (signals.gitCommitInvoked) return { status: 'committed', signals }
  if (signals.testCommandRan) return { status: 'tested', signals }
  if (signals.endedWithEdits) return { status: 'in-progress', signals }

  // Quick QA：短 session 且幾乎無 tool_use，且無具體 outcome
  const toolUseCount = messages.filter(m => m.hasToolUse).length
  if (messages.length < 6 && toolUseCount <= 1) {
    signals.isQuickQA = true
    return { status: 'quick-qa', signals }
  }

  return { status: null, signals }
}

// ── Multi-Signal Tags ──

/** 文字 regex 標籤規則（擴充至 20+ 條） */
const TEXT_TAG_RULES: Array<{ pattern: RegExp; tag: string }> = [
  // 原有 8 條
  { pattern: /\b(fix|bug|error|broken|crash|issue)\b/, tag: 'bug-fix' },
  { pattern: /\b(refactor|rename|restructure|cleanup|simplify)\b/, tag: 'refactor' },
  { pattern: /\b(test|spec|vitest|jest|pytest|coverage)\b/, tag: 'testing' },
  { pattern: /\b(deploy|release|version|publish|ci|cd)\b/, tag: 'deployment' },
  { pattern: /\b(auth|login|token|password|oauth)\b/, tag: 'auth' },
  { pattern: /\b(style|css|theme|layout|responsive)\b/, tag: 'ui' },
  { pattern: /\b(doc|readme|jsdoc|comment|changelog)\b/, tag: 'docs' },
  { pattern: /\b(config|env|setup|install|init)\b/, tag: 'config' },
  // 新增
  { pattern: /\b(perf|performance|optimize|speed|slow|fast|cache)\b/, tag: 'performance' },
  { pattern: /\b(database|sql|sqlite|postgres|mysql|migration|schema)\b/, tag: 'database' },
  { pattern: /\b(api|endpoint|route|rest|graphql|grpc)\b/, tag: 'api' },
  { pattern: /\b(security|vulnerability|xss|csrf|injection|sanitize)\b/, tag: 'security' },
  { pattern: /\b(docker|container|kubernetes|k8s|compose)\b/, tag: 'infra' },
  { pattern: /\b(build|webpack|vite|esbuild|bundle|compile)\b/, tag: 'build' },
  { pattern: /\b(type|typescript|interface|generic|typing)\b/, tag: 'types' },
  { pattern: /\b(lint|eslint|prettier|format)\b/, tag: 'lint' },
  { pattern: /\b(hook|middleware|plugin|extension)\b/, tag: 'architecture' },
  { pattern: /\b(upload|download|file|image|asset|media)\b/, tag: 'files' },
  { pattern: /\b(email|notification|alert|webhook)\b/, tag: 'messaging' },
  { pattern: /\b(i18n|l10n|translate|locale|language)\b/, tag: 'i18n' },
]

/** 路徑 → 標籤推斷規則（module-level 避免每次呼叫重建 regex） */
const PATH_TAG_RULES: Array<{ test: (p: string) => boolean; tag: string }> = [
  { test: (p) => /\.(css|scss|sass|less|styled)/.test(p) || /\/styles?\//.test(p), tag: 'ui' },
  { test: (p) => /\.(test|spec)\.(ts|tsx|js|jsx)/.test(p) || /\/__tests__\//.test(p) || /\/tests?\//.test(p), tag: 'testing' },
  { test: (p) => /migration/.test(p) || /\.sql$/.test(p), tag: 'database' },
  { test: (p) => /docker|compose/.test(p) || /\.dockerfile$/i.test(p), tag: 'infra' },
  { test: (p) => /\.md$/.test(p) || /readme/i.test(p) || /changelog/i.test(p), tag: 'docs' },
  { test: (p) => /\.(json|ya?ml|toml|ini|env)$/.test(p) && !/package-lock|yarn\.lock/.test(p), tag: 'config' },
  { test: (p) => /auth|login/.test(p), tag: 'auth' },
  { test: (p) => /route|api|endpoint/.test(p), tag: 'api' },
]

/** 從檔案路徑推斷標籤 */
function tagsFromPaths(filePaths: string[]): Set<string> {
  const tags = new Set<string>()
  for (const p of filePaths) {
    const lower = p.toLowerCase()
    for (const rule of PATH_TAG_RULES) {
      if (rule.test(lower)) tags.add(rule.tag)
    }
  }
  return tags
}

/** 從工具使用模式推斷標籤 */
function tagsFromToolPatterns(toolCounts: Map<string, number>): Set<string> {
  const tags = new Set<string>()
  const editCount = toolCounts.get('Edit') ?? 0
  const readCount = toolCounts.get('Read') ?? 0
  const bashCount = toolCounts.get('Bash') ?? 0
  const writeCount = toolCounts.get('Write') ?? 0

  // 大量 Read + 少量 Edit = code review
  if (readCount > 5 && editCount <= 1 && writeCount === 0) tags.add('code-review')
  // 大量 Edit = refactor（如果還沒有 bug-fix tag）
  if (editCount > 5) tags.add('refactor')
  // Bash 密集 = debugging 或 deployment
  if (bashCount > 5 && editCount <= 2) tags.add('debugging')
  // 大量 Write = scaffolding / 新功能
  if (writeCount > 3) tags.add('scaffolding')

  return tags
}

/** outcome → tag 映射 */
function tagsFromOutcome(status: OutcomeStatus): Set<string> {
  const tags = new Set<string>()
  if (status === 'committed') tags.add('committed')
  if (status === 'tested') tags.add('tested')
  return tags
}

// ── File Path Extraction + session_files ──

/** tool name → operation 映射 */
const TOOL_OPERATION_MAP: Record<string, FileOperation> = {
  Read: 'read',
  Edit: 'edit',
  Write: 'write',
  Glob: 'discovery',
  Grep: 'discovery',
}

/** tool name → file_path input key 映射 */
const FILE_PATH_KEYS: Record<string, string> = {
  Read: 'file_path',
  Edit: 'file_path',
  Write: 'file_path',
  Glob: 'path',
  Grep: 'path',
}

interface FileEvent {
  filePath: string
  operation: FileOperation
  sequence: number
}

/** 從 messages 提取所有檔案事件 */
function extractFileEvents(messages: ParsedLine[]): FileEvent[] {
  const events: FileEvent[] = []
  for (let seq = 0; seq < messages.length; seq++) {
    const msg = messages[seq]
    if (!msg.hasToolUse || !msg.contentJson) continue
    try {
      const content = JSON.parse(msg.contentJson) as unknown[]
      for (const block of content) {
        if (typeof block !== 'object' || block === null) continue
        const b = block as Record<string, unknown>
        if (b.type !== 'tool_use') continue
        const name = b.name as string
        const pathKey = FILE_PATH_KEYS[name]
        if (!pathKey) continue
        const input = b.input as Record<string, unknown> | undefined
        const filePath = input?.[pathKey]
        if (typeof filePath !== 'string' || !filePath) continue
        if (isNoisePath(filePath)) continue
        const operation = TOOL_OPERATION_MAP[name] ?? 'discovery'
        events.push({ filePath, operation, sequence: seq })
      }
    } catch { /* malformed contentJson */ }
  }
  return events
}

/** 從 file events 聚合成 session_files 記錄 */
function aggregateFileEvents(events: FileEvent[]): SessionFileInput[] {
  const map = new Map<string, SessionFileInput>()
  for (const e of events) {
    const key = `${e.filePath}::${e.operation}`
    const existing = map.get(key)
    if (existing) {
      existing.count++
      if (e.sequence < existing.firstSeenSeq) existing.firstSeenSeq = e.sequence
      if (e.sequence > existing.lastSeenSeq) existing.lastSeenSeq = e.sequence
    } else {
      map.set(key, {
        filePath: e.filePath,
        operation: e.operation,
        count: 1,
        firstSeenSeq: e.sequence,
        lastSeenSeq: e.sequence,
      })
    }
  }
  return [...map.values()]
}

// ── Duration ──

function computeDuration(startedAt: string | null, endedAt: string | null): number | null {
  if (!startedAt || !endedAt) return null
  const start = new Date(startedAt).getTime()
  const end = new Date(endedAt).getTime()
  if (isNaN(start) || isNaN(end) || end <= start) return null
  return Math.round((end - start) / 1000)
}

// ── Active Time ──

const IDLE_THRESHOLD_SECONDS = 300

/** 計算 active time：累加相鄰 message 間 ≤ 5 分鐘的間隔秒數 */
export function computeActiveTime(messages: ParsedLine[]): number | null {
  const withTimestamp = messages.filter(m => m.timestamp != null)
  if (withTimestamp.length < 2) return null

  const sorted = [...withTimestamp].sort((a, b) =>
    new Date(a.timestamp!).getTime() - new Date(b.timestamp!).getTime(),
  )

  let activeSeconds = 0
  for (let i = 1; i < sorted.length; i++) {
    const gap = (new Date(sorted[i].timestamp!).getTime() - new Date(sorted[i - 1].timestamp!).getTime()) / 1000
    if (gap <= IDLE_THRESHOLD_SECONDS) {
      activeSeconds += gap
    }
  }

  return activeSeconds
}

// ── Main Entry Point ──

export interface SummarizerResult {
  summary: SessionSummary
  sessionFiles: SessionFileInput[]
}

/** 為一組 ParsedLine 產生結構化摘要 + session_files */
export function summarizeSession(
  messages: ParsedLine[],
  startedAt: string | null = null,
  endedAt: string | null = null,
): SummarizerResult {
  const emptySummary: SessionSummary = {
    intentText: '',
    activityText: '',
    outcomeStatus: null,
    outcomeSignals: { gitCommitInvoked: false, testCommandRan: false, endedWithEdits: false, isQuickQA: false },
    summaryText: '',
    tags: '',
    filesTouched: '',
    toolsUsed: '',
    summaryVersion: SUMMARY_VERSION,
    durationSeconds: null,
    activeDurationSeconds: null,
  }

  if (messages.length === 0) {
    return { summary: emptySummary, sessionFiles: [] }
  }

  // ── File events + session_files ──
  const fileEvents = extractFileEvents(messages)
  const sessionFiles = aggregateFileEvents(fileEvents)

  // ── filesTouched（向後相容，逗號分隔） ──
  const uniqueFiles = [...new Set(fileEvents.map(e => e.filePath))]
  const filesTouched = uniqueFiles.slice(0, MAX_FILES).join(',')

  // ── toolsUsed（向後相容） ──
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

  // ── Intent ──
  const userMessages = messages.filter(m => m.role === 'user' && m.contentText)
  const intentText = extractIntent(userMessages)

  // ── Activity ──
  const activityText = buildActivityText(toolCounts, uniqueFiles.length)

  // ── Outcome ──
  const { status: outcomeStatus, signals: outcomeSignals } = inferOutcome(messages)

  // ── Tags（多信號交叉） ──
  const tagSet = new Set<string>()

  // 文字 regex
  const corpus = messages.map(m => m.contentText ?? '').join(' ').toLowerCase()
  for (const rule of TEXT_TAG_RULES) {
    if (rule.pattern.test(corpus)) tagSet.add(rule.tag)
  }

  // 路徑推斷
  for (const tag of tagsFromPaths(uniqueFiles)) tagSet.add(tag)

  // 工具模式推斷
  for (const tag of tagsFromToolPatterns(toolCounts)) tagSet.add(tag)

  // outcome 標籤
  for (const tag of tagsFromOutcome(outcomeStatus)) tagSet.add(tag)

  const tags = [...tagSet].join(',')

  // ── Duration ──
  const durationSeconds = computeDuration(startedAt, endedAt)
  const activeDurationSeconds = computeActiveTime(messages)

  // ── Composite summaryText ──
  const summaryParts: string[] = []
  if (intentText) summaryParts.push(intentText)
  if (activityText) summaryParts.push(activityText)
  if (outcomeStatus) {
    summaryParts.push(OUTCOME_LABELS[outcomeStatus] ?? '')
  }
  const summaryText = truncate(summaryParts.filter(Boolean).join(' | '), MAX_SUMMARY_LEN)

  return {
    summary: {
      intentText,
      activityText,
      outcomeStatus,
      outcomeSignals,
      summaryText,
      tags,
      filesTouched,
      toolsUsed,
      summaryVersion: SUMMARY_VERSION,
      durationSeconds,
      activeDurationSeconds,
    },
    sessionFiles,
  }
}
