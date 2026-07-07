import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { Database } from '../src/main/database'
import { runIndexer, deduplicateTokensByRequestId, readFirstTimestamp, matchesExclusionRule, markAbandonedBranches, resolveNearestVersions, type ProgressCallback } from '../src/main/indexer'
import type { ExclusionRule, IndexerStatus, ParsedLine } from '../src/shared/types'

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
    const page = db.search('deploy')
    expect(page.results.length).toBeGreaterThanOrEqual(1)
    expect(page.results[0].sessionId).toBe('sess-001')
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

  it('indexer populates session summary fields', async () => {
    const sessionWithTools = [
      {
        type: 'user', uuid: 'u1', timestamp: '2024-06-01T10:00:00.000Z',
        sessionId: 'sum-001',
        message: { role: 'user', content: 'fix the login error' },
      },
      {
        type: 'assistant', uuid: 'a1', parentUuid: 'u1',
        timestamp: '2024-06-01T10:00:05.000Z', sessionId: 'sum-001',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me check.' },
            { type: 'tool_use', id: 'toolu_01', name: 'Read', input: { file_path: '/src/auth.ts' } },
          ],
        },
      },
      {
        type: 'assistant', uuid: 'a2', parentUuid: 'u1',
        timestamp: '2024-06-01T10:00:10.000Z', sessionId: 'sum-001',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_02', name: 'Edit', input: { file_path: '/src/auth.ts' } },
          ],
        },
      },
      {
        type: 'user', uuid: 'u2', timestamp: '2024-06-01T10:01:00.000Z',
        sessionId: 'sum-001',
        message: { role: 'user', content: 'looks good, thanks' },
      },
    ]

    const baseDir = path.join(tmpDir, 'projects')
    await createProject(baseDir, '-Users-test-sum', { 'sum-001': sessionWithTools })
    await runIndexer(db, undefined, baseDir)

    const sessions = db.getSessions('-Users-test-sum')
    expect(sessions).toHaveLength(1)
    const s = sessions[0]

    // summaryText 包含 intent（Phase 3: 結構化摘要，不再包含最後 user message 原文）
    expect(s.summaryText).toContain('fix the login error')
    // intentText 應獨立存在
    expect(s.intentText).toContain('fix the login error')

    // tags 應包含 bug-fix（含 fix + error）
    expect(s.tags).toContain('bug-fix')

    // filesTouched 應包含 /src/auth.ts（去重）
    expect(s.filesTouched).toBe('/src/auth.ts')

    // toolsUsed 應有 Read 和 Edit
    expect(s.toolsUsed).toContain('Read:')
    expect(s.toolsUsed).toContain('Edit:')
  })
})

