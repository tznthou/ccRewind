import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { scanSubagents } from '../src/main/scanner'
import { Database } from '../src/main/database'
import { runIndexer } from '../src/main/indexer'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ccrewind-subagent-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

/** 建立模擬 JSONL 內容 */
function makeJsonl(lines: object[]): string {
  return lines.map(l => JSON.stringify(l)).join('\n')
}

describe('scanSubagents', () => {
  it('returns empty array when subagents/ does not exist', async () => {
    const sessionDir = path.join(tmpDir, 'session-001')
    await mkdir(sessionDir, { recursive: true })

    const result = await scanSubagents(sessionDir, 'session-001')
    expect(result).toEqual([])
  })

  it('scans *.jsonl files in subagents/ directory', async () => {
    const sessionDir = path.join(tmpDir, 'session-001')
    const subDir = path.join(sessionDir, 'subagents')
    await mkdir(subDir, { recursive: true })

    await writeFile(path.join(subDir, 'agent-aRead-abc123.jsonl'), '{"type":"user"}\n')
    await writeFile(path.join(subDir, 'agent-aWrite-def456.jsonl'), '{"type":"user"}\n')

    const result = await scanSubagents(sessionDir, 'session-001')
    expect(result).toHaveLength(2)

    const ids = result.map(r => r.subagentId).sort()
    expect(ids).toEqual(['session-001/agent-aRead-abc123', 'session-001/agent-aWrite-def456'])

    // 每個結果都有正確的 parentSessionId
    for (const r of result) {
      expect(r.parentSessionId).toBe('session-001')
      expect(r.fileSize).toBeGreaterThan(0)
      expect(r.fileMtime).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(r.filePath).toContain('subagents')
    }
  })

  it('reads agentType from *.meta.json when available', async () => {
    const sessionDir = path.join(tmpDir, 'session-001')
    const subDir = path.join(sessionDir, 'subagents')
    await mkdir(subDir, { recursive: true })

    await writeFile(path.join(subDir, 'agent-aRead-abc123.jsonl'), '{"type":"user"}\n')
    await writeFile(
      path.join(subDir, 'agent-aRead-abc123.meta.json'),
      JSON.stringify({ agentType: 'code-reader' }),
    )

    const result = await scanSubagents(sessionDir, 'session-001')
    expect(result).toHaveLength(1)
    expect(result[0].agentType).toBe('code-reader')
  })

  it('agentType is null when meta.json does not exist', async () => {
    const sessionDir = path.join(tmpDir, 'session-001')
    const subDir = path.join(sessionDir, 'subagents')
    await mkdir(subDir, { recursive: true })

    await writeFile(path.join(subDir, 'agent-aRead-abc123.jsonl'), '{"type":"user"}\n')

    const result = await scanSubagents(sessionDir, 'session-001')
    expect(result).toHaveLength(1)
    expect(result[0].agentType).toBeNull()
  })

  it('ignores non-jsonl files in subagents/', async () => {
    const sessionDir = path.join(tmpDir, 'session-001')
    const subDir = path.join(sessionDir, 'subagents')
    await mkdir(subDir, { recursive: true })

    await writeFile(path.join(subDir, 'agent-aRead-abc123.jsonl'), '{"type":"user"}\n')
    await writeFile(path.join(subDir, 'agent-aRead-abc123.meta.json'), '{}')
    await writeFile(path.join(subDir, 'notes.txt'), 'not a session')

    const result = await scanSubagents(sessionDir, 'session-001')
    expect(result).toHaveLength(1)
  })

  it('handles malformed meta.json gracefully', async () => {
    const sessionDir = path.join(tmpDir, 'session-001')
    const subDir = path.join(sessionDir, 'subagents')
    await mkdir(subDir, { recursive: true })

    await writeFile(path.join(subDir, 'agent-aRead-abc123.jsonl'), '{"type":"user"}\n')
    await writeFile(path.join(subDir, 'agent-aRead-abc123.meta.json'), 'not json!!!')

    const result = await scanSubagents(sessionDir, 'session-001')
    expect(result).toHaveLength(1)
    expect(result[0].agentType).toBeNull()
  })
})

