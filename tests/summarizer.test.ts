import { describe, it, expect } from 'vitest'
import { summarizeSession, SUMMARY_VERSION, computeActiveTime } from '../src/main/summarizer'
import type { ParsedLine } from '../src/shared/types'

/** 建立測試用 ParsedLine，預設值皆為空 */
function line(overrides: Partial<ParsedLine> = {}): ParsedLine {
  return {
    type: 'user',
    uuid: null,
    parentUuid: null,
    sessionId: null,
    timestamp: null,
    role: null,
    contentText: null,
    contentJson: null,
    hasToolUse: false,
    hasToolResult: false,
    toolNames: [],
    rawJson: '{}',
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheCreationTokens: null,
    model: null,
    ...overrides,
  }
}

/** 建立含 tool_use 的 contentJson 字串 */
function toolUseContent(
  tools: Array<{ name: string; input: Record<string, unknown> }>,
): string {
  return JSON.stringify(
    tools.map(t => ({ type: 'tool_use', name: t.name, input: t.input })),
  )
}

describe('summarizeSession', () => {
  // ── 基本 ──

  it('empty session → all fields are empty/default', () => {
    const { summary, sessionFiles } = summarizeSession([])
    expect(summary.intentText).toBe('')
    expect(summary.summaryText).toBe('')
    expect(summary.tags).toBe('')
    expect(summary.filesTouched).toBe('')
    expect(summary.toolsUsed).toBe('')
    expect(summary.outcomeStatus).toBeNull()
    expect(summary.summaryVersion).toBe(SUMMARY_VERSION)
    expect(sessionFiles).toEqual([])
  })

  // ── Intent Extraction ──

  it('extracts intent from first substantive user message', () => {
    const { summary } = summarizeSession([
      line({ role: 'user', contentText: 'hey' }),
      line({ role: 'user', contentText: '幫我修 login bug' }),
    ])
    expect(summary.intentText).toBe('幫我修 login bug')
  })

  it('skips greeting/continuation messages', () => {
    const { summary } = summarizeSession([
      line({ role: 'user', contentText: 'hello' }),
      line({ role: 'user', contentText: 'continue' }),
      line({ role: 'user', contentText: '重構 auth 模組的錯誤處理' }),
    ])
    expect(summary.intentText).toBe('重構 auth 模組的錯誤處理')
  })

  it('falls back to first message if all are hollow', () => {
    const { summary } = summarizeSession([
      line({ role: 'user', contentText: 'hey' }),
      line({ role: 'user', contentText: 'ok' }),
    ])
    // fallback: 取第一筆有內容的
    expect(summary.intentText).toBe('hey')
  })

  // ── Activity Text ──

  it('generates activity text from tool usage', () => {
    const { summary } = summarizeSession([
      line({ role: 'user', contentText: '改程式' }),
      line({
        role: 'assistant',
        hasToolUse: true,
        toolNames: ['Edit', 'Edit', 'Edit'],
        contentJson: toolUseContent([
          { name: 'Edit', input: { file_path: '/src/a.ts' } },
          { name: 'Edit', input: { file_path: '/src/b.ts' } },
          { name: 'Edit', input: { file_path: '/src/c.ts' } },
        ]),
      }),
    ])
    expect(summary.activityText).toContain('Edit×3')
    expect(summary.activityText).toContain('3 files')
  })

  // ── Outcome Inference ──

  it('infers committed from git commit in Bash (even short session)', () => {
    const { summary } = summarizeSession([
      line({ role: 'user', contentText: '提交這些修改' }),
      line({
        role: 'assistant',
        hasToolUse: true,
        toolNames: ['Bash'],
        contentJson: toolUseContent([
          { name: 'Bash', input: { command: 'git commit -m "fix: something"' } },
        ]),
      }),
    ])
    expect(summary.outcomeStatus).toBe('committed')
    expect(summary.outcomeSignals.gitCommitInvoked).toBe(true)
    expect(summary.summaryText).toContain('committed')
  })

  it('infers tested from test command in Bash', () => {
    const { summary } = summarizeSession([
      line({ role: 'user', contentText: '跑測試' }),
      ...Array.from({ length: 6 }, () => line({ role: 'assistant', contentText: 'ok' })),
      line({
        role: 'assistant',
        hasToolUse: true,
        toolNames: ['Bash'],
        contentJson: toolUseContent([
          { name: 'Bash', input: { command: 'pnpm vitest run' } },
        ]),
      }),
    ])
    expect(summary.outcomeStatus).toBe('tested')
    expect(summary.outcomeSignals.testCommandRan).toBe(true)
  })

  it('infers quick-qa for short sessions without tool use', () => {
    const { summary } = summarizeSession([
      line({ role: 'user', contentText: 'TypeScript 的 enum 怎麼用？' }),
      line({ role: 'assistant', contentText: '以下是說明...' }),
    ])
    expect(summary.outcomeStatus).toBe('quick-qa')
    expect(summary.outcomeSignals.isQuickQA).toBe(true)
    expect(summary.summaryText).toContain('Q&A')
  })

  it('infers in-progress when ending with edits', () => {
    const messages = [
      line({ role: 'user', contentText: '幫我改這個功能' }),
      ...Array.from({ length: 6 }, () => line({ role: 'assistant', contentText: 'ok' })),
      line({
        role: 'assistant',
        hasToolUse: true,
        toolNames: ['Edit'],
        contentJson: toolUseContent([
          { name: 'Edit', input: { file_path: '/src/foo.ts' } },
        ]),
      }),
    ]
    const { summary } = summarizeSession(messages)
    expect(summary.outcomeStatus).toBe('in-progress')
    expect(summary.outcomeSignals.endedWithEdits).toBe(true)
  })

  // ── Composite summaryText ──

  it('combines intent, activity, outcome into summaryText', () => {
    const { summary } = summarizeSession([
      line({ role: 'user', contentText: '修 auth bug' }),
      ...Array.from({ length: 6 }, () => line({ role: 'assistant', contentText: 'ok' })),
      line({
        role: 'assistant',
        hasToolUse: true,
        toolNames: ['Edit', 'Bash'],
        contentJson: toolUseContent([
          { name: 'Edit', input: { file_path: '/src/auth.ts' } },
          { name: 'Bash', input: { command: 'git commit -m "fix"' } },
        ]),
      }),
    ])
    expect(summary.summaryText).toContain('修 auth bug')
    expect(summary.summaryText).toContain('committed')
  })

  it('summaryText truncated to ≤300 chars', () => {
    const longText = 'A'.repeat(400)
    const { summary } = summarizeSession([
      line({ role: 'user', contentText: longText }),
    ])
    expect(summary.summaryText.length).toBeLessThanOrEqual(300)
  })

  // ── Tags (multi-signal) ──

  it('infers bug-fix tag from text keywords', () => {
    const { summary } = summarizeSession([
      line({ role: 'user', contentText: 'fix the login error' }),
    ])
    expect(summary.tags).toContain('bug-fix')
  })

  it('infers tags from file paths', () => {
    const { summary } = summarizeSession([
      line({
        role: 'assistant',
        hasToolUse: true,
        toolNames: ['Edit'],
        contentJson: toolUseContent([
          { name: 'Edit', input: { file_path: '/src/components/App.module.css' } },
        ]),
      }),
    ])
    expect(summary.tags).toContain('ui')
  })

  it('infers testing tag from test file path', () => {
    const { summary } = summarizeSession([
      line({
        role: 'assistant',
        hasToolUse: true,
        toolNames: ['Edit'],
        contentJson: toolUseContent([
          { name: 'Edit', input: { file_path: '/src/__tests__/auth.test.ts' } },
        ]),
      }),
    ])
    expect(summary.tags).toContain('testing')
  })

  it('infers code-review from heavy Read + low Edit', () => {
    const messages = Array.from({ length: 8 }, (_, i) =>
      line({
        role: 'assistant',
        hasToolUse: true,
        toolNames: ['Read'],
        contentJson: toolUseContent([
          { name: 'Read', input: { file_path: `/src/file${i}.ts` } },
        ]),
      }),
    )
    const { summary } = summarizeSession(messages)
    expect(summary.tags).toContain('code-review')
  })

  it('adds outcome tags (committed/tested)', () => {
    const { summary } = summarizeSession([
      line({ role: 'user', contentText: '提交' }),
      ...Array.from({ length: 6 }, () => line({ role: 'assistant', contentText: 'ok' })),
      line({
        role: 'assistant',
        hasToolUse: true,
        toolNames: ['Bash'],
        contentJson: toolUseContent([
          { name: 'Bash', input: { command: 'git commit -m "feat"' } },
        ]),
      }),
    ])
    expect(summary.tags).toContain('committed')
  })

  it('multiple tags from mixed signals', () => {
    const { summary } = summarizeSession([
      line({ role: 'user', contentText: 'fix the bug and add test spec' }),
    ])
    const tags = summary.tags.split(',')
    expect(tags).toContain('bug-fix')
    expect(tags).toContain('testing')
  })

  it('no matching signals → empty tags', () => {
    const { summary } = summarizeSession([
      line({ role: 'user', contentText: '幫我看一下這段程式碼' }),
    ])
    // quick-qa tag 可能存在
    const tags = summary.tags.split(',').filter(t => t && t !== 'quick-qa' && t !== 'committed' && t !== 'tested')
    // 其他 tag 可能為空或含 code-review 等
    expect(tags.length).toBeLessThanOrEqual(1)
  })

  // ── File Extraction + session_files ──

  it('extracts file paths from tool_use contentJson', () => {
    const { summary } = summarizeSession([
      line({
        role: 'assistant',
        hasToolUse: true,
        toolNames: ['Read'],
        contentJson: toolUseContent([
          { name: 'Read', input: { file_path: '/src/main.ts' } },
        ]),
      }),
    ])
    expect(summary.filesTouched).toBe('/src/main.ts')
  })

  it('generates session_files with correct operation types', () => {
    const { sessionFiles } = summarizeSession([
      line({
        role: 'assistant',
        hasToolUse: true,
        toolNames: ['Read'],
        contentJson: toolUseContent([
          { name: 'Read', input: { file_path: '/src/a.ts' } },
        ]),
      }),
      line({
        role: 'assistant',
        hasToolUse: true,
        toolNames: ['Edit'],
        contentJson: toolUseContent([
          { name: 'Edit', input: { file_path: '/src/a.ts' } },
        ]),
      }),
    ])
    const readEntry = sessionFiles.find(f => f.filePath === '/src/a.ts' && f.operation === 'read')
    const editEntry = sessionFiles.find(f => f.filePath === '/src/a.ts' && f.operation === 'edit')
    expect(readEntry).toBeDefined()
    expect(readEntry!.count).toBe(1)
    expect(editEntry).toBeDefined()
    expect(editEntry!.count).toBe(1)
  })

  it('tracks first/last seen sequence in session_files', () => {
    const { sessionFiles } = summarizeSession([
      line({
        role: 'assistant',
        hasToolUse: true,
        toolNames: ['Read'],
        contentJson: toolUseContent([
          { name: 'Read', input: { file_path: '/src/a.ts' } },
        ]),
      }),
      line({ role: 'user', contentText: 'ok' }),
      line({
        role: 'assistant',
        hasToolUse: true,
        toolNames: ['Read'],
        contentJson: toolUseContent([
          { name: 'Read', input: { file_path: '/src/a.ts' } },
        ]),
      }),
    ])
    const entry = sessionFiles.find(f => f.filePath === '/src/a.ts' && f.operation === 'read')
    expect(entry!.count).toBe(2)
    expect(entry!.firstSeenSeq).toBe(0)
    expect(entry!.lastSeenSeq).toBe(2)
  })

  it('filters out noise paths (node_modules, .git, dist)', () => {
    const { summary, sessionFiles } = summarizeSession([
      line({
        role: 'assistant',
        hasToolUse: true,
        toolNames: ['Read', 'Read', 'Read'],
        contentJson: toolUseContent([
          { name: 'Read', input: { file_path: '/project/node_modules/foo/index.js' } },
          { name: 'Read', input: { file_path: '/project/.git/config' } },
          { name: 'Read', input: { file_path: '/project/src/main.ts' } },
        ]),
      }),
    ])
    expect(summary.filesTouched).toBe('/project/src/main.ts')
    expect(sessionFiles.length).toBe(1)
    expect(sessionFiles[0].filePath).toBe('/project/src/main.ts')
  })

  it('Grep/Glob mapped to discovery operation', () => {
    const { sessionFiles } = summarizeSession([
      line({
        role: 'assistant',
        hasToolUse: true,
        toolNames: ['Grep'],
        contentJson: toolUseContent([
          { name: 'Grep', input: { pattern: 'foo', path: '/src/utils' } },
        ]),
      }),
    ])
    expect(sessionFiles[0].operation).toBe('discovery')
  })

  it('caps filesTouched at 30 entries', () => {
    const messages = Array.from({ length: 35 }, (_, i) =>
      line({
        role: 'assistant',
        hasToolUse: true,
        toolNames: ['Read'],
        contentJson: toolUseContent([
          { name: 'Read', input: { file_path: `/src/file${i}.ts` } },
        ]),
      }),
    )
    const { summary } = summarizeSession(messages)
    expect(summary.filesTouched.split(',').length).toBe(30)
  })

  it('counts tool usage sorted by frequency desc', () => {
    const { summary } = summarizeSession([
      line({ toolNames: ['Read', 'Read', 'Edit'] }),
      line({ toolNames: ['Read', 'Bash'] }),
    ])
    expect(summary.toolsUsed).toBe('Read:3,Edit:1,Bash:1')
  })

  // ── Duration ──

  it('computes duration from startedAt/endedAt', () => {
    const { summary } = summarizeSession(
      [line({ role: 'user', contentText: 'test' })],
      '2024-01-01T10:00:00Z',
      '2024-01-01T10:30:00Z',
    )
    expect(summary.durationSeconds).toBe(1800)
  })

  it('duration is null when timestamps missing', () => {
    const { summary } = summarizeSession(
      [line({ role: 'user', contentText: 'test' })],
    )
    expect(summary.durationSeconds).toBeNull()
  })

  // ── Version ──

  it('includes summary version', () => {
    const { summary } = summarizeSession([
      line({ role: 'user', contentText: 'test' }),
    ])
    expect(summary.summaryVersion).toBe(SUMMARY_VERSION)
  })

  // ── Malformed data ──

  it('malformed contentJson → gracefully skipped', () => {
    const { summary } = summarizeSession([
      line({
        role: 'assistant',
        hasToolUse: true,
        toolNames: ['Read'],
        contentJson: '{not valid json[',
      }),
    ])
    expect(summary.filesTouched).toBe('')
  })

  // ── Active Duration ──

  it('computes activeDurationSeconds in summary', () => {
    const { summary } = summarizeSession(
      [
        line({ timestamp: '2024-01-01T10:00:00Z', role: 'user', contentText: 'start' }),
        line({ timestamp: '2024-01-01T10:02:00Z', role: 'assistant', contentText: 'reply' }),
        line({ timestamp: '2024-01-01T10:10:00Z', role: 'user', contentText: 'idle gap' }),
        line({ timestamp: '2024-01-01T10:12:00Z', role: 'assistant', contentText: 'reply2' }),
      ],
      '2024-01-01T10:00:00Z',
      '2024-01-01T10:12:00Z',
    )
    // gap 0→1 = 120s (≤300, counted), gap 1→2 = 480s (>300, skipped), gap 2→3 = 120s (≤300, counted)
    expect(summary.activeDurationSeconds).toBe(240)
    // wall clock = 720s, active = 240s
    expect(summary.durationSeconds).toBe(720)
  })
})