describe('runIndexer — Task 12 fields end-to-end (parentUuid/isCompactSummary/isSidechain/isAbandonedBranch/version)', () => {
  it('propagates parentUuid, marks abandoned fork branch, stores flags, backfills message_archive version', async () => {
    const baseDir = path.join(tmpDir, 'projects')
    const forkSession = [
      {
        type: 'user', uuid: 'root', timestamp: '2026-07-07T10:00:00.000Z', sessionId: 'sess-fork', version: '2.1.196',
        message: { role: 'user', content: 'first message' },
      },
      {
        type: 'assistant', uuid: 'a-root', parentUuid: 'root', timestamp: '2026-07-07T10:00:01.000Z', sessionId: 'sess-fork', version: '2.1.196',
        message: { role: 'assistant', content: 'ok, proceeding' },
      },
      // unknown type（不在 KNOWN_MESSAGE_TYPES）本身沒有 version 欄位，靠鄰近 entry 回填
      { type: 'mode', sessionId: 'sess-fork', timestamp: '2026-07-07T10:00:02.000Z' },
      {
        type: 'user', uuid: 'dead-end', parentUuid: 'a-root', timestamp: '2026-07-07T10:00:03.000Z', sessionId: 'sess-fork', version: '2.1.196',
        message: { role: 'user', content: '補上' },
      },
      {
        type: 'user', uuid: 'continues', parentUuid: 'a-root', timestamp: '2026-07-07T10:00:04.000Z', sessionId: 'sess-fork', version: '2.1.201',
        message: { role: 'user', content: '先不補，但我們有辦法修復這個問題嗎？' },
      },
      {
        type: 'user', uuid: 'compact-1', parentUuid: 'continues', isCompactSummary: true, timestamp: '2026-07-07T10:00:05.000Z', sessionId: 'sess-fork', version: '2.1.201',
        message: { role: 'user', content: 'compact summary text' },
      },
    ]
    await createProject(baseDir, '-Users-test-fork', { 'sess-fork': forkSession })

    await runIndexer(db, undefined, baseDir)

    // Message（renderer 讀取型別）不外露 uuid，改用 contentText 定位（見 shared/types.ts）
    const messages = db.getMessages('sess-fork')
    const byContent = new Map(messages.filter(m => m.contentText).map(m => [m.contentText, m]))

    expect(byContent.get('ok, proceeding')?.parentUuid).toBe('root')
    expect(byContent.get('補上')?.isAbandonedBranch).toBe(true)
    expect(byContent.get('先不補，但我們有辦法修復這個問題嗎？')?.isAbandonedBranch).toBe(false)
    expect(byContent.get('compact summary text')?.isCompactSummary).toBe(true)

    // unknown-type 'mode' entry：raw_json 存進 message_archive，version 用鄰近值（前一筆 a-root）回填
    const archived = db.rawAll<{ version: string | null }>(
      "SELECT ma.version AS version FROM message_archive ma JOIN messages m ON m.id = ma.message_id WHERE m.session_id = 'sess-fork' AND m.type = 'mode'",
    )
    expect(archived).toHaveLength(1)
    expect(archived[0].version).toBe('2.1.196')
  })

  it('isSidechain flows through from subagent transcript', async () => {
    const baseDir = path.join(tmpDir, 'projects')
    await createProject(baseDir, '-Users-test-side', { 'sess-side': sampleSession1 })
    // subagent transcript：CC 對 sidechain 一律標 isSidechain: true
    const sessionDir = path.join(baseDir, '-Users-test-side', 'sess-side')
    await mkdir(path.join(sessionDir, 'subagents'), { recursive: true })
    await writeFile(
      path.join(sessionDir, 'subagents', 'agent-a1.jsonl'),
      makeJsonl([
        {
          type: 'user', uuid: 'sub-u1', isSidechain: true, timestamp: '2026-07-07T10:00:00.000Z', sessionId: 'agent-a1',
          message: { role: 'user', content: 'subagent task' },
        },
      ]),
    )

    await runIndexer(db, undefined, baseDir)

    // subagentId 由 indexer 組成 `${parentSessionId}/${bareId}`（見 scanner.ts scanSubagents）
    const subMessages = db.getMessages('sess-side/agent-a1')
    expect(subMessages).toHaveLength(1)
    expect(subMessages[0].isSidechain).toBe(true)
  })
})

// ── deduplicateTokensByRequestId ──

/** 建立最小 ParsedLine 供 dedup 測試 */
function makeParsedLine(overrides: Partial<ParsedLine> = {}): ParsedLine {
  return {
    type: 'assistant',
    uuid: null,
    parentUuid: null,
    sessionId: null,
    timestamp: null,
    role: 'assistant',
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
    requestId: null,
    version: null,
    isCompactSummary: false,
    isSidechain: false,
    ...overrides,
  }
}

