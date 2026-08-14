import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, rm, mkdir, writeFile, chmod, readFile, readdir, stat, utimes } from 'node:fs/promises'
import { Database } from '../src/main/database'
import { runIndexer, deduplicateTokensByRequestId, readFirstTimestamp, matchesExclusionRule, markAbandonedBranches, resolveNearestVersions, type ProgressCallback } from '../src/main/indexer'
import type { ExclusionRule, IndexerProgress, ParsedLine } from '../src/shared/types'

let tmpDir: string
let tasksDir: string
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

/**
 * 在既有 session 底下放一個 subagent JSONL，回傳它的路徑。
 * 與 stale-subagent describe 內的 helper 不同：那個連 parent session 一起建（內容寫死），
 * 這個只加 subagent，好讓呼叫端自由決定 parent 的內容與 uuid。
 */
async function addSubagent(baseDir: string, projectId: string, sessionId: string, agentId: string): Promise<string> {
  const subagentsDir = path.join(baseDir, projectId, sessionId, 'subagents')
  await mkdir(subagentsDir, { recursive: true })
  const filePath = path.join(subagentsDir, `${agentId}.jsonl`)
  await writeFile(filePath, makeJsonl([
    {
      type: 'user', uuid: `${agentId}-u1`, isSidechain: true,
      timestamp: '2024-06-01T11:00:00.000Z', sessionId: agentId,
      message: { role: 'user', content: 'subagent task' },
    },
  ]))
  return filePath
}

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ccrewind-idx-'))
  // 每個測試自己的 tasks 目錄。不傳就會落到真實的 ~/.claude/tasks，
  // 讓斷言依賴開發者本機的資料 —— 測試不碰生產資料是硬規則。
  tasksDir = path.join(tmpDir, 'tasks')
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

    const statuses: IndexerProgress[] = []
    const onProgress: ProgressCallback = (s) => statuses.push({ ...s })

    await runIndexer(db, onProgress, baseDir, tasksDir)

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
    await runIndexer(db, undefined, baseDir, tasksDir)
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
    const statuses: IndexerProgress[] = []
    await runIndexer(db, (s) => statuses.push({ ...s }), baseDir, tasksDir)

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

    await runIndexer(db, undefined, baseDir, tasksDir)

    const projects = db.getProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0].id).toBe('-Users-test-empty')
    expect(projects[0].sessionCount).toBe(0)
  })

  it('一切正常時 skipped 為 0', async () => {
    const baseDir = path.join(tmpDir, 'projects')
    await createProject(baseDir, '-Users-test-proj1', { 'sess-001': sampleSession1 })

    const progresses: IndexerProgress[] = []
    await runIndexer(db, (s) => progresses.push({ ...s }), baseDir, tasksDir)

    expect(progresses.every(s => s.skipped === 0)).toBe(true)
  })

  it('parse 失敗的 session 計入 skipped 並留下 log，不靜默吞掉', async (ctx) => {
    const baseDir = path.join(tmpDir, 'projects')
    await createProject(baseDir, '-Users-test-proj1', {
      'sess-001': sampleSession1,
      'sess-bad': sampleSession1,
    })
    // 讀不到的檔案是真實會發生的情境（權限、掛載點消失）。走真的 I/O 失敗而非 mock，
    // 才驗得到 parseSession → catch → skipped 這整條路徑。
    const badPath = path.join(baseDir, '-Users-test-proj1', 'sess-bad.jsonl')
    await chmod(badPath, 0o000)

    // Windows 與 root 底下 chmod 擋不住讀取，那就沒有失敗可測 —— 明講跳過，不要假綠
    const stillReadable = await readFile(badPath).then(() => true, () => false)
    if (stillReadable) {
      await chmod(badPath, 0o644)
      ctx.skip()
    }

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const progresses: IndexerProgress[] = []
    await runIndexer(db, (s) => progresses.push({ ...s }), baseDir, tasksDir)
    // mockRestore 會一併清掉 calls，順序不能反過來
    const logged = warn.mock.calls.map(c => c.join(' ')).join('\n')
    warn.mockRestore()
    await chmod(badPath, 0o644)

    const done = progresses.find(s => s.phase === 'done')
    expect(done?.skipped).toBe(1)

    // 賣點是「一個位元組都不會丟」，跳過必須有跡可循 —— log 要指得出是哪一個
    expect(logged).toContain('sess-bad')

    // 壞的那個不該拖累其他 session
    expect(db.getMessages('sess-001')).toHaveLength(2)
    expect(db.getMessages('sess-bad')).toHaveLength(0)
  })

  it('惡意檔名無法從 log 偽造出一行假訊息', async (ctx) => {
    const baseDir = path.join(tmpDir, 'projects')
    await createProject(baseDir, '-Users-test-proj1', { 'sess-001': sampleSession1 })

    // 檔名在 macOS / Linux 可以合法含換行。沒逃逸的話，這個檔名會讓 log 多印一行
    // 看起來像 indexer 自己說的話 —— 而它說的正好是「什麼都沒漏」。
    const evilId = 'evil\n[indexer] run finished with 0 item(s) skipped'
    const evilPath = path.join(baseDir, '-Users-test-proj1', `${evilId}.jsonl`)
    try {
      await writeFile(evilPath, makeJsonl(sampleSession1))
      await chmod(evilPath, 0o000)
    } catch {
      ctx.skip() // Windows 不接受這種檔名，這條攻擊面在該平台不存在
    }
    const stillReadable = await readFile(evilPath).then(() => true, () => false)
    if (stillReadable) {
      await chmod(evilPath, 0o644)
      ctx.skip()
    }

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await runIndexer(db, undefined, baseDir, tasksDir)
    const calls = warn.mock.calls.map(c => c.map(String).join(' '))
    warn.mockRestore()
    await chmod(evilPath, 0o644)

    expect(calls.length).toBeGreaterThan(0)
    // 每一筆 log 都必須是單獨一行，檔名不能把自己撐成第二行
    for (const call of calls) {
      expect(call).not.toContain('\n')
    }
    // 逃逸後的形式仍看得出是哪個檔案
    expect(calls.join(' ')).toContain('evil')
  })

  it('progressCallback → emits scanning → indexing → done in order', async () => {
    const baseDir = path.join(tmpDir, 'projects')
    await createProject(baseDir, '-Users-test-proj1', { 'sess-001': sampleSession1 })

    const phases: string[] = []
    await runIndexer(db, (s) => phases.push(s.phase), baseDir, tasksDir)

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
    await runIndexer(db, undefined, fakeDir, tasksDir)

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
    await runIndexer(db, undefined, baseDir, tasksDir)

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
      { type: 'reasoning-trace', sessionId: 'sess-fork', timestamp: '2026-07-07T10:00:02.000Z' },
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

    await runIndexer(db, undefined, baseDir, tasksDir)

    // Message（renderer 讀取型別）不外露 uuid，改用 contentText 定位（見 shared/types.ts）
    const messages = db.getMessages('sess-fork')
    const byContent = new Map(messages.filter(m => m.contentText).map(m => [m.contentText, m]))

    expect(byContent.get('ok, proceeding')?.parentUuid).toBe('root')
    expect(byContent.get('補上')?.isAbandonedBranch).toBe(true)
    expect(byContent.get('先不補，但我們有辦法修復這個問題嗎？')?.isAbandonedBranch).toBe(false)
    expect(byContent.get('compact summary text')?.isCompactSummary).toBe(true)

    // unknown-type 'reasoning-trace' entry：raw_json 存進 message_archive，version 用鄰近值（前一筆 a-root）回填
    const archived = db.rawAll<{ version: string | null }>(
      "SELECT ma.version AS version FROM message_archive ma JOIN messages m ON m.id = ma.message_id WHERE m.session_id = 'sess-fork' AND m.type = 'reasoning-trace'",
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

    await runIndexer(db, undefined, baseDir, tasksDir)

    // subagentId 由 indexer 組成 `${parentSessionId}/${bareId}`（見 scanner.ts scanSubagents）
    const subMessages = db.getMessages('sess-side/agent-a1')
    expect(subMessages).toHaveLength(1)
    expect(subMessages[0].isSidechain).toBe(true)
  })

  it('marks the correct branch abandoned even when a resumed session replays a mid-chain ancestor that gets cross-session deduped (CodeRabbit-caught regression)', async () => {
    // markAbandonedBranches 必須在 UUID 去重「之前」跑：resumed session 的 replay entries
    // 會被去重濾掉；若順序反了，'long' 分支透過 l1 延續到 l2/l3/l4 的鏈路會因為 l1 被抽掉而斷開，
    // 導致 computeMaxReachableIndex 誤判 'long' 深度為 0，跟 'short' 打平（maxDepth=0 guard 生效，
    // 兩支都不會被標記——真正的 fork 反而完全偵測不到）。
    const baseDir = path.join(tmpDir, 'projects')
    const olderSession = [
      {
        type: 'assistant', uuid: 'l1', timestamp: '2026-07-01T09:00:00.000Z', sessionId: 'sess-old',
        message: { role: 'assistant', content: '之後在 resumed session 被 replay 的一行' },
      },
    ]
    const resumedSession = [
      { type: 'user', uuid: 'root', timestamp: '2026-07-02T09:00:00.000Z', sessionId: 'sess-new', message: { role: 'user', content: '起點' } },
      { type: 'user', uuid: 'long', parentUuid: 'root', timestamp: '2026-07-02T09:00:01.000Z', sessionId: 'sess-new', message: { role: 'user', content: '繼續原方向' } },
      // 跟 sess-old 共用同一個 uuid：indexer 會把這行當成 replay duplicate 從 sess-new 濾掉
      {
        type: 'assistant', uuid: 'l1', parentUuid: 'long', timestamp: '2026-07-02T09:00:02.000Z', sessionId: 'sess-new',
        message: { role: 'assistant', content: '之後在 resumed session 被 replay 的一行' },
      },
      { type: 'assistant', uuid: 'l2', parentUuid: 'l1', timestamp: '2026-07-02T09:00:03.000Z', sessionId: 'sess-new', message: { role: 'assistant', content: '繼續處理 A' } },
      { type: 'assistant', uuid: 'l3', parentUuid: 'l2', timestamp: '2026-07-02T09:00:04.000Z', sessionId: 'sess-new', message: { role: 'assistant', content: '繼續處理 B' } },
      { type: 'assistant', uuid: 'l4', parentUuid: 'l3', timestamp: '2026-07-02T09:00:05.000Z', sessionId: 'sess-new', message: { role: 'assistant', content: '繼續處理 C' } },
      { type: 'user', uuid: 'short', parentUuid: 'root', timestamp: '2026-07-02T09:00:06.000Z', sessionId: 'sess-new', message: { role: 'user', content: '換個方向試試' } },
    ]
    await createProject(baseDir, '-Users-test-resume-fork', { 'sess-old': olderSession, 'sess-new': resumedSession })

    await runIndexer(db, undefined, baseDir, tasksDir)

    const newMessages = db.getMessages('sess-new')
    const byContent = new Map(newMessages.map(m => [m.contentText, m]))
    expect(byContent.get('繼續原方向')?.isAbandonedBranch).toBe(false)
    expect(byContent.get('換個方向試試')?.isAbandonedBranch).toBe(true)
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
    hasImage: false,
    attributionSkill: null,
    attributionPlugin: null,
    attributionMcpServer: null,
    attributionMcpTool: null,
    attributionAgent: null,
    systemSubtype: null,
    apiErrorStatus: null,
    editedFilePath: null,
    frameUrl: null,
    bridgeSessionId: null,
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
    await runIndexer(db, undefined, baseDir, tasksDir)
    expect(db.getMessages('sess-excl-1')).toHaveLength(2)

    // 透過 applyExclusion 硬刪 + 留下規則
    db.applyExclusion({ projectId: '-Users-test-excl', dateFrom: null, dateTo: null })
    expect(db.getMessages('sess-excl-1')).toEqual([])

    // 磁碟 JSONL 還在，但 rule 應阻止 re-index 重建
    await runIndexer(db, undefined, baseDir, tasksDir)
    expect(db.getMessages('sess-excl-1')).toEqual([])
  })

  it('removing the rule allows subsequent re-index to rebuild the session', async () => {
    const baseDir = path.join(tmpDir, 'projects')
    await createProject(baseDir, '-Users-test-excl2', { 'sess-excl-2': sampleSession1 })

    await runIndexer(db, undefined, baseDir, tasksDir)
    const { rule } = db.applyExclusion({ projectId: '-Users-test-excl2', dateFrom: null, dateTo: null })
    expect(db.getMessages('sess-excl-2')).toEqual([])

    // rule 還在 → 不重建
    await runIndexer(db, undefined, baseDir, tasksDir)
    expect(db.getMessages('sess-excl-2')).toEqual([])

    // 移除 rule → 重建
    db.removeExclusionRule(rule.id)
    await runIndexer(db, undefined, baseDir, tasksDir)
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

    await runIndexer(db, undefined, baseDir, tasksDir)
    expect(db.getMessages('sess-old')).toHaveLength(2)
    expect(db.getMessages('sess-new')).toHaveLength(1)

    // 規則只涵蓋 2024-06 → 刪 sess-old，留 sess-new
    db.applyExclusion({ projectId: null, dateFrom: '2024-06-01', dateTo: '2024-06-30' })
    expect(db.getMessages('sess-old')).toEqual([])
    expect(db.getMessages('sess-new')).toHaveLength(1)

    // re-index：sess-old 不重建，sess-new 保留
    await runIndexer(db, undefined, baseDir, tasksDir)
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

    await runIndexer(db, undefined, baseDir, tasksDir)
    expect(db.getMessages('sess-cross')).toHaveLength(2)

    // 只涵蓋 2024-06-30 單日：以 first timestamp 歸屬應命中
    db.applyExclusion({ projectId: null, dateFrom: '2024-06-30', dateTo: '2024-06-30' })
    expect(db.getMessages('sess-cross')).toEqual([])

    // re-index：readFirstTimestamp 取第一行 → 日期 2024-06-30 → rule 命中 skip
    await runIndexer(db, undefined, baseDir, tasksDir)
    expect(db.getMessages('sess-cross')).toEqual([])
  })

  it('multiple rules: any match triggers skip', async () => {
    const baseDir = path.join(tmpDir, 'projects')
    await createProject(baseDir, '-Users-multi-A', { 'sess-A': sampleSession1 })
    await createProject(baseDir, '-Users-multi-B', { 'sess-B': sampleSession1 })

    await runIndexer(db, undefined, baseDir, tasksDir)
    db.applyExclusion({ projectId: '-Users-multi-A', dateFrom: null, dateTo: null })
    db.applyExclusion({ projectId: '-Users-multi-B', dateFrom: null, dateTo: null })

    await runIndexer(db, undefined, baseDir, tasksDir)
    expect(db.getMessages('sess-A')).toEqual([])
    expect(db.getMessages('sess-B')).toEqual([])
  })

  it('empty rules set → all sessions indexed normally (fast path)', async () => {
    const baseDir = path.join(tmpDir, 'projects')
    await createProject(baseDir, '-Users-test-none', { 'sess-plain': sampleSession1 })

    await runIndexer(db, undefined, baseDir, tasksDir)
    expect(db.getExclusionRules()).toEqual([])
    expect(db.getMessages('sess-plain')).toHaveLength(2)
  })

  it('索引跑到一半才被排除的 session，不會從補寫 parent 那條路復活', async () => {
    // phase 2 的 excludedSessionIds 蓋不到這個情境：快照當下 session 還在表裡，走的是
    // existing 分支，從來沒進過那個集合。等 phase 3 期間使用者按下排除、phase 4 又發現
    // parent 不在表裡，補寫 metadata parent 就會把剛刪掉的東西接回來。
    const baseDir = path.join(tmpDir, 'projects')
    const line = (sessionId: string, uuid: string) => [{
      type: 'user', uuid, timestamp: '2024-06-01T10:00:00.000Z', sessionId,
      message: { role: 'user', content: 'hi' },
    }]
    await createProject(baseDir, '-Users-mid-excl', {
      'sess-quiet': line('sess-quiet', 'quiet-u1'),  // 有 subagent，本輪不會重新索引
      'sess-busy': line('sess-busy', 'busy-u1'),     // 本輪會被索引，用來把流程推進 phase 3
    })
    await addSubagent(baseDir, '-Users-mid-excl', 'sess-quiet', 'agent-q')

    await runIndexer(db, undefined, baseDir, tasksDir)
    expect(db.getMessages('sess-quiet/agent-q')).toHaveLength(1)

    // 只動 sess-busy 的 mtime，sess-quiet 這輪不進 sessionsToIndex（否則 phase 3 自己就重建了，測不到 phase 4）
    const t = new Date('2024-07-01T10:00:00.000Z')
    await utimes(path.join(baseDir, '-Users-mid-excl', 'sess-busy.jsonl'), t, t)

    let fired = false
    const excludeMidRun: ProgressCallback = (p) => {
      if (p.phase === 'indexing' && !fired) {
        fired = true
        db.applyExclusion({ projectId: '-Users-mid-excl', dateFrom: null, dateTo: null })
      }
    }
    await runIndexer(db, excludeMidRun, baseDir, tasksDir)

    expect(fired).toBe(true)
    // 使用者主動排除的決定要贏過「補寫 metadata parent 救 subagent」
    expect(db.getMessages('sess-quiet')).toEqual([])
    expect(db.getMessages('sess-quiet/agent-q')).toEqual([])
  })

  it('索引跑到一半才被排除的 session，不會在 phase 3 被寫回去', async () => {
    // 跟上面那個的差別在走哪條路：這個 session 有進 sessionsToIndex，被擋的是主寫入
    // 路徑。已完整索引的 session 在 phase 2 不做 exclusion 檢查（分工是交給
    // applyExclusion 硬刪），所以寫入前那道檢查是它唯一的防線。
    const baseDir = path.join(tmpDir, 'projects')
    await createProject(baseDir, '-Users-p3-excl', { 'sess-p3': sampleSession1 })

    await runIndexer(db, undefined, baseDir, tasksDir)
    expect(db.getMessages('sess-p3')).toHaveLength(2)

    // 動 mtime → 這輪它會重新索引，走的是 phase 3 而不是 phase 4 的補寫
    const t = new Date('2024-07-01T10:00:00.000Z')
    await utimes(path.join(baseDir, '-Users-p3-excl', 'sess-p3.jsonl'), t, t)

    let fired = false
    const excludeMidRun: ProgressCallback = (p) => {
      if (p.phase === 'indexing' && !fired) {
        fired = true
        db.applyExclusion({ projectId: '-Users-p3-excl', dateFrom: null, dateTo: null })
      }
    }
    await runIndexer(db, excludeMidRun, baseDir, tasksDir)

    expect(fired).toBe(true)
    // 不自癒是這條的關鍵：下一輪 mtime 沒變就不再進佇列，寫回去就永遠回不來了
    expect(db.getMessages('sess-p3')).toEqual([])
  })

  it('summary_version 為 null 的 provisional parent 仍要重評 exclusion rule', async () => {
    // 補寫進去的 metadata-only parent 下一輪就成了 existing。若 exclusion 只看 !existing，
    // 它等於拿到永久豁免——parent 恢復可讀後整段被索引回來，使用者設的日期範圍形同虛設。
    const baseDir = path.join(tmpDir, 'projects')
    await createProject(baseDir, '-Users-prov', { 'sess-prov': sampleSession1 })
    const filePath = path.join(baseDir, '-Users-prov', 'sess-prov.jsonl')
    const st = await stat(filePath)

    // 直接造出 provisional 狀態：有 row、沒訊息、summary_version 為 null，mtime 與磁碟一致
    // （mtime 相同才能確定重新索引是 summaryStale 觸發的，而不是 mtime 變動）
    db.indexSession({
      sessionId: 'sess-prov',
      projectId: '-Users-prov',
      projectDisplayName: 'prov',
      title: null,
      messageCount: 0,
      filePath,
      fileSize: st.size,
      fileMtime: st.mtime.toISOString(),
      startedAt: null,
      endedAt: null,
      summaryVersion: null,
      messages: [],
    })
    expect(db.getMessages('sess-prov')).toEqual([])

    // 規則涵蓋這個 session 的日期（sampleSession1 是 2024-06-01）
    db.applyExclusion({ projectId: null, dateFrom: '2024-06-01', dateTo: '2024-06-30' })

    await runIndexer(db, undefined, baseDir, tasksDir)

    // 被規則涵蓋 → 不該趁 summaryStale 重新索引把內容補齊
    expect(db.getMessages('sess-prov')).toEqual([])
  })
})