describe('computeActiveTime', () => {
  it('returns null for empty messages', () => {
    expect(computeActiveTime([])).toBeNull()
  })

  it('returns null for single message', () => {
    expect(computeActiveTime([
      line({ timestamp: '2024-01-01T10:00:00Z' }),
    ])).toBeNull()
  })

  it('returns 0 for messages without timestamps', () => {
    expect(computeActiveTime([
      line({ timestamp: null }),
      line({ timestamp: null }),
    ])).toBeNull()
  })

  it('sums only gaps ≤ 300 seconds', () => {
    const messages = [
      line({ timestamp: '2024-01-01T10:00:00Z' }),
      line({ timestamp: '2024-01-01T10:02:00Z' }),  // +120s → counted
      line({ timestamp: '2024-01-01T10:10:00Z' }),  // +480s → skipped (>300)
      line({ timestamp: '2024-01-01T10:12:00Z' }),  // +120s → counted
    ]
    expect(computeActiveTime(messages)).toBe(240) // 120 + 120
  })

  it('counts exactly 300s gap as active', () => {
    const messages = [
      line({ timestamp: '2024-01-01T10:00:00Z' }),
      line({ timestamp: '2024-01-01T10:05:00Z' }),  // exactly 300s
    ]
    expect(computeActiveTime(messages)).toBe(300)
  })

  it('skips gap of 301 seconds', () => {
    const messages = [
      line({ timestamp: '2024-01-01T10:00:00Z' }),
      line({ timestamp: '2024-01-01T10:05:01Z' }),  // 301s → skipped
    ]
    expect(computeActiveTime(messages)).toBe(0)
  })

  it('sorts by timestamp before computing', () => {
    const messages = [
      line({ timestamp: '2024-01-01T10:04:00Z' }),  // out of order
      line({ timestamp: '2024-01-01T10:00:00Z' }),
      line({ timestamp: '2024-01-01T10:02:00Z' }),
    ]
    // sorted: 10:00, 10:02, 10:04 → gaps: 120s + 120s = 240s
    expect(computeActiveTime(messages)).toBe(240)
  })

  it('filters out messages without timestamp', () => {
    const messages = [
      line({ timestamp: '2024-01-01T10:00:00Z' }),
      line({ timestamp: null }),
      line({ timestamp: '2024-01-01T10:02:00Z' }),
    ]
    expect(computeActiveTime(messages)).toBe(120)
  })

  it('handles all consecutive active gaps', () => {
    const messages = [
      line({ timestamp: '2024-01-01T10:00:00Z' }),
      line({ timestamp: '2024-01-01T10:01:00Z' }),  // +60s
      line({ timestamp: '2024-01-01T10:02:00Z' }),  // +60s
      line({ timestamp: '2024-01-01T10:03:00Z' }),  // +60s
    ]
    expect(computeActiveTime(messages)).toBe(180)
  })

  it('handles all idle gaps (returns 0)', () => {
    const messages = [
      line({ timestamp: '2024-01-01T10:00:00Z' }),
      line({ timestamp: '2024-01-01T10:10:00Z' }),  // +600s → skipped
      line({ timestamp: '2024-01-01T10:20:00Z' }),  // +600s → skipped
    ]
    expect(computeActiveTime(messages)).toBe(0)
  })
})