describe('deduplicateTokensByRequestId', () => {
  it('entries without requestId pass through unchanged', () => {
    const lines = [
      makeParsedLine({ uuid: 'a1', inputTokens: 100, outputTokens: 50 }),
      makeParsedLine({ uuid: 'a2', inputTokens: 200, outputTokens: 80 }),
    ]
    const result = deduplicateTokensByRequestId(lines)
    expect(result).toHaveLength(2)
    expect(result[0].inputTokens).toBe(100)
    expect(result[1].inputTokens).toBe(200)
  })

  it('single entry per requestId passes through unchanged', () => {
    const lines = [
      makeParsedLine({ uuid: 'a1', requestId: 'req_001', inputTokens: 3000, outputTokens: 391 }),
      makeParsedLine({ uuid: 'a2', requestId: 'req_002', inputTokens: 5000, outputTokens: 200 }),
    ]
    const result = deduplicateTokensByRequestId(lines)
    expect(result[0].inputTokens).toBe(3000)
    expect(result[0].outputTokens).toBe(391)
    expect(result[1].inputTokens).toBe(5000)
    expect(result[1].outputTokens).toBe(200)
  })

  it('multi-entry requestId: only last entry retains tokens', () => {
    const lines = [
      makeParsedLine({ uuid: 'a1', requestId: 'req_001', inputTokens: 3000, outputTokens: 34, cacheReadTokens: 11000, cacheCreationTokens: 9000 }),
      makeParsedLine({ uuid: 'a2', requestId: 'req_001', inputTokens: 3000, outputTokens: 34, cacheReadTokens: 11000, cacheCreationTokens: 9000 }),
      makeParsedLine({ uuid: 'a3', requestId: 'req_001', inputTokens: 3000, outputTokens: 391, cacheReadTokens: 11000, cacheCreationTokens: 9000 }),
    ]
    const result = deduplicateTokensByRequestId(lines)
    expect(result).toHaveLength(3)
    // first two: tokens nulled
    expect(result[0].inputTokens).toBeNull()
    expect(result[0].outputTokens).toBeNull()
    expect(result[0].cacheReadTokens).toBeNull()
    expect(result[0].cacheCreationTokens).toBeNull()
    expect(result[1].inputTokens).toBeNull()
    expect(result[1].outputTokens).toBeNull()
    // last: tokens retained
    expect(result[2].inputTokens).toBe(3000)
    expect(result[2].outputTokens).toBe(391)
    expect(result[2].cacheReadTokens).toBe(11000)
    expect(result[2].cacheCreationTokens).toBe(9000)
  })

  it('interleaved user entries are not affected', () => {
    const userLine = makeParsedLine({ type: 'user', role: 'user', uuid: 'u1', requestId: null, inputTokens: null })
    const lines = [
      makeParsedLine({ uuid: 'a1', requestId: 'req_001', inputTokens: 3000, outputTokens: 8 }),
      userLine,
      makeParsedLine({ uuid: 'a2', requestId: 'req_001', inputTokens: 3000, outputTokens: 252 }),
    ]
    const result = deduplicateTokensByRequestId(lines)
    expect(result).toHaveLength(3)
    // first assistant: nulled
    expect(result[0].inputTokens).toBeNull()
    // user: unchanged
    expect(result[1]).toBe(userLine)
    // last assistant: retained
    expect(result[2].inputTokens).toBe(3000)
    expect(result[2].outputTokens).toBe(252)
  })

  it('mixed requestId groups each dedup independently', () => {
    const lines = [
      makeParsedLine({ uuid: 'a1', requestId: 'req_A', inputTokens: 1000, outputTokens: 10 }),
      makeParsedLine({ uuid: 'a2', requestId: 'req_A', inputTokens: 1000, outputTokens: 100 }),
      makeParsedLine({ uuid: 'a3', requestId: 'req_B', inputTokens: 5000, outputTokens: 20 }),
      makeParsedLine({ uuid: 'a4', requestId: 'req_B', inputTokens: 5000, outputTokens: 500 }),
    ]
    const result = deduplicateTokensByRequestId(lines)
    // req_A: first nulled, second retained
    expect(result[0].inputTokens).toBeNull()
    expect(result[1].inputTokens).toBe(1000)
    expect(result[1].outputTokens).toBe(100)
    // req_B: first nulled, second retained
    expect(result[2].inputTokens).toBeNull()
    expect(result[3].inputTokens).toBe(5000)
    expect(result[3].outputTokens).toBe(500)
  })

  it('non-assistant entries with requestId are not deduped', () => {
    // 防禦性測試：只有 role=assistant 的才處理
    const lines = [
      makeParsedLine({ type: 'user', role: 'user', uuid: 'u1', requestId: 'req_001', inputTokens: 100 }),
      makeParsedLine({ type: 'user', role: 'user', uuid: 'u2', requestId: 'req_001', inputTokens: 200 }),
    ]
    const result = deduplicateTokensByRequestId(lines)
    expect(result[0].inputTokens).toBe(100)
    expect(result[1].inputTokens).toBe(200)
  })

  it('does not mutate original array', () => {
    const lines = [
      makeParsedLine({ uuid: 'a1', requestId: 'req_001', inputTokens: 3000, outputTokens: 34 }),
      makeParsedLine({ uuid: 'a2', requestId: 'req_001', inputTokens: 3000, outputTokens: 391 }),
    ]
    deduplicateTokensByRequestId(lines)
    // original should be untouched
    expect(lines[0].inputTokens).toBe(3000)
  })
})

// ── markAbandonedBranches (Task 12 / B2) ──

/** fork 測試用 user turn：預設是「真人輸入」（role=user, 無 tool_result, 非 sidechain/compact） */
function humanTurn(overrides: Partial<ParsedLine> = {}): ParsedLine {
  return makeParsedLine({ type: 'user', role: 'user', hasToolResult: false, ...overrides })
}

