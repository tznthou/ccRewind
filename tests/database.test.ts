import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'
import { Database } from '../src/main/database'
import type { MessageInput } from '../src/main/database'

let tmpDir: string
let db: Database

/** 建立測試用 message，rawJson 預設 null */
function msg(overrides: Partial<MessageInput> & { type: string; sequence: number }): MessageInput {
  return {
    role: null,
    contentText: null,
    contentJson: null,
    hasToolUse: false,
    hasToolResult: false,
    toolNames: [],
    timestamp: null,
    rawJson: null,
    ...overrides,
  }
}

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

    expect(names).toContain('projects')
    expect(names).toContain('sessions')
    expect(names).toContain('messages')
    expect(names).toContain('messages_fts')
    expect(names).toContain('messages_ai')
    expect(names).toContain('messages_ad')

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
        msg({
          type: 'user', role: 'user', contentText: 'Hello world',
          contentJson: '"Hello world"', timestamp: '2024-06-01T10:00:00.000Z', sequence: 0,
        }),
        msg({
          type: 'assistant', role: 'assistant', contentText: 'Hi there! Let me help you.',
          contentJson: '"Hi there! Let me help you."',
          hasToolUse: true, toolNames: ['Read', 'Bash'],
          timestamp: '2024-06-01T10:00:05.000Z', sequence: 1,
        }),
      ],
    })

    const projects = db.getProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0].id).toBe('proj-1')

    const sessions = db.getSessions('proj-1')
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('sess-001')
    expect(sessions[0].title).toBe('Test session')

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
    db.indexSession({
      sessionId: 'sess-001', projectId: 'proj-1', projectDisplayName: '/Users/test/proj1',
      title: 'Original', messageCount: 1, filePath: '/tmp/fake.jsonl', fileSize: 512,
      fileMtime: '2024-06-01T10:00:00.000Z',
      startedAt: '2024-06-01T10:00:00.000Z', endedAt: '2024-06-01T10:00:00.000Z',
      messages: [msg({ type: 'user', role: 'user', contentText: 'Old message', timestamp: '2024-06-01T10:00:00.000Z', sequence: 0 })],
    })

    db.indexSession({
      sessionId: 'sess-001', projectId: 'proj-1', projectDisplayName: '/Users/test/proj1',
      title: 'Updated', messageCount: 1, filePath: '/tmp/fake.jsonl', fileSize: 600,
      fileMtime: '2024-06-01T11:00:00.000Z',
      startedAt: '2024-06-01T10:00:00.000Z', endedAt: '2024-06-01T10:00:00.000Z',
      messages: [msg({ type: 'user', role: 'user', contentText: 'New message', timestamp: '2024-06-01T10:00:00.000Z', sequence: 0 })],
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
      sessionId: 'sess-001', projectId: 'proj-1', projectDisplayName: '/test',
      title: null, messageCount: 0, filePath: '/tmp/fake.jsonl', fileSize: 0,
      fileMtime: '2024-06-01T10:00:00.000Z', startedAt: null, endedAt: null, messages: [],
    })
    expect(db.getSessionMtime('sess-001')).toBe('2024-06-01T10:00:00.000Z')
  })
})

describe('getMessages', () => {
  it('returns messages ordered by sequence', () => {
    db.indexSession({
      sessionId: 'sess-001', projectId: 'proj-1', projectDisplayName: '/test',
      title: null, messageCount: 3, filePath: '/tmp/fake.jsonl', fileSize: 0,
      fileMtime: '2024-01-01T00:00:00.000Z', startedAt: null, endedAt: null,
      messages: [
        msg({ type: 'assistant', role: 'assistant', contentText: 'Third', sequence: 2 }),
        msg({ type: 'user', role: 'user', contentText: 'First', sequence: 0 }),
        msg({ type: 'assistant', role: 'assistant', contentText: 'Second', sequence: 1 }),
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
      startedAt: '2024-01-01T00:00:00.000Z', endedAt: '2024-01-01T01:00:00.000Z', messages: [],
    })
    db.indexSession({
      sessionId: 'sess-002', projectId: 'proj-1', projectDisplayName: '/test',
      title: null, messageCount: 0, filePath: '/tmp/b.jsonl', fileSize: 0,
      fileMtime: '2024-01-02T00:00:00.000Z',
      startedAt: '2024-01-02T00:00:00.000Z', endedAt: '2024-01-02T05:00:00.000Z', messages: [],
    })

    db.updateProjectStats('proj-1')

    const projects = db.getProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0].sessionCount).toBe(2)
    expect(projects[0].lastActivityAt).toBe('2024-01-02T05:00:00.000Z')
  })
})

