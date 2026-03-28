import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'
import { Database } from '../src/main/database'

let tmpDir: string
let db: Database

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ccrewind-db-'))
  db = new Database(path.join(tmpDir, 'test.db'))
})

afterEach(async () => {
  db.close()
  await rm(tmpDir, { recursive: true, force: true })
})

describe('schema', () => {
  it('createSchema → tables, indexes, FTS5 all exist', () => {
    const tables = db.rawAll<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'trigger') ORDER BY name",
    )
    const names = tables.map(r => r.name)

    // 核心表
    expect(names).toContain('projects')
    expect(names).toContain('sessions')
    expect(names).toContain('messages')
    // FTS5 虛擬表（sqlite_master 中以多個輔助表出現）
    expect(names).toContain('messages_fts')
    // 觸發器
    expect(names).toContain('messages_ai')
    expect(names).toContain('messages_ad')

    // 索引
    const indexes = db.rawAll<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'",
    )
    const idxNames = indexes.map(r => r.name)
    expect(idxNames).toContain('idx_messages_session')
    expect(idxNames).toContain('idx_sessions_project')
  })
})

describe('upsertProject', () => {
  it('insert then update → only one row, displayName updated', () => {
    db.upsertProject('proj-1', '/Users/test/proj1')
    db.upsertProject('proj-1', '/Users/test/proj1-renamed')

    const projects = db.getProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0].id).toBe('proj-1')
    expect(projects[0].displayName).toBe('/Users/test/proj1-renamed')
  })
})

describe('indexSession', () => {
  it('writes project + session + messages atomically', () => {
    db.indexSession({
      sessionId: 'sess-001',
      projectId: 'proj-1',
      projectDisplayName: '/Users/test/proj1',
      title: 'Test session',
      messageCount: 2,
      filePath: '/tmp/fake.jsonl',
      fileSize: 1024,
      fileMtime: '2024-06-01T10:00:00.000Z',
      startedAt: '2024-06-01T10:00:00.000Z',
      endedAt: '2024-06-01T10:00:05.000Z',
      messages: [
        {
          type: 'user',
          role: 'user',
          contentText: 'Hello world',
          contentJson: '"Hello world"',
          hasToolUse: false,
          hasToolResult: false,
          toolNames: [],
          timestamp: '2024-06-01T10:00:00.000Z',
          sequence: 0,
        },
        {
          type: 'assistant',
          role: 'assistant',
          contentText: 'Hi there! Let me help you.',
          contentJson: '"Hi there! Let me help you."',
          hasToolUse: true,
          hasToolResult: false,
          toolNames: ['Read', 'Bash'],
          timestamp: '2024-06-01T10:00:05.000Z',
          sequence: 1,
        },
      ],
    })

    // 驗證 project
    const projects = db.getProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0].id).toBe('proj-1')

    // 驗證 session
    const sessions = db.getSessions('proj-1')
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('sess-001')
    expect(sessions[0].title).toBe('Test session')

    // 驗證 messages
    const messages = db.getMessages('sess-001')
    expect(messages).toHaveLength(2)
    expect(messages[0].contentText).toBe('Hello world')
    expect(messages[0].role).toBe('user')
    expect(messages[0].sequence).toBe(0)
    expect(messages[1].hasToolUse).toBe(true)
    expect(messages[1].toolNames).toEqual(['Read', 'Bash'])
    expect(messages[1].sequence).toBe(1)
  })

  it('re-index replaces old messages', () => {
    // 第一次寫入
    db.indexSession({
      sessionId: 'sess-001',
      projectId: 'proj-1',
      projectDisplayName: '/Users/test/proj1',
      title: 'Original',
      messageCount: 1,
      filePath: '/tmp/fake.jsonl',
      fileSize: 512,
      fileMtime: '2024-06-01T10:00:00.000Z',
      startedAt: '2024-06-01T10:00:00.000Z',
      endedAt: '2024-06-01T10:00:00.000Z',
      messages: [
        {
          type: 'user', role: 'user', contentText: 'Old message',
          contentJson: null, hasToolUse: false, hasToolResult: false,
          toolNames: [], timestamp: '2024-06-01T10:00:00.000Z', sequence: 0,
        },
      ],
    })

    // 第二次寫入（模擬 re-index）
    db.indexSession({
      sessionId: 'sess-001',
      projectId: 'proj-1',
      projectDisplayName: '/Users/test/proj1',
      title: 'Updated',
      messageCount: 1,
      filePath: '/tmp/fake.jsonl',
      fileSize: 600,
      fileMtime: '2024-06-01T11:00:00.000Z',
      startedAt: '2024-06-01T10:00:00.000Z',
      endedAt: '2024-06-01T10:00:00.000Z',
      messages: [
        {
          type: 'user', role: 'user', contentText: 'New message',
          contentJson: null, hasToolUse: false, hasToolResult: false,
          toolNames: [], timestamp: '2024-06-01T10:00:00.000Z', sequence: 0,
        },
      ],
    })

    const sessions = db.getSessions('proj-1')
    expect(sessions).toHaveLength(1)
    expect(sessions[0].title).toBe('Updated')

    const messages = db.getMessages('sess-001')
    expect(messages).toHaveLength(1)
    expect(messages[0].contentText).toBe('New message')
  })
})