describe('markAbandonedBranches', () => {
  it('single child per parent → nothing marked, returns same array reference', () => {
    const lines = [
      humanTurn({ uuid: 'u1', parentUuid: null }),
      makeParsedLine({ type: 'assistant', role: 'assistant', uuid: 'a1', parentUuid: 'u1' }),
    ]
    const result = markAbandonedBranches(lines)
    expect(result).toBe(lines)
    expect(result.every(l => !l.isAbandonedBranch)).toBe(true)
  })

  it('real fork: dead-end branch marked, continuing branch untouched', () => {
    const lines = [
      humanTurn({ uuid: 'root', parentUuid: null }),
      humanTurn({ uuid: 'dead-end', parentUuid: 'root', contentText: '補上' }),
      humanTurn({ uuid: 'continues', parentUuid: 'root', contentText: '先不補，但我們有辦法修復這個問題嗎？' }),
      makeParsedLine({ type: 'assistant', role: 'assistant', uuid: 'a1', parentUuid: 'continues' }),
    ]
    const result = markAbandonedBranches(lines)
    const byUuid = new Map(result.map(l => [l.uuid, l]))
    expect(byUuid.get('dead-end')?.isAbandonedBranch).toBe(true)
    expect(byUuid.get('continues')?.isAbandonedBranch).toBeUndefined()
    expect(byUuid.get('root')?.isAbandonedBranch).toBeUndefined()
  })

  it('excludes tool_use/tool_result parallel-call noise sharing one parentUuid', () => {
    // 一個 assistant turn 觸發 2 個平行 tool_use，各自的 tool_result 都指向同一個 parentUuid
    const lines = [
      makeParsedLine({ type: 'assistant', role: 'assistant', uuid: 'asst-1', parentUuid: null, hasToolUse: true }),
      makeParsedLine({ type: 'user', role: 'user', uuid: 'result-1', parentUuid: 'asst-1', hasToolResult: true }),
      makeParsedLine({ type: 'user', role: 'user', uuid: 'result-2', parentUuid: 'asst-1', hasToolResult: true }),
    ]
    const result = markAbandonedBranches(lines)
    expect(result.every(l => !l.isAbandonedBranch)).toBe(true)
  })

  it('excludes isSidechain/isCompactSummary entries from fork candidates', () => {
    const lines = [
      humanTurn({ uuid: 'real-human', parentUuid: 'root' }),
      humanTurn({ uuid: 'sidechain-child', parentUuid: 'root', isSidechain: true }),
      humanTurn({ uuid: 'compact-child', parentUuid: 'root', isCompactSummary: true }),
    ]
    // root 只有 1 個「真人輸入」候選（sidechain/compact 都被排除），不足 2 個不算 fork
    const result = markAbandonedBranches(lines)
    expect(result.every(l => !l.isAbandonedBranch)).toBe(true)
  })

  it('3-way fork: marks both dead-ends, leaves continuing branch alone', () => {
    const lines = [
      humanTurn({ uuid: 'dead-1', parentUuid: 'root' }),
      humanTurn({ uuid: 'dead-2', parentUuid: 'root' }),
      humanTurn({ uuid: 'continues', parentUuid: 'root' }),
      makeParsedLine({ type: 'assistant', role: 'assistant', uuid: 'a1', parentUuid: 'continues' }),
    ]
    const result = markAbandonedBranches(lines)
    const byUuid = new Map(result.map(l => [l.uuid, l]))
    expect(byUuid.get('dead-1')?.isAbandonedBranch).toBe(true)
    expect(byUuid.get('dead-2')?.isAbandonedBranch).toBe(true)
    expect(byUuid.get('continues')?.isAbandonedBranch).toBeUndefined()
  })

  it('both branches continue → neither marked (fork ≠ always-abandoned, matches evap-shield validation case)', () => {
    const lines = [
      humanTurn({ uuid: 'branch-1', parentUuid: 'root' }),
      humanTurn({ uuid: 'branch-2', parentUuid: 'root' }),
      makeParsedLine({ type: 'assistant', role: 'assistant', uuid: 'a1', parentUuid: 'branch-1' }),
      makeParsedLine({ type: 'assistant', role: 'assistant', uuid: 'a2', parentUuid: 'branch-2' }),
    ]
    const result = markAbandonedBranches(lines)
    expect(result.every(l => !l.isAbandonedBranch)).toBe(true)
  })

  it('null parentUuid entries never grouped as fork children', () => {
    const lines = [
      humanTurn({ uuid: 'u1', parentUuid: null }),
      humanTurn({ uuid: 'u2', parentUuid: null }),
    ]
    const result = markAbandonedBranches(lines)
    expect(result.every(l => !l.isAbandonedBranch)).toBe(true)
  })

  it('marks a branch with 1 trailing bookkeeping hop when sibling reaches far further (real markdown-tool "git init" rewind shape)', () => {
    // 真實案例：棄用分支「繼續」1-hop 有子節點（attachment）才斷鏈，勝出分支延續 77 筆。
    // 舊演算法（只查有無 1-hop 子節點）會漏抓「繼續」；新演算法比深度比例才抓得到。
    const lines = [
      humanTurn({ uuid: 'root', parentUuid: null }),
      humanTurn({ uuid: 'abandoned', parentUuid: 'root', contentText: '繼續' }),
      makeParsedLine({ type: 'attachment', uuid: 'bookkeeping', parentUuid: 'abandoned' }), // 唯一一筆，之後斷鏈
      humanTurn({ uuid: 'winner', parentUuid: 'root', contentText: 'git init 我覺得這個階段有問題' }),
      ...Array.from({ length: 20 }, (_, i) =>
        makeParsedLine({ type: 'assistant', role: 'assistant', uuid: `chain-${i}`, parentUuid: i === 0 ? 'winner' : `chain-${i - 1}` }),
      ),
    ]
    const result = markAbandonedBranches(lines)
    const byUuid = new Map(result.map(l => [l.uuid, l]))
    expect(byUuid.get('abandoned')?.isAbandonedBranch).toBe(true)
    expect(byUuid.get('winner')?.isAbandonedBranch).toBeUndefined()
  })

  it('does not mark a branch that is merely somewhat shorter (ratio above threshold)', () => {
    // 2 vs 15：2/15 ≈ 13.3%，高於 10% 門檻，不算棄用（只是稍短，非明顯棄用）
    const lines = [
      humanTurn({ uuid: 'root', parentUuid: null }),
      humanTurn({ uuid: 'shorter', parentUuid: 'root' }),
      makeParsedLine({ type: 'assistant', role: 'assistant', uuid: 's1', parentUuid: 'shorter' }),
      makeParsedLine({ type: 'assistant', role: 'assistant', uuid: 's2', parentUuid: 's1' }),
      humanTurn({ uuid: 'longer', parentUuid: 'root' }),
      ...Array.from({ length: 15 }, (_, i) =>
        makeParsedLine({ type: 'assistant', role: 'assistant', uuid: `l-${i}`, parentUuid: i === 0 ? 'longer' : `l-${i - 1}` }),
      ),
    ]
    const result = markAbandonedBranches(lines)
    expect(result.every(l => !l.isAbandonedBranch)).toBe(true)
  })

  it('all candidates are immediate dead ends (maxDepth 0) → none marked, no false "winner"', () => {
    const lines = [
      humanTurn({ uuid: 'root', parentUuid: null }),
      humanTurn({ uuid: 'dead-a', parentUuid: 'root' }),
      humanTurn({ uuid: 'dead-b', parentUuid: 'root' }),
    ]
    const result = markAbandonedBranches(lines)
    expect(result.every(l => !l.isAbandonedBranch)).toBe(true)
  })
})