describe('removeStaleSessionsExcept', () => {
  it('removes sessions not in keepIds set', () => {
    db.indexSession({
      sessionId: 'keep-me', projectId: 'proj-1', projectDisplayName: '/test',
      title: null, messageCount: 1, filePath: '/tmp/a.jsonl', fileSize: 0,
      fileMtime: '2024-01-01T00:00:00.000Z', startedAt: null, endedAt: null,
      messages: [msg({ type: 'user', role: 'user', contentText: 'Keep this', sequence: 0 })],
    })
    db.indexSession({
      sessionId: 'delete-me', projectId: 'proj-1', projectDisplayName: '/test',
      title: null, messageCount: 1, filePath: '/tmp/b.jsonl', fileSize: 0,
      fileMtime: '2024-01-01T00:00:00.000Z', startedAt: null, endedAt: null,
      messages: [msg({ type: 'user', role: 'user', contentText: 'Delete this', sequence: 0 })],
    })

    db.removeStaleSessionsExcept(new Set(['keep-me']))

    const sessions = db.getSessions('proj-1')
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('keep-me')

    // 刪除的 session 的 messages 也應被清除
    expect(db.getMessages('delete-me')).toEqual([])
    // FTS 也不應搜到被刪的內容
    const results = db.search('Delete')
    expect(results).toEqual([])
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
        msg({ type: 'user', role: 'user', contentText: 'How do I deploy to production?', timestamp: '2024-01-01T00:00:00.000Z', sequence: 0 }),
        msg({ type: 'assistant', role: 'assistant', contentText: 'You can deploy using docker compose.', timestamp: '2024-01-01T00:01:00.000Z', sequence: 1 }),
      ],
    })
    db.indexSession({
      sessionId: 'sess-002', projectId: 'proj-2', projectDisplayName: '/project/beta',
      title: 'Beta session', messageCount: 1, filePath: '/tmp/b.jsonl', fileSize: 0,
      fileMtime: '2024-01-01T00:00:00.000Z',
      startedAt: '2024-01-01T00:00:00.000Z', endedAt: '2024-01-01T00:00:00.000Z',
      messages: [
        msg({ type: 'user', role: 'user', contentText: 'Help me deploy my app', timestamp: '2024-01-01T00:00:00.000Z', sequence: 0 }),
      ],
    })
  })

  it('fts5Query → returns matches with snippet', () => {
    const results = db.search('deploy')
    expect(results.length).toBeGreaterThanOrEqual(2)
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
    expect(db.search('nonexistentkeyword12345')).toEqual([])
  })

  it('malformed FTS query → returns empty array, no throw', () => {
    expect(() => db.search('"unclosed quote')).not.toThrow()
    expect(db.search('"unclosed quote')).toEqual([])
  })

  it('re-index cleans up FTS → old content not searchable', () => {
    db.indexSession({
      sessionId: 'sess-001', projectId: 'proj-1', projectDisplayName: '/project/alpha',
      title: 'Alpha session', messageCount: 1, filePath: '/tmp/a.jsonl', fileSize: 0,
      fileMtime: '2024-01-02T00:00:00.000Z',
      startedAt: '2024-01-01T00:00:00.000Z', endedAt: '2024-01-01T00:00:00.000Z',
      messages: [
        msg({ type: 'user', role: 'user', contentText: 'Something completely different', timestamp: '2024-01-01T00:00:00.000Z', sequence: 0 }),
      ],
    })

    const results = db.search('deploy')
    for (const r of results) {
      expect(r.sessionId).not.toBe('sess-001')
    }
  })
})
