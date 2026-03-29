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

describe('migration system', () => {
  it('schema_version table exists with baseline', () => {
    const rows = db.rawAll<{ version: number; description: string }>(
      'SELECT version, description FROM schema_version ORDER BY version',
    )
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows[0].version).toBe(0)
    expect(rows[0].description).toBe('baseline')
  })

  it('getSchemaVersion returns current version', () => {
    expect(db.getSchemaVersion()).toBeGreaterThanOrEqual(0)
  })

  it('double construction does not re-apply migrations', () => {
    const v1 = db.getSchemaVersion()
    // 用同一路徑重新建構 Database，不應重跑已套用的 migration
    const db2 = new Database(path.join(tmpDir, 'test.db'))
    const v2 = db2.getSchemaVersion()
    db2.close()
    expect(v2).toBe(v1)
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

describe('archiveStaleSessionsExcept', () => {
  it('archives sessions not in keepIds set (messages preserved, FTS still works)', () => {
    db.indexSession({
      sessionId: 'keep-me', projectId: 'proj-1', projectDisplayName: '/test',
      title: null, messageCount: 1, filePath: '/tmp/a.jsonl', fileSize: 0,
      fileMtime: '2024-01-01T00:00:00.000Z', startedAt: null, endedAt: null,
      messages: [msg({ type: 'user', role: 'user', contentText: 'Keep this', sequence: 0 })],
    })
    db.indexSession({
      sessionId: 'archive-me', projectId: 'proj-1', projectDisplayName: '/test',
      title: null, messageCount: 1, filePath: '/tmp/b.jsonl', fileSize: 0,
      fileMtime: '2024-01-01T00:00:00.000Z', startedAt: null, endedAt: null,
      messages: [msg({ type: 'user', role: 'user', contentText: 'Archive this content', sequence: 0 })],
    })

    db.archiveStaleSessionsExcept(new Set(['keep-me']))

    const sessions = db.getSessions('proj-1')
    expect(sessions).toHaveLength(2)

    const kept = sessions.find(s => s.id === 'keep-me')!
    expect(kept.archived).toBe(false)

    const archived = sessions.find(s => s.id === 'archive-me')!
    expect(archived.archived).toBe(true)

    // archived session 的 messages 仍存在
    const msgs = db.getMessages('archive-me')
    expect(msgs).toHaveLength(1)
    expect(msgs[0].contentText).toBe('Archive this content')

    // FTS 仍可搜尋到 archived session 的內容
    const page = db.search('Archive')
    expect(page.results.length).toBeGreaterThanOrEqual(1)
    expect(page.results.some(r => r.sessionId === 'archive-me')).toBe(true)
  })

  it('re-indexing an archived session un-archives it', () => {
    db.indexSession({
      sessionId: 'revive-me', projectId: 'proj-1', projectDisplayName: '/test',
      title: 'Original', messageCount: 1, filePath: '/tmp/c.jsonl', fileSize: 0,
      fileMtime: '2024-01-01T00:00:00.000Z', startedAt: null, endedAt: null,
      messages: [msg({ type: 'user', role: 'user', contentText: 'Will be archived', sequence: 0 })],
    })

    db.archiveStaleSessionsExcept(new Set([]))
    let sessions = db.getSessions('proj-1')
    expect(sessions[0].archived).toBe(true)

    // re-index → un-archive
    db.indexSession({
      sessionId: 'revive-me', projectId: 'proj-1', projectDisplayName: '/test',
      title: 'Revived', messageCount: 1, filePath: '/tmp/c.jsonl', fileSize: 100,
      fileMtime: '2024-01-02T00:00:00.000Z', startedAt: null, endedAt: null,
      messages: [msg({ type: 'user', role: 'user', contentText: 'Back alive', sequence: 0 })],
    })

    sessions = db.getSessions('proj-1')
    expect(sessions[0].archived).toBe(false)
    expect(sessions[0].title).toBe('Revived')
  })
})

describe('table split (message_content + message_archive)', () => {
  it('message_content and message_archive tables exist', () => {
    const tables = db.rawAll<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    )
    const names = tables.map(r => r.name)
    expect(names).toContain('message_content')
    expect(names).toContain('message_archive')
  })

  it('indexSession stores content_json in message_content, raw_json in message_archive', () => {
    db.indexSession({
      sessionId: 'split-001', projectId: 'proj-split', projectDisplayName: '/test/split',
      title: 'Split test', messageCount: 1, filePath: '/tmp/split.jsonl', fileSize: 100,
      fileMtime: '2024-06-01T00:00:00.000Z', startedAt: '2024-06-01T00:00:00.000Z', endedAt: '2024-06-01T00:00:00.000Z',
      messages: [msg({
        type: 'user', role: 'user', contentText: 'split test',
        contentJson: '["test content json"]', rawJson: '{"raw":"json line"}',
        sequence: 0,
      })],
    })

    // messages 表不應有 content_json 和 raw_json 欄位
    const msgCols = db.rawAll<{ name: string }>(
      "PRAGMA table_info(messages)",
    ).map(r => r.name)
    expect(msgCols).not.toContain('content_json')
    expect(msgCols).not.toContain('raw_json')

    // message_content 應有資料
    const content = db.rawAll<{ content_json: string }>(
      "SELECT content_json FROM message_content",
    )
    expect(content).toHaveLength(1)
    expect(content[0].content_json).toBe('["test content json"]')

    // message_archive 應有資料
    const archive = db.rawAll<{ raw_json: string }>(
      "SELECT raw_json FROM message_archive",
    )
    expect(archive).toHaveLength(1)
    expect(archive[0].raw_json).toBe('{"raw":"json line"}')
  })

  it('getMessages returns contentJson via JOIN', () => {
    db.indexSession({
      sessionId: 'join-001', projectId: 'proj-join', projectDisplayName: '/test/join',
      title: 'Join test', messageCount: 1, filePath: '/tmp/join.jsonl', fileSize: 100,
      fileMtime: '2024-06-01T00:00:00.000Z', startedAt: null, endedAt: null,
      messages: [msg({
        type: 'assistant', role: 'assistant', contentText: 'hello',
        contentJson: '{"blocks":[]}', sequence: 0,
      })],
    })

    const msgs = db.getMessages('join-001')
    expect(msgs).toHaveLength(1)
    expect(msgs[0].contentJson).toBe('{"blocks":[]}')
  })

  it('re-index cascades delete to message_content and message_archive', () => {
    db.indexSession({
      sessionId: 'cascade-001', projectId: 'proj-cas', projectDisplayName: '/test/cas',
      title: 'Cascade', messageCount: 1, filePath: '/tmp/cas.jsonl', fileSize: 100,
      fileMtime: '2024-06-01T00:00:00.000Z', startedAt: null, endedAt: null,
      messages: [msg({
        type: 'user', role: 'user', contentText: 'old',
        contentJson: '"old"', rawJson: '{"old":true}', sequence: 0,
      })],
    })

    // re-index with new data
    db.indexSession({
      sessionId: 'cascade-001', projectId: 'proj-cas', projectDisplayName: '/test/cas',
      title: 'Cascade Updated', messageCount: 1, filePath: '/tmp/cas.jsonl', fileSize: 200,
      fileMtime: '2024-06-02T00:00:00.000Z', startedAt: null, endedAt: null,
      messages: [msg({
        type: 'user', role: 'user', contentText: 'new',
        contentJson: '"new"', rawJson: '{"new":true}', sequence: 0,
      })],
    })

    const content = db.rawAll<{ content_json: string }>(
      "SELECT content_json FROM message_content mc JOIN messages m ON m.id = mc.message_id WHERE m.session_id = 'cascade-001'",
    )
    expect(content).toHaveLength(1)
    expect(content[0].content_json).toBe('"new"')

    const archive = db.rawAll<{ raw_json: string }>(
      "SELECT raw_json FROM message_archive ma JOIN messages m ON m.id = ma.message_id WHERE m.session_id = 'cascade-001'",
    )
    expect(archive).toHaveLength(1)
    expect(archive[0].raw_json).toBe('{"new":true}')
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
    const page = db.search('deploy')
    expect(page.results.length).toBeGreaterThanOrEqual(2)
    for (const r of page.results) {
      expect(r.snippet.toLowerCase()).toContain('deploy')
    }
  })

  it('search with projectId filter → only returns from that project', () => {
    const page = db.search('deploy', 'proj-1')
    expect(page.results.length).toBeGreaterThanOrEqual(1)
    for (const r of page.results) {
      expect(r.projectId).toBe('proj-1')
    }
  })

  it('search no match → returns empty page', () => {
    const page = db.search('nonexistentkeyword12345')
    expect(page.results).toEqual([])
    expect(page.hasMore).toBe(false)
  })

  it('malformed FTS query → returns empty page, no throw', () => {
    expect(() => db.search('"unclosed quote')).not.toThrow()
    const page = db.search('"unclosed quote')
    expect(page.results).toEqual([])
    expect(page.hasMore).toBe(false)
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

    const page = db.search('deploy')
    for (const r of page.results) {
      expect(r.sessionId).not.toBe('sess-001')
    }
  })

  it('pagination: offset + limit + hasMore', () => {
    // 已有 3 筆含 "deploy" 的 messages（2 from sess-001, 1 from sess-002）
    const page1 = db.search('deploy', null, 0, 2)
    expect(page1.results).toHaveLength(2)
    expect(page1.offset).toBe(0)
    expect(page1.hasMore).toBe(true)

    const page2 = db.search('deploy', null, 2, 2)
    expect(page2.results.length).toBeGreaterThanOrEqual(1)
    expect(page2.offset).toBe(2)
    expect(page2.hasMore).toBe(false)
  })
})