// ── resolveNearestVersions (Task 12 / C) ──

describe('resolveNearestVersions', () => {
  it('all lines have version → passes through unchanged', () => {
    const lines = [
      makeParsedLine({ version: '2.1.196' }),
      makeParsedLine({ version: '2.1.196' }),
    ]
    expect(resolveNearestVersions(lines)).toEqual(['2.1.196', '2.1.196'])
  })

  it('leading gap backfilled from first following version', () => {
    const lines = [
      makeParsedLine({ version: null }),
      makeParsedLine({ version: null }),
      makeParsedLine({ version: '2.1.196' }),
    ]
    expect(resolveNearestVersions(lines)).toEqual(['2.1.196', '2.1.196', '2.1.196'])
  })

  it('trailing gap forward-filled from last seen version', () => {
    const lines = [
      makeParsedLine({ version: '2.1.196' }),
      makeParsedLine({ version: null }),
      makeParsedLine({ version: null }),
    ]
    expect(resolveNearestVersions(lines)).toEqual(['2.1.196', '2.1.196', '2.1.196'])
  })

  it('version change mid-file: entries take nearest preceding version', () => {
    const lines = [
      makeParsedLine({ version: '2.1.196' }),
      makeParsedLine({ version: null }),
      makeParsedLine({ version: '2.1.201' }),
      makeParsedLine({ version: null }),
    ]
    expect(resolveNearestVersions(lines)).toEqual(['2.1.196', '2.1.196', '2.1.201', '2.1.201'])
  })

  it('no version anywhere → all null', () => {
    const lines = [makeParsedLine({ version: null }), makeParsedLine({ version: null })]
    expect(resolveNearestVersions(lines)).toEqual([null, null])
  })

  it('empty array → empty result', () => {
    expect(resolveNearestVersions([])).toEqual([])
  })
})