describe('getSessionMtime', () => {
  it('returns null for unknown session', () => {
    expect(db.getSessionMtime('nonexistent')).toBeNull()
  })

  it('returns mtime for indexed session', () => {
    db.indexSession({
      sessionId: 'sess-001',
      projectId: 'proj-1',
      projectDisplayName: '/test',
      title: null,
      messageCount: 0,
      filePath: '/tmp/fake.jsonl',
      fileSize: 0,
      fileMtime: '2024-06-01T10:00:00.000Z',
      startedAt: null,
      endedAt: null,
      messages: [],
    })
    expect(db.getSessionMtime('sess-001')).toBe('2024-06-01T10:00:00.000Z')
  })
})

describe('getMessages', () => {
  it('returns messages ordered by sequence', () => {
    db.indexSession({
      sessionId: 'sess-001',
      projectId: 'proj-1',
      projectDisplayName: '/test',
      title: null,
      messageCount: 3,
      filePath: '/tmp/fake.jsonl',
      fileSize: 0,
      fileMtime: '2024-01-01T00:00:00.000Z',
      startedAt: null,
      endedAt: null,
      messages: [
        { type: 'assistant', role: 'assistant', contentText: 'Third', contentJson: null, hasToolUse: false, hasToolResult: false, toolNames: [], timestamp: null, sequence: 2 },
        { type: 'user', role: 'user', contentText: 'First', contentJson: null, hasToolUse: false, hasToolResult: false, toolNames: [], timestamp: null, sequence: 0 },
        { type: 'assistant', role: 'assistant', contentText: 'Second', contentJson: null, hasToolUse: false, hasToolResult: false, toolNames: [], timestamp: null, sequence: 1 },
      ],
    })

    const msgs = db.getMessages('sess-001')
    expect(msgs.map(m => m.contentText)).toEqual(['First', 'Second', 'Third'])
    expect(msgs.map(m => m.sequence)).toEqual([0, 1, 2])
  })
})

describe('updateProjectStats', () => {
  it('recomputes session_count and last_activity_at', () => {
    db.indexSession({
      sessionId: 'sess-001', projectId: 'proj-1', projectDisplayName: '/test',
      title: null, messageCount: 0, filePath: '/tmp/a.jsonl', fileSize: 0,
      fileMtime: '2024-01-01T00:00:00.000Z',
      startedAt: '2024-01-01T00:00:00.000Z', endedAt: '2024-01-01T01:00:00.000Z',
      messages: [],
    })
    db.indexSession({
      sessionId: 'sess-002', projectId: 'proj-1', projectDisplayName: '/test',
      title: null, messageCount: 0, filePath: '/tmp/b.jsonl', fileSize: 0,
      fileMtime: '2024-01-02T00:00:00.000Z',
      startedAt: '2024-01-02T00:00:00.000Z', endedAt: '2024-01-02T05:00:00.000Z',
      messages: [],
    })

    db.updateProjectStats('proj-1')

    const projects = db.getProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0].sessionCount).toBe(2)
    expect(projects[0].lastActivityAt).toBe('2024-01-02T05:00:00.000Z')
  })
})

