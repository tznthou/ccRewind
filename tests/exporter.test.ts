import { describe, it, expect } from 'vitest'
import { sessionToMarkdown, type ExportSessionData } from '../src/main/exporter'
import type { Message } from '../src/shared/types'

/** 建立測試用 Message */
function makeMessage(overrides: Partial<Message> & { sequence: number }): Message {
  return {
    id: overrides.sequence,
    sessionId: 'test-session',
    type: 'user',
    role: 'user',
    contentText: null,
    contentJson: null,
    hasToolUse: false,
    hasToolResult: false,
    toolNames: null,
    timestamp: null,
    ...overrides,
  }
}

/** 建立基本 ExportSessionData */
function makeData(overrides?: Partial<ExportSessionData>): ExportSessionData {
  return {
    title: 'Test Session',
    projectName: 'test-project',
    startedAt: '2026-03-28T10:00:00Z',
    endedAt: '2026-03-28T11:00:00Z',
    messages: [],
    ...overrides,
  }
}

describe('sessionToMarkdown', () => {
  it('validSession → generates correct markdown structure', () => {
    const data = makeData({
      messages: [
        makeMessage({ sequence: 1, role: 'user', contentText: 'Hello Claude' }),
        makeMessage({ sequence: 2, type: 'assistant', role: 'assistant', contentText: 'Hi there!' }),
      ],
    })

    const md = sessionToMarkdown(data)

    expect(md).toContain('# Test Session')
    expect(md).toContain('| Project | test-project |')
    expect(md).toContain('| Started | 2026-03-28T10:00:00Z |')
    expect(md).toContain('| Ended | 2026-03-28T11:00:00Z |')
    expect(md).toContain('| Messages | 2 |')
    expect(md).toContain('## User')
    expect(md).toContain('Hello Claude')
    expect(md).toContain('## Assistant')
    expect(md).toContain('Hi there!')
  })

  it('toolContent → wrapped in <details>', () => {
    const contentJson = JSON.stringify([
      { type: 'tool_use', id: 'tu1', name: 'Read', input: { file: 'test.ts' } },
      { type: 'tool_result', tool_use_id: 'tu1', content: 'file content here' },
    ])

    const data = makeData({
      messages: [
        makeMessage({
          sequence: 1,
          type: 'assistant',
          role: 'assistant',
          contentText: 'Let me read that file.',
          contentJson,
          hasToolUse: true,
          hasToolResult: true,
        }),
      ],
    })

    const md = sessionToMarkdown(data)

    expect(md).toContain('<details>')
    expect(md).toContain('<summary>Tool: Read</summary>')
    expect(md).toContain('"file": "test.ts"')
    expect(md).toContain('<summary>Result: tu1</summary>')
    expect(md).toContain('file content here')
    expect(md).toContain('</details>')
  })

  it('emptySession → handles gracefully without throwing', () => {
    const data = makeData({ messages: [] })

    const md = sessionToMarkdown(data)

    expect(md).toContain('# Test Session')
    expect(md).toContain('| Messages | 0 |')
    // 不應拋錯
    expect(typeof md).toBe('string')
  })

  it('skips last-prompt and queue-operation messages', () => {
    const data = makeData({
      messages: [
        makeMessage({ sequence: 1, role: 'user', contentText: 'visible' }),
        makeMessage({ sequence: 2, type: 'last-prompt', role: 'user', contentText: 'hidden-lp' }),
        makeMessage({ sequence: 3, type: 'queue-operation', role: null, contentText: 'hidden-qo' }),
        makeMessage({ sequence: 4, type: 'assistant', role: 'assistant', contentText: 'also visible' }),
      ],
    })

    const md = sessionToMarkdown(data)

    expect(md).toContain('visible')
    expect(md).toContain('also visible')
    expect(md).not.toContain('hidden-lp')
    expect(md).not.toContain('hidden-qo')
    expect(md).toContain('| Messages | 2 |')
  })

  it('null title → uses "Untitled Session"', () => {
    const data = makeData({ title: null })

    const md = sessionToMarkdown(data)

    expect(md).toContain('# Untitled Session')
  })

  it('UTF-8 content (CJK + emoji) → preserved correctly', () => {
    const data = makeData({
      title: '測試對話 🚀',
      projectName: '我的專案',
      messages: [
        makeMessage({ sequence: 1, role: 'user', contentText: '你好世界 🌍 こんにちは' }),
      ],
    })

    const md = sessionToMarkdown(data)

    expect(md).toContain('# 測試對話 🚀')
    expect(md).toContain('| Project | 我的專案 |')
    expect(md).toContain('你好世界 🌍 こんにちは')
  })

  it('tool payload containing triple backticks → fence extended safely', () => {
    const codeWithBackticks = 'Here is code:\n```ts\nconsole.log("hi")\n```\nEnd.'
    const contentJson = JSON.stringify([
      { type: 'tool_result', tool_use_id: 'tu1', content: codeWithBackticks },
    ])

    const data = makeData({
      messages: [
        makeMessage({
          sequence: 1,
          type: 'assistant',
          role: 'assistant',
          contentText: null,
          contentJson,
          hasToolResult: true,
        }),
      ],
    })

    const md = sessionToMarkdown(data)

    // 應使用 4+ backtick fence 來包裹含 ``` 的內容
    expect(md).toMatch(/`{4,}\n/)
    expect(md).toContain(codeWithBackticks)
  })
})