// ── readFirstTimestamp ──

describe('readFirstTimestamp', () => {
  it('returns timestamp from the first line when present', async () => {
    const filePath = path.join(tmpDir, 'ts-basic.jsonl')
    await writeFile(filePath, makeJsonl([
      { timestamp: '2024-06-01T10:00:00.000Z', type: 'user' },
      { timestamp: '2024-06-01T10:00:05.000Z', type: 'assistant' },
    ]))
    expect(await readFirstTimestamp(filePath)).toBe('2024-06-01T10:00:00.000Z')
  })

  it('skips leading timestamp-less lines and finds the first one with', async () => {
    const filePath = path.join(tmpDir, 'ts-skip.jsonl')
    await writeFile(filePath, makeJsonl([
      { type: 'summary', content: 'no timestamp here' },
      { timestamp: '2024-07-01T00:00:00.000Z', type: 'user' },
    ]))
    expect(await readFirstTimestamp(filePath)).toBe('2024-07-01T00:00:00.000Z')
  })

  it('returns null for an empty file', async () => {
    const filePath = path.join(tmpDir, 'empty.jsonl')
    await writeFile(filePath, '')
    expect(await readFirstTimestamp(filePath)).toBeNull()
  })

  it('returns null when file has no timestamped line', async () => {
    const filePath = path.join(tmpDir, 'no-ts.jsonl')
    await writeFile(filePath, makeJsonl([
      { type: 'summary', content: 'a' },
      { type: 'summary', content: 'b' },
    ]))
    expect(await readFirstTimestamp(filePath)).toBeNull()
  })

  it('returns null for nonexistent file', async () => {
    expect(await readFirstTimestamp(path.join(tmpDir, 'does-not-exist.jsonl'))).toBeNull()
  })

  it('ignores non-JSON lines and continues scanning', async () => {
    const filePath = path.join(tmpDir, 'bad-first.jsonl')
    await writeFile(filePath, `not-json-line\n${JSON.stringify({ timestamp: '2024-08-01T00:00:00.000Z' })}`)
    expect(await readFirstTimestamp(filePath)).toBe('2024-08-01T00:00:00.000Z')
  })

  it('finds first timestamp even past 8KB of timestamp-less preamble', async () => {
    // 防回歸：早期版本只 peek 前 8KB，會錯過此類 session，導致被排除刪除的 session
    // 在 re-index 時因 null timestamp 繞過 date rule 而重現。
    const filePath = path.join(tmpDir, 'large-preamble.jsonl')
    const padLine = JSON.stringify({ type: 'summary', content: 'x'.repeat(1000) })
    const lines: string[] = []
    for (let i = 0; i < 12; i++) lines.push(padLine) // ~12KB of preamble
    lines.push(JSON.stringify({ timestamp: '2024-09-01T00:00:00.000Z', type: 'user' }))
    await writeFile(filePath, lines.join('\n'))
    expect(await readFirstTimestamp(filePath)).toBe('2024-09-01T00:00:00.000Z')
  })

  it('returns null for files exceeding size guard (DoS protection)', async () => {
    // 防回歸：無 size guard 時，惡意/異常大檔會被 readFile 全載入記憶體。
    // 超過 maxBytes 應直接回 null（null 對 date rule 保守不匹配，不破壞 skip 語意）。
    const filePath = path.join(tmpDir, 'oversized.jsonl')
    await writeFile(filePath, makeJsonl([
      { timestamp: '2024-06-01T10:00:00.000Z', type: 'user' },
    ]))
    // 檔案 size ~60 bytes；設 guard 為 10 bytes → 應觸發 guard
    expect(await readFirstTimestamp(filePath, 10)).toBeNull()
    // 正常 guard 下仍能讀到
    expect(await readFirstTimestamp(filePath)).toBe('2024-06-01T10:00:00.000Z')
  })
})

// ── matchesExclusionRule ──

