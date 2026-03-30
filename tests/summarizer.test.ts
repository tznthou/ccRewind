import { describe, it, expect } from 'vitest'
import { summarizeSession } from '../src/main/summarizer'
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
  it('empty session → all fields are empty strings', () => {
    const result = summarizeSession([])
    expect(result.summaryText).toBe('')
    expect(result.tags).toBe('')
    expect(result.filesTouched).toBe('')
    expect(result.toolsUsed).toBe('')
  })

  it('single user message → intent only, no conclusion', () => {
    const result = summarizeSession([
      line({ role: 'user', contentText: '幫我修 login bug' }),
    ])
    expect(result.summaryText).toContain('幫我修 login bug')
    expect(result.summaryText).not.toContain('→')
  })

  it('multiple user messages → intent + conclusion', () => {
    const result = summarizeSession([
      line({ role: 'user', contentText: '開始重構 auth module' }),
      line({ role: 'assistant', contentText: '好的' }),
      line({ role: 'user', contentText: '完成了，謝謝' }),
    ])
    expect(result.summaryText).toContain('開始重構 auth module')
    expect(result.summaryText).toContain('完成了，謝謝')
  })

  it('same first and last user message → no duplicate conclusion', () => {
    const result = summarizeSession([
      line({ role: 'user', contentText: '查一下 config' }),
      line({ role: 'assistant', contentText: '以下是結果' }),
    ])
    expect(result.summaryText).toContain('查一下 config')
    expect(result.summaryText).not.toContain('→')
  })

  it('summaryText truncated to ≤200 chars', () => {
    const longText = 'A'.repeat(300)
    const result = summarizeSession([
      line({ role: 'user', contentText: longText }),
    ])
    expect(result.summaryText.length).toBeLessThanOrEqual(200)
  })

  it('extracts file paths from tool_use contentJson', () => {
    const result = summarizeSession([
      line({
        role: 'assistant',
        hasToolUse: true,
        toolNames: ['Read'],
        contentJson: toolUseContent([
          { name: 'Read', input: { file_path: '/src/main.ts' } },
        ]),
      }),
    ])
    expect(result.filesTouched).toBe('/src/main.ts')
  })

  it('extracts path from Glob/Grep tools', () => {
    const result = summarizeSession([
      line({
        role: 'assistant',
        hasToolUse: true,
        toolNames: ['Grep'],
        contentJson: toolUseContent([
          { name: 'Grep', input: { pattern: 'foo', path: '/src/utils' } },
        ]),
      }),
    ])
    expect(result.filesTouched).toBe('/src/utils')
  })

  it('deduplicates file paths', () => {
    const result = summarizeSession([
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
    expect(result.filesTouched).toBe('/src/a.ts')
  })

  it('caps filesTouched at 20 entries', () => {
    const messages = Array.from({ length: 25 }, (_, i) =>
      line({
        role: 'assistant',
        hasToolUse: true,
        toolNames: ['Read'],
        contentJson: toolUseContent([
          { name: 'Read', input: { file_path: `/src/file${i}.ts` } },
        ]),
      }),
    )
    const result = summarizeSession(messages)
    expect(result.filesTouched.split(',').length).toBe(20)
  })

  it('counts tool usage sorted by frequency desc', () => {
    const result = summarizeSession([
      line({ toolNames: ['Read', 'Read', 'Edit'] }),
      line({ toolNames: ['Read', 'Bash'] }),
    ])
    // Read:3, Edit:1, Bash:1
    expect(result.toolsUsed).toBe('Read:3,Edit:1,Bash:1')
  })

  it('infers bug-fix tag from keywords', () => {
    const result = summarizeSession([
      line({ role: 'user', contentText: 'fix the login error' }),
    ])
    expect(result.tags).toContain('bug-fix')
  })

  it('infers refactor tag', () => {
    const result = summarizeSession([
      line({ role: 'user', contentText: 'refactor the auth module' }),
    ])
    expect(result.tags).toContain('refactor')
  })

  it('infers testing tag', () => {
    const result = summarizeSession([
      line({ role: 'user', contentText: '幫我寫 vitest test' }),
    ])
    expect(result.tags).toContain('testing')
  })

  it('infers deployment tag', () => {
    const result = summarizeSession([
      line({ role: 'user', contentText: 'prepare for release v2' }),
    ])
    expect(result.tags).toContain('deployment')
  })

  it('multiple tags from mixed keywords', () => {
    const result = summarizeSession([
      line({ role: 'user', contentText: 'fix the bug and add test spec' }),
    ])
    const tags = result.tags.split(',')
    expect(tags).toContain('bug-fix')
    expect(tags).toContain('testing')
  })

  it('no matching keywords → empty tags', () => {
    const result = summarizeSession([
      line({ role: 'user', contentText: '幫我看一下這段程式碼' }),
    ])
    expect(result.tags).toBe('')
  })

  it('malformed contentJson → gracefully skipped', () => {
    const result = summarizeSession([
      line({
        role: 'assistant',
        hasToolUse: true,
        toolNames: ['Read'],
        contentJson: '{not valid json[',
      }),
    ])
    expect(result.filesTouched).toBe('')
  })
})
