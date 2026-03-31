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
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheCreationTokens: null,
    model: null,
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

describe('session summary columns (migration v5)', () => {
  it('summary columns exist after migration', () => {
    const cols = db.rawAll<{ name: string }>('PRAGMA table_info(sessions)').map(r => r.name)
    expect(cols).toContain('summary_text')
    expect(cols).toContain('tags')
    expect(cols).toContain('files_touched')
    expect(cols).toContain('tools_used')
  })

  it('indexSession with summary fields → getSessions returns them', () => {
    db.indexSession({
      sessionId: 'sum-001', projectId: 'proj-sum', projectDisplayName: '/test/sum',
      title: 'Summary test', messageCount: 0, filePath: '/tmp/sum.jsonl', fileSize: 0,
      fileMtime: '2024-01-01T00:00:00.000Z', startedAt: null, endedAt: null,
      summaryText: 'Intent: fix bug',
      tags: 'bug-fix,auth',
      filesTouched: '/src/a.ts,/src/b.ts',
      toolsUsed: 'Read:5,Edit:3',
      messages: [],
    })

    const sessions = db.getSessions('proj-sum')
    expect(sessions).toHaveLength(1)
    expect(sessions[0].summaryText).toBe('Intent: fix bug')
    expect(sessions[0].tags).toBe('bug-fix,auth')
    expect(sessions[0].filesTouched).toBe('/src/a.ts,/src/b.ts')
    expect(sessions[0].toolsUsed).toBe('Read:5,Edit:3')
  })

  it('indexSession without summary fields → NULLs (backward compat)', () => {
    db.indexSession({
      sessionId: 'nosum-001', projectId: 'proj-nosum', projectDisplayName: '/test/nosum',
      title: 'No summary', messageCount: 0, filePath: '/tmp/nosum.jsonl', fileSize: 0,
      fileMtime: '2024-01-01T00:00:00.000Z', startedAt: null, endedAt: null,
      messages: [],
    })

    const sessions = db.getSessions('proj-nosum')
    expect(sessions).toHaveLength(1)
    expect(sessions[0].summaryText).toBeNull()
    expect(sessions[0].tags).toBeNull()
    expect(sessions[0].filesTouched).toBeNull()
    expect(sessions[0].toolsUsed).toBeNull()
  })

  it('re-index updates summary fields', () => {
    db.indexSession({
      sessionId: 'resum-001', projectId: 'proj-resum', projectDisplayName: '/test/resum',
      title: 'V1', messageCount: 0, filePath: '/tmp/resum.jsonl', fileSize: 0,
      fileMtime: '2024-01-01T00:00:00.000Z', startedAt: null, endedAt: null,
      summaryText: 'old summary', tags: 'old-tag',
      filesTouched: '/old.ts', toolsUsed: 'Read:1',
      messages: [],
    })

    db.indexSession({
      sessionId: 'resum-001', projectId: 'proj-resum', projectDisplayName: '/test/resum',
      title: 'V2', messageCount: 0, filePath: '/tmp/resum.jsonl', fileSize: 100,
      fileMtime: '2024-01-02T00:00:00.000Z', startedAt: null, endedAt: null,
      summaryText: 'new summary', tags: 'new-tag',
      filesTouched: '/new.ts', toolsUsed: 'Edit:2',
      messages: [],
    })

    const sessions = db.getSessions('proj-resum')
    expect(sessions).toHaveLength(1)
    expect(sessions[0].summaryText).toBe('new summary')
    expect(sessions[0].tags).toBe('new-tag')
  })
})