function mkRule(overrides: Partial<ExclusionRule> = {}): ExclusionRule {
  return {
    id: 1,
    projectId: null,
    dateFrom: null,
    dateTo: null,
    createdAt: '2024-06-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('matchesExclusionRule', () => {
  it('projectId-only rule matches the same project', () => {
    expect(matchesExclusionRule('-p1', null, mkRule({ projectId: '-p1' }))).toBe(true)
  })

  it('projectId-only rule rejects a different project', () => {
    expect(matchesExclusionRule('-p2', null, mkRule({ projectId: '-p1' }))).toBe(false)
  })

  it('dateFrom-only rule: matches dates >= dateFrom (inclusive)', () => {
    const rule = mkRule({ dateFrom: '2024-06-01' })
    expect(matchesExclusionRule('any', '2024-06-01T00:00:00.000Z', rule)).toBe(true)
    expect(matchesExclusionRule('any', '2024-06-02T00:00:00.000Z', rule)).toBe(true)
    expect(matchesExclusionRule('any', '2024-05-31T23:59:59.000Z', rule)).toBe(false)
  })

  it('dateTo-only rule: matches dates <= dateTo (inclusive)', () => {
    const rule = mkRule({ dateTo: '2024-06-30' })
    expect(matchesExclusionRule('any', '2024-06-30T23:59:59.000Z', rule)).toBe(true)
    expect(matchesExclusionRule('any', '2024-06-01T00:00:00.000Z', rule)).toBe(true)
    expect(matchesExclusionRule('any', '2024-07-01T00:00:00.000Z', rule)).toBe(false)
  })

  it('date range rule: matches only within [from, to]', () => {
    const rule = mkRule({ dateFrom: '2024-06-01', dateTo: '2024-06-30' })
    expect(matchesExclusionRule('p', '2024-06-15T12:00:00.000Z', rule)).toBe(true)
    expect(matchesExclusionRule('p', '2024-05-31T00:00:00.000Z', rule)).toBe(false)
    expect(matchesExclusionRule('p', '2024-07-01T00:00:00.000Z', rule)).toBe(false)
  })

  it('projectId + dateFrom: both must match', () => {
    const rule = mkRule({ projectId: '-p1', dateFrom: '2024-06-01' })
    expect(matchesExclusionRule('-p1', '2024-06-15T00:00:00.000Z', rule)).toBe(true)
    expect(matchesExclusionRule('-p2', '2024-06-15T00:00:00.000Z', rule)).toBe(false)
    expect(matchesExclusionRule('-p1', '2024-05-01T00:00:00.000Z', rule)).toBe(false)
  })

  it('null timestamp with date rule: conservative false (do not skip)', () => {
    expect(matchesExclusionRule('p', null, mkRule({ dateFrom: '2024-06-01' }))).toBe(false)
    expect(matchesExclusionRule('p', null, mkRule({ dateTo: '2024-06-30' }))).toBe(false)
  })

  it('null timestamp with projectId-only rule: still matches', () => {
    expect(matchesExclusionRule('-p1', null, mkRule({ projectId: '-p1' }))).toBe(true)
  })

  it('normalizes timezone offset to UTC date (aligned with SQL DATE semantics)', () => {
    // 防回歸：原版用 substring(0,10) 對非 Z timestamp 會跟 SQL DATE() 的
    // UTC-normalized 結果分歧，造成 applyExclusion 刪了但 skip 不命中 → 被重建。
    // '2024-07-01T00:30:00+08:00' 的 UTC 時間是 2024-06-30T16:30:00Z，日期歸 2024-06-30
    const rule = mkRule({ dateFrom: '2024-06-30', dateTo: '2024-06-30' })
    expect(matchesExclusionRule('p', '2024-07-01T00:30:00+08:00', rule)).toBe(true)
    // 同理 '2024-06-30T23:30:00-05:00' UTC = 2024-07-01 → 不在 06-30 範圍
    expect(matchesExclusionRule('p', '2024-06-30T23:30:00-05:00', rule)).toBe(false)
  })

  it('invalid timestamp with date rule: conservative false (do not skip)', () => {
    expect(matchesExclusionRule('p', 'not-a-date', mkRule({ dateFrom: '2024-06-01' }))).toBe(false)
    expect(matchesExclusionRule('p', '', mkRule({ dateTo: '2024-06-30' }))).toBe(false)
  })
})

// ── runIndexer exclusion rules (integration) ──