describe('runIndexer — stale subagent handling', () => {
  /** 建一個帶 subagent 的 project，回傳 [baseDir, sessionDir] */
  async function createProjectWithSubagent(projectId: string, sessionId: string, agentId: string): Promise<[string, string]> {
    const baseDir = path.join(tmpDir, 'projects')
    // uuid 必須帶 sessionId 前綴：共用固定 uuid 會讓第二個 session 被跨 session UUID
    // 去重濾光，indexer 靜默 continue 不寫入 sessions，其 subagent 隨即 FK 失敗
    await createProject(baseDir, projectId, {
      [sessionId]: [
        {
          type: 'user', uuid: `${sessionId}-u1`, timestamp: '2026-08-01T09:00:00.000Z', sessionId,
          message: { role: 'user', content: 'parent session' },
        },
      ],
    })
    const sessionDir = path.join(baseDir, projectId, sessionId)
    await mkdir(path.join(sessionDir, 'subagents'), { recursive: true })
    await writeFile(
      path.join(sessionDir, 'subagents', `${agentId}.jsonl`),
      makeJsonl([
        {
          type: 'user', uuid: `${agentId}-u1`, isSidechain: true, timestamp: '2026-08-01T10:00:00.000Z', sessionId: agentId,
          message: { role: 'user', content: 'subagent task' },
        },
      ]),
    )
    return [baseDir, sessionDir]
  }

  it('archives an orphaned subagent instead of deleting it when the parent session disappears', async () => {
    const [baseDir, sessionDir] = await createProjectWithSubagent('-Users-test-orphan', 'sess-p', 'agent-o1')
    // 另留一個 session 在磁碟上。真實索引庫不會因為刪掉一個 session 就整個掃空，
    // 而全空會觸發「掃描失敗」守衛（見下面 skips archiving entirely 那條）
    await createProjectWithSubagent('-Users-test-orphan-keep', 'sess-keep', 'agent-keep')
    await runIndexer(db, undefined, baseDir, tasksDir)
    expect(db.getMessages('sess-p/agent-o1')).toHaveLength(1)

    // parent session 整個從磁碟消失（.jsonl 與 subagents/ 目錄一起）
    await rm(path.join(baseDir, '-Users-test-orphan', 'sess-p.jsonl'))
    await rm(sessionDir, { recursive: true })

    await runIndexer(db, undefined, baseDir, tasksDir)

    // 內容必須保留：index.db 的副本是那段對話唯一還存在的地方
    expect(db.getMessages('sess-p/agent-o1')).toHaveLength(1)
    // 但要標記成 archived，不能繼續假裝是活躍的
    expect(db.getAllSessionMtimes().get('sess-p/agent-o1')?.archived).toBe(true)
  })

  it('un-archives a subagent when its file comes back with an unchanged mtime', async () => {
    const [baseDir, sessionDir] = await createProjectWithSubagent('-Users-test-restore', 'sess-r', 'agent-r1')
    await createProjectWithSubagent('-Users-test-restore-keep', 'sess-keep', 'agent-keep')
    await runIndexer(db, undefined, baseDir, tasksDir)

    const subPath = path.join(sessionDir, 'subagents', 'agent-r1.jsonl')
    const content = await readFile(subPath)
    const { mtime } = await stat(subPath)

    await rm(path.join(baseDir, '-Users-test-restore', 'sess-r.jsonl'))
    await rm(sessionDir, { recursive: true })
    await runIndexer(db, undefined, baseDir, tasksDir)
    expect(db.getAllSessionMtimes().get('sess-r/agent-r1')?.archived).toBe(true)

    // 還原檔案並保留原本的 mtime（rsync -a / Time Machine 還原都會這樣）
    await createProject(baseDir, '-Users-test-restore', { 'sess-r': sampleSession1 })
    await mkdir(path.join(sessionDir, 'subagents'), { recursive: true })
    await writeFile(subPath, content)
    await utimes(subPath, mtime, mtime)

    await runIndexer(db, undefined, baseDir, tasksDir)

    // archive 必須可逆，否則選 archive 而非 delete 的理由就少了一半
    expect(db.getAllSessionMtimes().get('sess-r/agent-r1')?.archived).toBe(false)
  })

  it('leaves subagents that are still on disk untouched', async () => {
    const [baseDir] = await createProjectWithSubagent('-Users-test-keep', 'sess-k', 'agent-k1')
    await runIndexer(db, undefined, baseDir, tasksDir)
    await runIndexer(db, undefined, baseDir, tasksDir)

    expect(db.getAllSessionMtimes().get('sess-k/agent-k1')?.archived).toBe(false)
    expect(db.getMessages('sess-k/agent-k1')).toHaveLength(1)
  })

  it('skips archiving entirely when the scan yields no subagents at all', async () => {
    // 負向驗證：scanner 把讀取失敗轉成空陣列（scanner.ts 三處 return []），
    // indexer 無法區分「使用者刪光了」與「掃描整個失敗」。後者若照樣 archive，
    // 一次權限錯誤就會把全部 subagent 標成已封存。
    const [baseDir] = await createProjectWithSubagent('-Users-test-guard', 'sess-g', 'agent-g1')
    await runIndexer(db, undefined, baseDir, tasksDir)
    expect(db.getAllSessionMtimes().get('sess-g/agent-g1')?.archived).toBe(false)

    // 模擬掃描全面失敗：baseDir 整個讀不到
    await rm(baseDir, { recursive: true })
    await runIndexer(db, undefined, baseDir, tasksDir)

    expect(db.getAllSessionMtimes().get('sess-g/agent-g1')?.archived).toBe(false)
  })

  it('skips archiving when one session scan fails while others succeed', async () => {
    // 「掃到的總數 > 0」擋不住部分失敗：只要還有別的 session 掃描成功讓計數非零，
    // 掃描失敗那個 session 的 subagent 就會被當成使用者刪掉而封存。
    const [baseDir, sessionDir] = await createProjectWithSubagent('-Users-test-partial', 'sess-x', 'agent-x1')
    await createProjectWithSubagent('-Users-test-partial-ok', 'sess-ok', 'agent-ok')
    await runIndexer(db, undefined, baseDir, tasksDir)
    expect(db.getAllSessionMtimes().get('sess-x/agent-x1')?.archived).toBe(false)

    // 讓 sess-x 的 subagents/ 讀不到，但不能是「不存在」（ENOENT 是常態，不算失敗）：
    // 換成同名檔案讓 readdir 回 ENOTDIR。比 chmod 穩——不受執行身分（root 無視權限）
    // 與平台權限語意影響，CI 上行為一致。
    const subagentsDir = path.join(sessionDir, 'subagents')
    await rm(subagentsDir, { recursive: true })
    await writeFile(subagentsDir, 'not a directory')

    const progresses: IndexerProgress[] = []
    await runIndexer(db, (s) => progresses.push({ ...s }), baseDir, tasksDir)

    // sess-ok 掃得到，但那不代表 sess-x 的 subagent 真的從磁碟消失了
    expect(db.getAllSessionMtimes().get('sess-x/agent-x1')?.archived).toBe(false)
    expect(db.getAllSessionMtimes().get('sess-ok/agent-ok')?.archived).toBe(false)

    // 掃描層把失敗吞成空陣列，不主動計數的話整輪會回報 skipped: 0——
    // 「索引不完整」與「一切正常」在 UI 上長得一模一樣
    expect(progresses.find(s => s.phase === 'done')?.skipped).toBe(1)
  })

  it('skips archiving when a project directory cannot be read', async (ctx) => {
    // 上游一層的同款漏洞：project 讀不到時 scanner 直接 continue，那個 project 底下的
    // session 根本不會進 subagent 掃描迴圈——session 層級的守衛偵測不到，
    // 別的 project 掃得到就讓計數非零，於是整個讀不到的 project 的 subagent 被誤封存。
    const [baseDir] = await createProjectWithSubagent('-Users-test-projfail', 'sess-pf', 'agent-pf1')
    await createProjectWithSubagent('-Users-test-projfail-ok', 'sess-pok', 'agent-pok')
    await runIndexer(db, undefined, baseDir, tasksDir)
    expect(db.getAllSessionMtimes().get('sess-pf/agent-pf1')?.archived).toBe(false)

    // 目錄本身鎖掉：stat 靠父目錄權限仍會成功，readdir 才會 EACCES——
    // 正好打中 scanner 在 project 層級 continue 的那條路徑
    const badProject = path.join(baseDir, '-Users-test-projfail')
    await chmod(badProject, 0o000)

    // Windows 與 root 底下 chmod 擋不住讀取，那就沒有失敗可測 —— 明講跳過，不要假綠
    const stillReadable = await readdir(badProject).then(() => true, () => false)
    if (stillReadable) {
      await chmod(badProject, 0o755)
      ctx.skip()
    }

    const progresses: IndexerProgress[] = []
    await runIndexer(db, (s) => progresses.push({ ...s }), baseDir, tasksDir)
    await chmod(badProject, 0o755)

    // 檔案還在磁碟上，只是這次讀不到——不能當成使用者刪了
    expect(db.getAllSessionMtimes().get('sess-pf/agent-pf1')?.archived).toBe(false)
    expect(db.getAllSessionMtimes().get('sess-pok/agent-pok')?.archived).toBe(false)
    // 整個 project 掉出索引是比單一 session 更大的缺口，更不能靜悄悄
    expect(progresses.find(s => s.phase === 'done')?.skipped).toBe(1)
  })
})