describe('subagent DB integration', () => {
  let db: Database
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(tmpDir, 'test.db')
    db = new Database(dbPath)
  })

  afterEach(() => {
    db.close()
  })

  it('migration v12 creates subagent_sessions table', () => {
    const version = db.getSchemaVersion()
    expect(version).toBeGreaterThanOrEqual(12)

    // 驗證表存在
    const tables = db.rawAll<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='subagent_sessions'",
    )
    expect(tables).toHaveLength(1)
  })

  it('indexSubagentSession + getSubagentSessions round-trip', () => {
    // 先建立 parent session 需要的 project
    db.upsertProject('-test-proj', '/test/proj')
    db.indexSession({
      sessionId: 'parent-001',
      projectId: '-test-proj',
      projectDisplayName: '/test/proj',
      title: 'Parent session',
      messageCount: 1,
      filePath: '/tmp/parent.jsonl',
      fileSize: 100,
      fileMtime: '2024-06-01T00:00:00.000Z',
      startedAt: '2024-06-01T00:00:00.000Z',
      endedAt: '2024-06-01T00:01:00.000Z',
      messages: [{
        type: 'user', uuid: null, role: 'user', contentText: 'hello',
        contentJson: null, hasToolUse: false, hasToolResult: false,
        toolNames: [], timestamp: '2024-06-01T00:00:00.000Z', sequence: 0,
        rawJson: null, inputTokens: null, outputTokens: null,
        cacheReadTokens: null, cacheCreationTokens: null, model: null,
      }],
    })

    // 寫入 subagent session
    db.indexSubagentSession({
      id: 'sub-001',
      parentSessionId: 'parent-001',
      agentType: 'code-reader',
      filePath: '/tmp/sub.jsonl',
      fileSize: 50,
      fileMtime: '2024-06-01T00:00:30.000Z',
      messageCount: 3,
      startedAt: '2024-06-01T00:00:10.000Z',
      endedAt: '2024-06-01T00:00:30.000Z',
    })

    // 讀取
    const subs = db.getSubagentSessions('parent-001')
    expect(subs).toHaveLength(1)
    expect(subs[0].id).toBe('sub-001')
    expect(subs[0].parentSessionId).toBe('parent-001')
    expect(subs[0].agentType).toBe('code-reader')
    expect(subs[0].messageCount).toBe(3)
    expect(subs[0].startedAt).toBe('2024-06-01T00:00:10.000Z')
    expect(subs[0].endedAt).toBe('2024-06-01T00:00:30.000Z')
  })

  it('deleteSubagentSessions removes all subagents for a parent', () => {
    db.upsertProject('-test-proj', '/test/proj')
    db.indexSession({
      sessionId: 'parent-002',
      projectId: '-test-proj',
      projectDisplayName: '/test/proj',
      title: 'Parent',
      messageCount: 0,
      filePath: '/tmp/parent.jsonl',
      fileSize: 100,
      fileMtime: '2024-06-01T00:00:00.000Z',
      startedAt: null,
      endedAt: null,
      messages: [],
    })

    db.indexSubagentSession({
      id: 'sub-a',
      parentSessionId: 'parent-002',
      agentType: null,
      filePath: '/tmp/a.jsonl',
      fileSize: 10,
      fileMtime: '2024-06-01T00:00:00.000Z',
      messageCount: 1,
      startedAt: null,
      endedAt: null,
    })
    db.indexSubagentSession({
      id: 'sub-b',
      parentSessionId: 'parent-002',
      agentType: null,
      filePath: '/tmp/b.jsonl',
      fileSize: 10,
      fileMtime: '2024-06-01T00:00:00.000Z',
      messageCount: 2,
      startedAt: null,
      endedAt: null,
    })

    expect(db.getSubagentSessions('parent-002')).toHaveLength(2)
    db.deleteSubagentSessions('parent-002')
    expect(db.getSubagentSessions('parent-002')).toHaveLength(0)
  })
})