describe('getMessageContext', () => {
  beforeEach(() => {
    db.indexSession({
      sessionId: 'ctx-001', projectId: 'proj-ctx', projectDisplayName: '/test/ctx',
      title: 'Context test', messageCount: 5, filePath: '/tmp/ctx.jsonl', fileSize: 0,
      fileMtime: '2024-01-01T00:00:00.000Z', startedAt: null, endedAt: null,
      messages: [
        msg({ type: 'user', role: 'user', contentText: 'msg-0', sequence: 0 }),
        msg({ type: 'assistant', role: 'assistant', contentText: 'msg-1', sequence: 1 }),
        msg({ type: 'user', role: 'user', contentText: 'msg-2', sequence: 2 }),
        msg({ type: 'assistant', role: 'assistant', contentText: 'msg-3', sequence: 3 }),
        msg({ type: 'user', role: 'user', contentText: 'msg-4', sequence: 4 }),
      ],
    })
  })

  it('returns target + before + after messages', () => {
    const allMsgs = db.getMessages('ctx-001')
    const targetId = allMsgs[2].id // msg-2, sequence 2

    const ctx = db.getMessageContext(targetId, 2)
    expect(ctx.target).not.toBeNull()
    expect(ctx.target!.contentText).toBe('msg-2')
    expect(ctx.before).toHaveLength(2)
    expect(ctx.before[0].contentText).toBe('msg-0')
    expect(ctx.before[1].contentText).toBe('msg-1')
    expect(ctx.after).toHaveLength(2)
    expect(ctx.after[0].contentText).toBe('msg-3')
    expect(ctx.after[1].contentText).toBe('msg-4')
  })

  it('clamps at session boundaries', () => {
    const allMsgs = db.getMessages('ctx-001')
    const firstId = allMsgs[0].id
    const ctx = db.getMessageContext(firstId, 2)
    expect(ctx.target).not.toBeNull()
    expect(ctx.target!.contentText).toBe('msg-0')
    expect(ctx.before).toHaveLength(0)
    expect(ctx.after).toHaveLength(2)
  })

  it('nonexistent messageId → null target', () => {
    const ctx = db.getMessageContext(99999, 2)
    expect(ctx.target).toBeNull()
    expect(ctx.before).toHaveLength(0)
    expect(ctx.after).toHaveLength(0)
  })
})