describe('runIndexer exclusion rules', () => {
  it('new session covered by rule is skipped on re-index (applyExclusion then rescan)', async () => {
    const baseDir = path.join(tmpDir, 'projects')
    await createProject(baseDir, '-Users-test-excl', { 'sess-excl-1': sampleSession1 })

    // 初次索引 → sess-excl-1 存在
    await runIndexer(db, undefined, baseDir)
    expect(db.getMessages('sess-excl-1')).toHaveLength(2)

    // 透過 applyExclusion 硬刪 + 留下規則
    db.applyExclusion({ projectId: '-Users-test-excl', dateFrom: null, dateTo: null })
    expect(db.getMessages('sess-excl-1')).toEqual([])

    // 磁碟 JSONL 還在，但 rule 應阻止 re-index 重建
    await runIndexer(db, undefined, baseDir)
    expect(db.getMessages('sess-excl-1')).toEqual([])
  })

  it('removing the rule allows subsequent re-index to rebuild the session', async () => {
    const baseDir = path.join(tmpDir, 'projects')
    await createProject(baseDir, '-Users-test-excl2', { 'sess-excl-2': sampleSession1 })

    await runIndexer(db, undefined, baseDir)
    const { rule } = db.applyExclusion({ projectId: '-Users-test-excl2', dateFrom: null, dateTo: null })
    expect(db.getMessages('sess-excl-2')).toEqual([])

    // rule 還在 → 不重建
    await runIndexer(db, undefined, baseDir)
    expect(db.getMessages('sess-excl-2')).toEqual([])

    // 移除 rule → 重建
    db.removeExclusionRule(rule.id)
    await runIndexer(db, undefined, baseDir)
    expect(db.getMessages('sess-excl-2')).toHaveLength(2)
  })

  it('session outside rule date range is indexed normally', async () => {
    const baseDir = path.join(tmpDir, 'projects')
    await createProject(baseDir, '-Users-test-excl3', {
      'sess-old': sampleSession1, // 2024-06-01
      'sess-new': [{
        type: 'user', uuid: 'un', timestamp: '2024-09-01T00:00:00.000Z',
        sessionId: 'sess-new', message: { role: 'user', content: 'newer' },
      }],
    })

    await runIndexer(db, undefined, baseDir)
    expect(db.getMessages('sess-old')).toHaveLength(2)
    expect(db.getMessages('sess-new')).toHaveLength(1)

    // 規則只涵蓋 2024-06 → 刪 sess-old，留 sess-new
    db.applyExclusion({ projectId: null, dateFrom: '2024-06-01', dateTo: '2024-06-30' })
    expect(db.getMessages('sess-old')).toEqual([])
    expect(db.getMessages('sess-new')).toHaveLength(1)

    // re-index：sess-old 不重建，sess-new 保留
    await runIndexer(db, undefined, baseDir)
    expect(db.getMessages('sess-old')).toEqual([])
    expect(db.getMessages('sess-new')).toHaveLength(1)
  })

  it('cross-day session attributed by first timestamp (start date)', async () => {
    const crossDay = [
      {
        type: 'user', uuid: 'uc', timestamp: '2024-06-30T23:59:00.000Z',
        sessionId: 'sess-cross', message: { role: 'user', content: 'hi' },
      },
      {
        type: 'assistant', uuid: 'ac', parentUuid: 'uc',
        timestamp: '2024-07-02T01:00:00.000Z', sessionId: 'sess-cross',
        message: { role: 'assistant', content: 'next day' },
      },
    ]
    const baseDir = path.join(tmpDir, 'projects')
    await createProject(baseDir, '-Users-test-cross', { 'sess-cross': crossDay })

    await runIndexer(db, undefined, baseDir)
    expect(db.getMessages('sess-cross')).toHaveLength(2)

    // 只涵蓋 2024-06-30 單日：以 first timestamp 歸屬應命中
    db.applyExclusion({ projectId: null, dateFrom: '2024-06-30', dateTo: '2024-06-30' })
    expect(db.getMessages('sess-cross')).toEqual([])

    // re-index：readFirstTimestamp 取第一行 → 日期 2024-06-30 → rule 命中 skip
    await runIndexer(db, undefined, baseDir)
    expect(db.getMessages('sess-cross')).toEqual([])
  })

  it('multiple rules: any match triggers skip', async () => {
    const baseDir = path.join(tmpDir, 'projects')
    await createProject(baseDir, '-Users-multi-A', { 'sess-A': sampleSession1 })
    await createProject(baseDir, '-Users-multi-B', { 'sess-B': sampleSession1 })

    await runIndexer(db, undefined, baseDir)
    db.applyExclusion({ projectId: '-Users-multi-A', dateFrom: null, dateTo: null })
    db.applyExclusion({ projectId: '-Users-multi-B', dateFrom: null, dateTo: null })

    await runIndexer(db, undefined, baseDir)
    expect(db.getMessages('sess-A')).toEqual([])
    expect(db.getMessages('sess-B')).toEqual([])
  })

  it('empty rules set → all sessions indexed normally (fast path)', async () => {
    const baseDir = path.join(tmpDir, 'projects')
    await createProject(baseDir, '-Users-test-none', { 'sess-plain': sampleSession1 })

    await runIndexer(db, undefined, baseDir)
    expect(db.getExclusionRules()).toEqual([])
    expect(db.getMessages('sess-plain')).toHaveLength(2)
  })
})