describe('subagent indexer integration', () => {
  let db: Database
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(tmpDir, 'test.db')
    db = new Database(dbPath)
  })

  afterEach(() => {
    db.close()
  })

  it('runIndexer indexes subagent files alongside main sessions', async () => {
    const baseDir = path.join(tmpDir, 'projects')
    const projDir = path.join(baseDir, '-Users-test-proj')
    await mkdir(projDir, { recursive: true })

    // 建立 main session jsonl
    await writeFile(
      path.join(projDir, 'sess-001.jsonl'),
      makeJsonl([
        {
          type: 'user',
          uuid: 'u1',
          timestamp: '2024-06-01T10:00:00.000Z',
          sessionId: 'sess-001',
          message: { role: 'user', content: 'Help me refactor' },
        },
        {
          type: 'assistant',
          uuid: 'a1',
          parentUuid: 'u1',
          timestamp: '2024-06-01T10:00:05.000Z',
          sessionId: 'sess-001',
          message: { role: 'assistant', content: 'Sure, let me check.' },
        },
      ]),
    )

    // 建立 subagent 目錄結構：sess-001/subagents/
    const subDir = path.join(projDir, 'sess-001', 'subagents')
    await mkdir(subDir, { recursive: true })

    await writeFile(
      path.join(subDir, 'agent-aRead-abc123.jsonl'),
      makeJsonl([
        {
          type: 'user',
          uuid: 'su1',
          timestamp: '2024-06-01T10:00:02.000Z',
          message: { role: 'user', content: 'Read the config file' },
        },
        {
          type: 'assistant',
          uuid: 'sa1',
          parentUuid: 'su1',
          timestamp: '2024-06-01T10:00:03.000Z',
          message: { role: 'assistant', content: 'Here is the config content.' },
        },
      ]),
    )

    // 加 meta.json
    await writeFile(
      path.join(subDir, 'agent-aRead-abc123.meta.json'),
      JSON.stringify({ agentType: 'file-reader' }),
    )

    await runIndexer(db, undefined, baseDir)

    // 驗證 main session 被索引
    const sessions = db.getSessions('-Users-test-proj')
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('sess-001')

    // 驗證 subagent session 被索引
    const subs = db.getSubagentSessions('sess-001')
    expect(subs).toHaveLength(1)
    expect(subs[0].id).toBe('sess-001/agent-aRead-abc123')
    expect(subs[0].agentType).toBe('file-reader')
    expect(subs[0].messageCount).toBe(2)

    // 驗證 subagent messages 被寫入 messages 表
    const subMsgs = db.getMessages('sess-001/agent-aRead-abc123')
    expect(subMsgs).toHaveLength(2)
    expect(subMsgs[0].contentText).toBe('Read the config file')
    expect(subMsgs[1].contentText).toBe('Here is the config content.')
  })

  it('incremental indexer skips unchanged subagents', async () => {
    const baseDir = path.join(tmpDir, 'projects')
    const projDir = path.join(baseDir, '-Users-test-proj')
    const subDir = path.join(projDir, 'sess-001', 'subagents')
    await mkdir(subDir, { recursive: true })

    await writeFile(
      path.join(projDir, 'sess-001.jsonl'),
      makeJsonl([{
        type: 'user', uuid: 'u1', timestamp: '2024-06-01T10:00:00.000Z',
        sessionId: 'sess-001', message: { role: 'user', content: 'Hello' },
      }]),
    )

    await writeFile(
      path.join(subDir, 'agent-a1-aaa.jsonl'),
      makeJsonl([{
        type: 'user', uuid: 'su1', timestamp: '2024-06-01T10:00:01.000Z',
        message: { role: 'user', content: 'Sub task 1' },
      }]),
    )

    // 第一次索引
    await runIndexer(db, undefined, baseDir)
    expect(db.getSubagentSessions('sess-001')).toHaveLength(1)

    // 第二次索引（未修改）不應出錯
    await runIndexer(db, undefined, baseDir)
    expect(db.getSubagentSessions('sess-001')).toHaveLength(1)
  })
})