describe('FTS5 search', () => {
  beforeEach(() => {
    db.indexSession({
      sessionId: 'sess-001', projectId: 'proj-1', projectDisplayName: '/project/alpha',
      title: 'Alpha session', messageCount: 2, filePath: '/tmp/a.jsonl', fileSize: 0,
      fileMtime: '2024-01-01T00:00:00.000Z',
      startedAt: '2024-01-01T00:00:00.000Z', endedAt: '2024-01-01T00:01:00.000Z',
      messages: [
        { type: 'user', role: 'user', contentText: 'How do I deploy to production?', contentJson: null, hasToolUse: false, hasToolResult: false, toolNames: [], timestamp: '2024-01-01T00:00:00.000Z', sequence: 0 },
        { type: 'assistant', role: 'assistant', contentText: 'You can deploy using docker compose.', contentJson: null, hasToolUse: false, hasToolResult: false, toolNames: [], timestamp: '2024-01-01T00:01:00.000Z', sequence: 1 },
      ],
    })
    db.indexSession({
      sessionId: 'sess-002', projectId: 'proj-2', projectDisplayName: '/project/beta',
      title: 'Beta session', messageCount: 1, filePath: '/tmp/b.jsonl', fileSize: 0,
      fileMtime: '2024-01-01T00:00:00.000Z',
      startedAt: '2024-01-01T00:00:00.000Z', endedAt: '2024-01-01T00:00:00.000Z',
      messages: [
        { type: 'user', role: 'user', contentText: 'Help me deploy my app', contentJson: null, hasToolUse: false, hasToolResult: false, toolNames: [], timestamp: '2024-01-01T00:00:00.000Z', sequence: 0 },
      ],
    })
  })

  it('fts5Query → returns matches with snippet', () => {
    const results = db.search('deploy')
    expect(results.length).toBeGreaterThanOrEqual(2)
    // 所有結果都包含 deploy 相關內容
    for (const r of results) {
      expect(r.snippet.toLowerCase()).toContain('deploy')
    }
  })

  it('search with projectId filter → only returns from that project', () => {
    const results = db.search('deploy', 'proj-1')
    expect(results.length).toBeGreaterThanOrEqual(1)
    for (const r of results) {
      expect(r.projectId).toBe('proj-1')
    }
  })

  it('search no match → returns empty array', () => {
    const results = db.search('nonexistentkeyword12345')
    expect(results).toEqual([])
  })

  it('malformed FTS query → returns empty array, no throw', () => {
    // FTS5 語法錯誤不應拋例外
    expect(() => db.search('"unclosed quote')).not.toThrow()
    const results = db.search('"unclosed quote')
    expect(results).toEqual([])
  })

  it('re-index cleans up FTS → old content not searchable', () => {
    // 原始有 "deploy" → re-index 換成不含 deploy 的內容
    db.indexSession({
      sessionId: 'sess-001', projectId: 'proj-1', projectDisplayName: '/project/alpha',
      title: 'Alpha session', messageCount: 1, filePath: '/tmp/a.jsonl', fileSize: 0,
      fileMtime: '2024-01-02T00:00:00.000Z',
      startedAt: '2024-01-01T00:00:00.000Z', endedAt: '2024-01-01T00:00:00.000Z',
      messages: [
        { type: 'user', role: 'user', contentText: 'Something completely different', contentJson: null, hasToolUse: false, hasToolResult: false, toolNames: [], timestamp: '2024-01-01T00:00:00.000Z', sequence: 0 },
      ],
    })

    // 搜 deploy 應只剩 proj-2 的結果
    const results = db.search('deploy')
    for (const r of results) {
      expect(r.sessionId).not.toBe('sess-001')
    }
  })
})
