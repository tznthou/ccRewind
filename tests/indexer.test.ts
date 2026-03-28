import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { Database } from '../src/main/database'
import { runIndexer, type ProgressCallback } from '../src/main/indexer'
import type { IndexerStatus } from '../src/shared/types'

let tmpDir: string
let dbPath: string
let db: Database

/** 建立模擬 JSONL 內容 */
function makeJsonl(lines: object[]): string {
  return lines.map(l => JSON.stringify(l)).join('\n')
}

/** 建立模擬的 ~/.claude/projects/ 結構 */
async function createProject(baseDir: string, projectId: string, sessions: Record<string, object[]>): Promise<void> {
  const projectDir = path.join(baseDir, projectId)
  await mkdir(projectDir, { recursive: true })
  for (const [sessionId, lines] of Object.entries(sessions)) {
    await writeFile(path.join(projectDir, `${sessionId}.jsonl`), makeJsonl(lines))
  }
}

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ccrewind-idx-'))
  dbPath = path.join(tmpDir, 'test.db')
  db = new Database(dbPath)
})

afterEach(async () => {
  db.close()
  await rm(tmpDir, { recursive: true, force: true })
})

const sampleSession1 = [
  {
    type: 'user',
    uuid: 'u1',
    timestamp: '2024-06-01T10:00:00.000Z',
    sessionId: 'sess-001',
    message: { role: 'user', content: 'Help me deploy the app' },
  },
  {
    type: 'assistant',
    uuid: 'a1',
    parentUuid: 'u1',
    timestamp: '2024-06-01T10:00:05.000Z',
    sessionId: 'sess-001',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Sure, let me check the config.' },
        { type: 'tool_use', id: 'toolu_001', name: 'Read', input: {} },
      ],
    },
  },
]

const sampleSession2 = [
  {
    type: 'queue-operation',
    operation: 'enqueue',
    timestamp: '2024-06-02T08:00:00.000Z',
    sessionId: 'sess-002',
    content: 'Fix the authentication bug',
  },
  {
    type: 'user',
    uuid: 'u2',
    timestamp: '2024-06-02T08:00:01.000Z',
    sessionId: 'sess-002',
    message: { role: 'user', content: 'The login page is broken' },
  },
  {
    type: 'assistant',
    uuid: 'a2',
    parentUuid: 'u2',
    timestamp: '2024-06-02T08:00:10.000Z',
    sessionId: 'sess-002',
    message: { role: 'assistant', content: 'I found the issue and fixed it.' },
  },
]