describe('sessions_fts (migration v6)', () => {
  it('sessions_fts table exists', () => {
    const tables = db.rawAll<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).map(r => r.name)
    expect(tables).toContain('sessions_fts')
  })

  it('searchSessions matches by tags', () => {
    db.indexSession({
      sessionId: 'sfts-001', projectId: 'proj-sfts', projectDisplayName: '/test/sfts',
      title: 'Auth fix session', messageCount: 0, filePath: '/tmp/sfts.jsonl', fileSize: 0,
      fileMtime: '2024-01-01T00:00:00.000Z', startedAt: null, endedAt: null,
      tags: 'bug-fix,auth', summaryText: 'Fixed login error', filesTouched: '/src/auth.ts',
      messages: [],
    })

    const page = db.searchSessions('auth')
    expect(page.results.length).toBeGreaterThanOrEqual(1)
    expect(page.results[0].sessionId).toBe('sfts-001')
    expect(page.results[0].tags).toBe('bug-fix,auth')
  })

  it('searchSessions matches by file path', () => {
    db.indexSession({
      sessionId: 'sfts-002', projectId: 'proj-sfts', projectDisplayName: '/test/sfts',
      title: 'Refactor', messageCount: 0, filePath: '/tmp/sfts2.jsonl', fileSize: 0,
      fileMtime: '2024-01-01T00:00:00.000Z', startedAt: null, endedAt: null,
      tags: 'refactor', filesTouched: '/src/components/Sidebar.tsx',
      messages: [],
    })

    const page = db.searchSessions('Sidebar')
    expect(page.results.length).toBeGreaterThanOrEqual(1)
    expect(page.results[0].sessionId).toBe('sfts-002')
  })

  it('searchSessions matches by title', () => {
    db.indexSession({
      sessionId: 'sfts-003', projectId: 'proj-sfts', projectDisplayName: '/test/sfts',
      title: 'Deploy pipeline setup', messageCount: 0, filePath: '/tmp/sfts3.jsonl', fileSize: 0,
      fileMtime: '2024-01-01T00:00:00.000Z', startedAt: null, endedAt: null,
      messages: [],
    })

    const page = db.searchSessions('pipeline')
    expect(page.results.length).toBeGreaterThanOrEqual(1)
    expect(page.results[0].sessionTitle).toBe('Deploy pipeline setup')
  })

  it('searchSessions with projectId filter', () => {
    db.indexSession({
      sessionId: 'sfts-a', projectId: 'proj-a', projectDisplayName: '/a',
      title: 'Alpha unique', messageCount: 0, filePath: '/tmp/a.jsonl', fileSize: 0,
      fileMtime: '2024-01-01T00:00:00.000Z', startedAt: null, endedAt: null,
      messages: [],
    })
    db.indexSession({
      sessionId: 'sfts-b', projectId: 'proj-b', projectDisplayName: '/b',
      title: 'Beta unique', messageCount: 0, filePath: '/tmp/b.jsonl', fileSize: 0,
      fileMtime: '2024-01-01T00:00:00.000Z', startedAt: null, endedAt: null,
      messages: [],
    })

    const page = db.searchSessions('unique', 'proj-a')
    expect(page.results).toHaveLength(1)
    expect(page.results[0].sessionId).toBe('sfts-a')
  })

  it('searchSessions handles hyphenated tags like bug-fix', () => {
    db.indexSession({
      sessionId: 'sfts-hyp', projectId: 'proj-sfts', projectDisplayName: '/test/sfts',
      title: 'Hyphen test', messageCount: 0, filePath: '/tmp/hyp.jsonl', fileSize: 0,
      fileMtime: '2024-01-01T00:00:00.000Z', startedAt: null, endedAt: null,
      tags: 'bug-fix,auth',
      messages: [],
    })

    const page = db.searchSessions('bug-fix')
    expect(page.results.length).toBeGreaterThanOrEqual(1)
    expect(page.results[0].tags).toContain('bug-fix')
  })

  it('searchSessions handles file paths with / and .', () => {
    db.indexSession({
      sessionId: 'sfts-path', projectId: 'proj-sfts', projectDisplayName: '/test/sfts',
      title: 'Path test', messageCount: 0, filePath: '/tmp/path.jsonl', fileSize: 0,
      fileMtime: '2024-01-01T00:00:00.000Z', startedAt: null, endedAt: null,
      filesTouched: '/src/components/auth.ts',
      messages: [],
    })

    // 含 / 的搜尋不應 throw，應自動包引號
    const page = db.searchSessions('/src/components/auth.ts')
    expect(page.results.length).toBeGreaterThanOrEqual(1)
  })

  it('re-index updates sessions_fts', () => {
    db.indexSession({
      sessionId: 'sfts-upd', projectId: 'proj-upd', projectDisplayName: '/upd',
      title: 'Old title', messageCount: 0, filePath: '/tmp/upd.jsonl', fileSize: 0,
      fileMtime: '2024-01-01T00:00:00.000Z', startedAt: null, endedAt: null,
      tags: 'old-tag', messages: [],
    })

    // old title searchable
    expect(db.searchSessions('Old').results.length).toBeGreaterThanOrEqual(1)

    // re-index
    db.indexSession({
      sessionId: 'sfts-upd', projectId: 'proj-upd', projectDisplayName: '/upd',
      title: 'New title', messageCount: 0, filePath: '/tmp/upd.jsonl', fileSize: 100,
      fileMtime: '2024-01-02T00:00:00.000Z', startedAt: null, endedAt: null,
      tags: 'new-tag', messages: [],
    })

    // new title searchable
    const page = db.searchSessions('New')
    expect(page.results.length).toBeGreaterThanOrEqual(1)
    expect(page.results[0].sessionTitle).toBe('New title')

    // old title no longer matches this session
    const oldPage = db.searchSessions('Old')
    const oldMatch = oldPage.results.find(r => r.sessionId === 'sfts-upd')
    expect(oldMatch).toBeUndefined()
  })
})
