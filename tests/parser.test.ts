import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { parseContent, parseLine, parseSession } from '../src/main/parser'

const FIXTURES = path.join(__dirname, 'fixtures')

describe('parseContent', () => {
  it('string content → contentText directly', () => {
    const result = parseContent('Hello world')
    expect(result.contentText).toBe('Hello world')
    expect(result.hasToolUse).toBe(false)
    expect(result.hasToolResult).toBe(false)
    expect(result.toolNames).toEqual([])
  })

  it('null content → contentText null', () => {
    const result = parseContent(null)
    expect(result.contentText).toBeNull()
  })

  it('array with text blocks → concatenated with newline', () => {
    const content = [
      { type: 'text', text: 'Line 1' },
      { type: 'text', text: 'Line 2' },
    ]
    const result = parseContent(content)
    expect(result.contentText).toBe('Line 1\nLine 2')
  })

  it('array with tool_use → marks flag and records name', () => {
    const content = [
      { type: 'text', text: 'Let me read it.' },
      { type: 'tool_use', id: 'toolu_001', name: 'Read', input: {} },
    ]
    const result = parseContent(content)
    expect(result.contentText).toBe('Let me read it.')
    expect(result.hasToolUse).toBe(true)
    expect(result.toolNames).toEqual(['Read'])
  })

  it('array with tool_result → marks flag', () => {
    const content = [
      { type: 'tool_result', tool_use_id: 'toolu_001', content: 'file data' },
    ]
    const result = parseContent(content)
    expect(result.hasToolResult).toBe(true)
    expect(result.contentText).toBeNull()
  })

  it('array with thinking → skipped, not in contentText', () => {
    const content = [
      { type: 'thinking', thinking: 'Let me think...' },
      { type: 'text', text: 'Here is the answer.' },
    ]
    const result = parseContent(content)
    expect(result.contentText).toBe('Here is the answer.')
  })

  it('multiple tool_use → records all names', () => {
    const content = [
      { type: 'tool_use', id: 'toolu_001', name: 'Read', input: {} },
      { type: 'tool_use', id: 'toolu_002', name: 'Bash', input: {} },
    ]
    const result = parseContent(content)
    expect(result.toolNames).toEqual(['Read', 'Bash'])
  })
})

describe('parseLine', () => {
  it('user message with string content', () => {
    const line = JSON.stringify({
      type: 'user',
      uuid: 'u1',
      parentUuid: null,
      timestamp: '2024-06-01T10:00:00.000Z',
      sessionId: 'sess-001',
      message: { role: 'user', content: 'Hello' },
    })
    const result = parseLine(line)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('user')
    expect(result!.role).toBe('user')
    expect(result!.contentText).toBe('Hello')
    expect(result!.uuid).toBe('u1')
    expect(result!.timestamp).toBe('2024-06-01T10:00:00.000Z')
  })

  it('assistant message with tool_use', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'a1',
      parentUuid: 'u1',
      timestamp: '2024-06-01T10:00:01.000Z',
      sessionId: 'sess-001',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Reading file.' },
          { type: 'tool_use', id: 'toolu_001', name: 'Read', input: {} },
        ],
      },
    })
    const result = parseLine(line)
    expect(result).not.toBeNull()
    expect(result!.role).toBe('assistant')
    expect(result!.contentText).toBe('Reading file.')
    expect(result!.hasToolUse).toBe(true)
    expect(result!.toolNames).toEqual(['Read'])
  })

  it('malformed JSON → returns null', () => {
    expect(parseLine('NOT VALID JSON')).toBeNull()
    expect(parseLine('{{{broken')).toBeNull()
  })

  it('empty line → returns null', () => {
    expect(parseLine('')).toBeNull()
    expect(parseLine('  ')).toBeNull()
  })

  it('unknown type → still returns ParsedLine', () => {
    const line = JSON.stringify({ type: 'file-history-snapshot', sessionId: 's1' })
    const result = parseLine(line)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('file-history-snapshot')
    expect(result!.contentText).toBeNull()
  })

  it('queue-operation → parsed without message', () => {
    const line = JSON.stringify({
      type: 'queue-operation',
      operation: 'enqueue',
      timestamp: '2024-06-01T10:00:00.000Z',
      sessionId: 's1',
    })
    const result = parseLine(line)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('queue-operation')
    expect(result!.role).toBeNull()
  })
})

describe('parseSession', () => {
  it('sample.jsonl → full parse with correct structure', async () => {
    const result = await parseSession(path.join(FIXTURES, 'sample.jsonl'), 'test-session-001')
    expect(result.sessionId).toBe('test-session-001')
    expect(result.title).toBe('Help me review this code')
    expect(result.skippedLines).toBe(0)
    expect(result.totalLines).toBe(8)
    expect(result.messages.length).toBe(8)
    expect(result.startedAt).toBe('2024-06-01T10:00:00.000Z')
    expect(result.endedAt).toBe('2024-06-01T10:00:07.000Z')

    // 驗證 assistant with tool_use
    const assistantMsg = result.messages.find(m => m.uuid === 'a1')
    expect(assistantMsg).toBeDefined()
    expect(assistantMsg!.hasToolUse).toBe(true)
    expect(assistantMsg!.toolNames).toEqual(['Read'])
    expect(assistantMsg!.contentText).toBe("I'll review the code. Let me read it first.")

    // 驗證 assistant with multiple text blocks
    const assistant2 = result.messages.find(m => m.uuid === 'a2')
    expect(assistant2).toBeDefined()
    expect(assistant2!.contentText).toBe('The code looks clean.\nNo issues found.')
  })

  it('malformed.jsonl → skips bad line, continues', async () => {
    const result = await parseSession(path.join(FIXTURES, 'malformed.jsonl'), 'test-002')
    expect(result.skippedLines).toBe(1)
    expect(result.totalLines).toBe(3)
    expect(result.messages.length).toBe(2)
    expect(result.messages[0].type).toBe('user')
    expect(result.messages[1].type).toBe('assistant')
  })

  it('empty.jsonl → empty session', async () => {
    const result = await parseSession(path.join(FIXTURES, 'empty.jsonl'), 'empty-session')
    expect(result.messages).toEqual([])
    expect(result.totalLines).toBe(0)
    expect(result.title).toBe('empty-session')
  })

  it('title truncated at 80 chars', async () => {
    // contentText 超過 80 字元時應截斷
    const longContent = 'A'.repeat(100)
    const line = JSON.stringify({
      type: 'user',
      uuid: 'u1',
      timestamp: '2024-01-01T00:00:00.000Z',
      sessionId: 'long-title',
      message: { role: 'user', content: longContent },
    })
    // 寫到臨時檔案
    const { writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const tmpFile = path.join(tmpdir(), `test-long-title-${Date.now()}.jsonl`)
    await writeFile(tmpFile, line)

    const result = await parseSession(tmpFile, 'long-title')
    expect(result.title).toBe('A'.repeat(80) + '…')

    // cleanup
    const { unlink } = await import('node:fs/promises')
    await unlink(tmpFile)
  })
})