describe('runIndexer — subagent 的 parent 必須先在 sessions 表裡', () => {
  // subagent_sessions.parent_session_id 有 FK 指向 sessions(id) 且 foreign_keys=ON。
  // 主迴圈每一個「掃到了但沒寫進 sessions 表」的 continue，都會讓底下的 subagent
  // 在寫入時撞 constraint 直接拋出——中斷的是整輪索引，不只那一個 session。
  // 三條 continue 各測一次，因為它們是各自獨立的進入點。

  /** 兩個 session 共用 uuid：後索引的那個會被跨 session 去重成空，走純 replay 那條 continue */
  function sharedUuidLines(sessionId: string) {
    return [
      {
        type: 'user', uuid: 'shared-u1', timestamp: '2024-06-01T10:00:00.000Z', sessionId,
        message: { role: 'user', content: 'same content in both sessions' },
      },
    ]
  }

  it('exclusion rule 擋下 parent 時，不寫入它的 subagent', async () => {
    const baseDir = path.join(tmpDir, 'projects')
    await createProject(baseDir, '-Users-excl-sub', {
      'sess-es': [{
        type: 'user', uuid: 'sess-es-u1', timestamp: '2024-06-01T10:00:00.000Z', sessionId: 'sess-es',
        message: { role: 'user', content: 'parent session' },
      }],
    })
    await addSubagent(baseDir, '-Users-excl-sub', 'sess-es', 'agent-es')

    await runIndexer(db, undefined, baseDir, tasksDir)
    expect(db.getMessages('sess-es/agent-es')).toHaveLength(1)

    // 硬刪 + 留規則：parent 與 subagent 一起從 DB 消失（ON DELETE CASCADE）
    db.applyExclusion({ projectId: '-Users-excl-sub', dateFrom: null, dateTo: null })
    expect(db.getMessages('sess-es')).toEqual([])
    expect(db.getMessages('sess-es/agent-es')).toEqual([])

    // 磁碟檔案都還在。規則把 parent 擋在 sessions 表外，subagent 就沒有 parent 可掛
    await runIndexer(db, undefined, baseDir, tasksDir)

    expect(db.getMessages('sess-es')).toEqual([])
    // 使用者主動排除掉的資料不能從 subagent 這條路徑部分復活
    expect(db.getMessages('sess-es/agent-es')).toEqual([])
  })

  it('純 replay 的新 session 仍保住它的 subagent（補一列 metadata-only 的 parent）', async () => {
    const baseDir = path.join(tmpDir, 'projects')
    await createProject(baseDir, '-Users-replay-sub', {
      'sess-origin': sharedUuidLines('sess-origin'),
      'sess-replay': sharedUuidLines('sess-replay'),
    })
    await addSubagent(baseDir, '-Users-replay-sub', 'sess-replay', 'agent-rp')

    // 索引順序按 fileMtime 升冪。同時寫出的兩檔 mtime 可能相同，明確拉開才測得準
    const older = new Date('2024-06-01T10:00:00.000Z')
    const newer = new Date('2024-06-02T10:00:00.000Z')
    await utimes(path.join(baseDir, '-Users-replay-sub', 'sess-origin.jsonl'), older, older)
    await utimes(path.join(baseDir, '-Users-replay-sub', 'sess-replay.jsonl'), newer, newer)

    await runIndexer(db, undefined, baseDir, tasksDir)

    // origin 先索引 → replay 的 entries 全被跨 session 去重 → 自己沒有訊息可寫
    expect(db.getMessages('sess-origin')).toHaveLength(1)
    expect(db.getMessages('sess-replay')).toEqual([])
    // 但 subagent 的 JSONL 是獨立檔案、從沒被去重過，內容獨一無二 —— parent 的主檔
    // 恰好是別人的複本，不構成連它一起丟掉的理由
    expect(db.getMessages('sess-replay/agent-rp')).toHaveLength(1)
    // 靠一列 metadata-only 的 parent 撐住 FK
    expect(db.getAllSessionMtimes().has('sess-replay')).toBe(true)
  })

  it('parse 失敗的 session 仍保住它的 subagent', async (ctx) => {
    const baseDir = path.join(tmpDir, 'projects')
    await createProject(baseDir, '-Users-parsefail-sub', {
      'sess-ok': [{
        type: 'user', uuid: 'sess-ok-u1', timestamp: '2024-06-01T10:00:00.000Z', sessionId: 'sess-ok',
        message: { role: 'user', content: 'healthy session' },
      }],
      'sess-bad': [{
        type: 'user', uuid: 'sess-bad-u1', timestamp: '2024-06-01T10:00:00.000Z', sessionId: 'sess-bad',
        message: { role: 'user', content: 'will become unreadable' },
      }],
    })
    await addSubagent(baseDir, '-Users-parsefail-sub', 'sess-bad', 'agent-bad')

    const badPath = path.join(baseDir, '-Users-parsefail-sub', 'sess-bad.jsonl')
    await chmod(badPath, 0o000)

    // Windows 與 root 底下 chmod 擋不住讀取，那就沒有失敗可測 —— 明講跳過，不要假綠
    const stillReadable = await readFile(badPath).then(() => true, () => false)
    if (stillReadable) {
      await chmod(badPath, 0o644)
      ctx.skip()
    }

    const progresses: IndexerProgress[] = []
    await runIndexer(db, (s) => progresses.push({ ...s }), baseDir, tasksDir)
    await chmod(badPath, 0o644)

    // parent 讀不到就跳過是既有行為；但它的 subagent 是另一個檔案，可能好端端的
    expect(db.getMessages('sess-bad')).toEqual([])
    expect(db.getMessages('sess-bad/agent-bad')).toHaveLength(1)
    // 健康的 session 不該被連累
    expect(db.getMessages('sess-ok')).toHaveLength(1)
    expect(progresses.find(s => s.phase === 'done')?.skipped).toBe(1)
  })

  it('parse 失敗只是這一次讀不到：權限回來後下一輪要能自己補上', async (ctx) => {
    // 補 metadata-only parent 時若一律標上當前 summaryVersion，這個 session 就被凍結在
    // 0 訊息狀態——summaryStale 不成立、mtime 又沒變，於是再也不會被排回佇列。
    // 但權限閃斷、掛載點掉線都是會自己恢復的，那樣等於把暫時故障寫成了永久結果。
    const baseDir = path.join(tmpDir, 'projects')
    await createProject(baseDir, '-Users-parsefail-heal', {
      'sess-heal': [{
        type: 'user', uuid: 'sess-heal-u1', timestamp: '2024-06-01T10:00:00.000Z', sessionId: 'sess-heal',
        message: { role: 'user', content: 'temporarily unreadable' },
      }],
    })
    await addSubagent(baseDir, '-Users-parsefail-heal', 'sess-heal', 'agent-heal')

    const badPath = path.join(baseDir, '-Users-parsefail-heal', 'sess-heal.jsonl')
    await chmod(badPath, 0o000)

    // Windows 與 root 底下 chmod 擋不住讀取，那就沒有失敗可測 —— 明講跳過，不要假綠
    const stillReadable = await readFile(badPath).then(() => true, () => false)
    if (stillReadable) {
      await chmod(badPath, 0o644)
      ctx.skip()
    }

    await runIndexer(db, undefined, baseDir, tasksDir)
    expect(db.getMessages('sess-heal')).toEqual([])
    expect(db.getMessages('sess-heal/agent-heal')).toHaveLength(1)

    // 權限回來，檔案內容與 mtime 都沒動過
    await chmod(badPath, 0o644)
    await runIndexer(db, undefined, baseDir, tasksDir)

    expect(db.getMessages('sess-heal')).toHaveLength(1)
  })

  it('parent 已在 sessions 表裡的 replay session，subagent 照留不被誤封存', async () => {
    // 守衛的判準必須是「parent 在不在 sessions 表」，不能是「這輪有沒有走 replay 那條 continue」。
    // 寫成後者的話，這裡的 subagent 會掉出 scannedSubagentIds，被當成磁碟上消失而誤封存。
    const baseDir = path.join(tmpDir, 'projects')
    await createProject(baseDir, '-Users-replay-keep', {
      'sess-kept': sharedUuidLines('sess-kept'),
    })
    await addSubagent(baseDir, '-Users-replay-keep', 'sess-kept', 'agent-kept')

    // 第一輪：sess-kept 自己進 DB，subagent 跟著進
    await runIndexer(db, undefined, baseDir, tasksDir)
    expect(db.getMessages('sess-kept')).toHaveLength(1)
    expect(db.getMessages('sess-kept/agent-kept')).toHaveLength(1)

    // 事後才出現一個 uuid 相同、mtime 更早的 session，並讓 sess-kept 的 mtime 變新以觸發 re-index
    await createProject(baseDir, '-Users-replay-keep', { 'sess-earlier': sharedUuidLines('sess-earlier') })
    const older = new Date('2024-06-01T10:00:00.000Z')
    const newer = new Date('2024-06-02T10:00:00.000Z')
    await utimes(path.join(baseDir, '-Users-replay-keep', 'sess-earlier.jsonl'), older, older)
    await utimes(path.join(baseDir, '-Users-replay-keep', 'sess-kept.jsonl'), newer, newer)

    await runIndexer(db, undefined, baseDir, tasksDir)

    // sess-kept 這輪被去重成空走了 continue，但它本來就在 sessions 表裡
    expect(db.getMessages('sess-kept/agent-kept')).toHaveLength(1)
    expect(db.getAllSessionMtimes().get('sess-kept/agent-kept')?.archived).toBe(false)
  })

  it('純 replay 是預期行為，不灌大 skipped', async () => {
    // skipped 在 UI 上的文案是「解析失敗的 session…已跳過」。resume 過的 session 每輪
    // 都會走這條 continue，計進去等於常態顯示假警報。
    const baseDir = path.join(tmpDir, 'projects')
    await createProject(baseDir, '-Users-replay-count', {
      'sess-origin2': sharedUuidLines('sess-origin2'),
      'sess-replay2': sharedUuidLines('sess-replay2'),
    })
    const older = new Date('2024-06-01T10:00:00.000Z')
    const newer = new Date('2024-06-02T10:00:00.000Z')
    await utimes(path.join(baseDir, '-Users-replay-count', 'sess-origin2.jsonl'), older, older)
    await utimes(path.join(baseDir, '-Users-replay-count', 'sess-replay2.jsonl'), newer, newer)

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const progresses: IndexerProgress[] = []
    await runIndexer(db, (s) => progresses.push({ ...s }), baseDir, tasksDir)
    const logged = warn.mock.calls.map(c => c.join(' ')).join('\n')
    warn.mockRestore()

    expect(db.getMessages('sess-replay2')).toEqual([])
    expect(progresses.find(s => s.phase === 'done')?.skipped).toBe(0)
    // 不計數不等於不留痕跡：整輪至少要講一次有幾個 session 走了這條路
    expect(logged).toContain('replay')
  })
})