describe('runIndexer', () => {
  it('firstRun → indexes all sessions, reports progress to 100', async () => {
    const baseDir = path.join(tmpDir, 'projects')
    await createProject(baseDir, '-Users-test-proj1', { 'sess-001': sampleSession1 })
    await createProject(baseDir, '-Users-test-proj2', { 'sess-002': sampleSession2 })

    const statuses: IndexerStatus[] = []
    const onProgress: ProgressCallback = (s) => statuses.push({ ...s })

    await runIndexer(db, onProgress, baseDir)

    // 驗證 projects
    const projects = db.getProjects()
    expect(projects).toHaveLength(2)

    // 驗證 sessions
    const sessions1 = db.getSessions('-Users-test-proj1')
    expect(sessions1).toHaveLength(1)
    expect(sessions1[0].id).toBe('sess-001')

    const sessions2 = db.getSessions('-Users-test-proj2')
    expect(sessions2).toHaveLength(1)
    expect(sessions2[0].id).toBe('sess-002')
    // queue-operation 的 content 優先作為 title
    expect(sessions2[0].title).toBe('Fix the authentication bug')

    // 驗證 messages
    const msgs1 = db.getMessages('sess-001')
    expect(msgs1).toHaveLength(2)
    expect(msgs1[0].contentText).toBe('Help me deploy the app')
    expect(msgs1[1].hasToolUse).toBe(true)
    expect(msgs1[1].toolNames).toEqual(['Read'])

    const msgs2 = db.getMessages('sess-002')
    expect(msgs2).toHaveLength(3)

    // 驗證 project stats
    const proj1 = projects.find(p => p.id === '-Users-test-proj1')!
    expect(proj1.sessionCount).toBe(1)

    // 驗證 progress：最後一個應為 done + 100
    const last = statuses[statuses.length - 1]
    expect(last.phase).toBe('done')
    expect(last.progress).toBe(100)

    // 驗證 FTS 可搜尋
    const searchResults = db.search('deploy')
    expect(searchResults.length).toBeGreaterThanOrEqual(1)
    expect(searchResults[0].sessionId).toBe('sess-001')
  })

  it('incrementalRun → only processes new/modified files', async () => {
    const baseDir = path.join(tmpDir, 'projects')
    await createProject(baseDir, '-Users-test-proj1', { 'sess-001': sampleSession1 })

    // 第一次索引
    await runIndexer(db, undefined, baseDir)
    expect(db.getMessages('sess-001')).toHaveLength(2)

    // 新增一個 session
    await writeFile(
      path.join(baseDir, '-Users-test-proj1', 'sess-003.jsonl'),
      makeJsonl([{
        type: 'user', uuid: 'u3', timestamp: '2024-07-01T00:00:00.000Z',
        sessionId: 'sess-003', message: { role: 'user', content: 'New session' },
      }]),
    )

    // 第二次索引，追蹤 progress
    const statuses: IndexerStatus[] = []
    await runIndexer(db, (s) => statuses.push({ ...s }), baseDir)

    // 新 session 應被索引
    expect(db.getMessages('sess-003')).toHaveLength(1)
    expect(db.getMessages('sess-003')[0].contentText).toBe('New session')

    // 舊 session 仍然存在
    expect(db.getMessages('sess-001')).toHaveLength(2)

    // total 應只包含新增/修改的 session（不含未變動的）
    const indexingStatuses = statuses.filter(s => s.phase === 'indexing')
    if (indexingStatuses.length > 0) {
      expect(indexingStatuses[0].total).toBe(1) // 只有 sess-003 需處理
    }
  })

  it('emptyProject → project exists with sessionCount=0, no error', async () => {
    const baseDir = path.join(tmpDir, 'projects')
    // 只建目錄，不放 JSONL
    await mkdir(path.join(baseDir, '-Users-test-empty'), { recursive: true })

    await runIndexer(db, undefined, baseDir)

    const projects = db.getProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0].id).toBe('-Users-test-empty')
    expect(projects[0].sessionCount).toBe(0)
  })

  it('progressCallback → emits scanning → indexing → done in order', async () => {
    const baseDir = path.join(tmpDir, 'projects')
    await createProject(baseDir, '-Users-test-proj1', { 'sess-001': sampleSession1 })

    const phases: string[] = []
    await runIndexer(db, (s) => phases.push(s.phase), baseDir)

    // scanning 出現在 indexing 之前
    const scanIdx = phases.indexOf('scanning')
    const idxIdx = phases.indexOf('indexing')
    const doneIdx = phases.indexOf('done')

    expect(scanIdx).toBeGreaterThanOrEqual(0)
    expect(doneIdx).toBeGreaterThanOrEqual(0)
    // scanning 在 done 之前
    expect(scanIdx).toBeLessThan(doneIdx)
    // 如果有 indexing，也在 done 之前
    if (idxIdx >= 0) {
      expect(idxIdx).toBeLessThan(doneIdx)
      expect(scanIdx).toBeLessThan(idxIdx)
    }
  })

  it('nonexistent baseDir → no error, no projects', async () => {
    const fakeDir = path.join(tmpDir, 'does-not-exist')
    await runIndexer(db, undefined, fakeDir)

    expect(db.getProjects()).toEqual([])
  })
})