describe('runIndexer — 主 session 的 stale 封存守衛', () => {
  /** 建一個單 session 的 project，回傳 session 的 .jsonl 路徑 */
  async function createSoloSession(projectId: string, sessionId: string): Promise<string> {
    const baseDir = path.join(tmpDir, 'projects')
    await createProject(baseDir, projectId, {
      [sessionId]: [{
        type: 'user', uuid: `${sessionId}-u1`, timestamp: '2024-06-01T10:00:00.000Z', sessionId,
        message: { role: 'user', content: 'main session' },
      }],
    })
    return path.join(baseDir, projectId, `${sessionId}.jsonl`)
  }

  it('檔案真的從磁碟消失時仍會封存（守衛不能把正常行為一起擋掉）', async () => {
    const baseDir = path.join(tmpDir, 'projects')
    const goneFile = await createSoloSession('-Users-main-gone', 'sess-gone')
    await createSoloSession('-Users-main-stay', 'sess-stay')

    await runIndexer(db, undefined, baseDir, tasksDir)
    expect(db.getAllSessionMtimes().get('sess-gone')?.archived).toBe(false)

    await rm(goneFile)
    await runIndexer(db, undefined, baseDir, tasksDir)

    expect(db.getAllSessionMtimes().get('sess-gone')?.archived).toBe(true)
    expect(db.getAllSessionMtimes().get('sess-stay')?.archived).toBe(false)
  })

  it('projects 目錄還在、只是被清空了 → 照樣封存', async () => {
    // 與下一條的差別只在「root 還在不在」。擋著不封存的話掃描結果每輪都一樣，
    // 那些 row 會永遠停在活躍狀態，再也沒有機會被更正。
    const baseDir = path.join(tmpDir, 'projects')
    await createSoloSession('-Users-main-emptied', 'sess-emptied')
    await runIndexer(db, undefined, baseDir, tasksDir)
    expect(db.getAllSessionMtimes().get('sess-emptied')?.archived).toBe(false)

    // 使用者真的把 session 清光，但 ~/.claude/projects 本身還在
    await rm(path.join(baseDir, '-Users-main-emptied'), { recursive: true })
    await runIndexer(db, undefined, baseDir, tasksDir)

    expect(db.getAllSessionMtimes().get('sess-emptied')?.archived).toBe(true)
  })

  it('projects 目錄整個不見時不封存任何主 session', async () => {
    const baseDir = path.join(tmpDir, 'projects')
    await createSoloSession('-Users-main-wipe', 'sess-wipe')
    await runIndexer(db, undefined, baseDir, tasksDir)
    expect(db.getAllSessionMtimes().get('sess-wipe')?.archived).toBe(false)

    // baseDir 整個讀不到：掃描結果全空，與「使用者刪光了」在資料上無從分辨
    await rm(baseDir, { recursive: true })
    await runIndexer(db, undefined, baseDir, tasksDir)

    expect(db.getAllSessionMtimes().get('sess-wipe')?.archived).toBe(false)
  })

  it('某個 project 目錄讀不到時不封存它底下的主 session', async (ctx) => {
    // subagent 那層擋掉的同款上游漏洞：project 讀不到時 scanner 直接 continue，
    // 它底下的 session 一個都不會進 scannedSessionIds，別的 project 掃得到又讓
    // 總數非零 —— 只看數量的守衛會放行，然後把讀不到的那批全封存。
    const baseDir = path.join(tmpDir, 'projects')
    await createSoloSession('-Users-main-projfail', 'sess-mpf')
    await createSoloSession('-Users-main-projok', 'sess-mpok')
    await runIndexer(db, undefined, baseDir, tasksDir)
    expect(db.getAllSessionMtimes().get('sess-mpf')?.archived).toBe(false)

    const badProject = path.join(baseDir, '-Users-main-projfail')
    await chmod(badProject, 0o000)

    // Windows 與 root 底下 chmod 擋不住讀取，那就沒有失敗可測 —— 明講跳過，不要假綠
    const stillReadable = await readdir(badProject).then(() => true, () => false)
    if (stillReadable) {
      await chmod(badProject, 0o755)
      ctx.skip()
    }

    const progresses: IndexerProgress[] = []
    await runIndexer(db, (s) => progresses.push({ ...s }), baseDir, tasksDir)
    await chmod(badProject, 0o755)

    expect(db.getAllSessionMtimes().get('sess-mpf')?.archived).toBe(false)
    expect(db.getAllSessionMtimes().get('sess-mpok')?.archived).toBe(false)
    expect(progresses.find(s => s.phase === 'done')?.skipped).toBe(1)
  })
})
