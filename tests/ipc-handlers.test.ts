import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

// Mock electron — 必須在 import ipc-handlers 之前
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}))

import { ipcMain, BrowserWindow } from 'electron'
import { Database, type MessageInput } from '../src/main/database'
import { registerIpcHandlers, sendIndexerStatus } from '../src/main/ipc-handlers'

/** 取得某 channel 註冊的 handler callback */
function getHandler(channel: string) {
  const calls = vi.mocked(ipcMain.handle).mock.calls
  const call = calls.find(c => c[0] === channel)
  if (!call) throw new Error(`Handler not registered for channel: ${channel}`)
  return call[1]
}

/** DRY helper：建立測試用 MessageInput */
function msg(overrides: Partial<MessageInput> & Pick<MessageInput, 'type' | 'role' | 'sequence'>): MessageInput {
  return {
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

/** 建立標準測試資料：1 project + 1 session + 2 messages */
function seedData(db: Database) {
  db.indexSession({
    sessionId: 'sess-1',
    projectId: 'proj-1',
    projectDisplayName: '/home/user/project-a',
    title: 'Test session',
    messageCount: 2,
    filePath: '/fake/path/sess-1.jsonl',
    fileSize: 1000,
    fileMtime: '2026-01-01T00:00:00Z',
    startedAt: '2026-01-01T00:00:00Z',
    endedAt: '2026-01-01T01:00:00Z',
    messages: [
      msg({ type: 'user', role: 'user', contentText: 'Hello world', timestamp: '2026-01-01T00:00:00Z', sequence: 0 }),
      msg({ type: 'assistant', role: 'assistant', contentText: 'Hi there', timestamp: '2026-01-01T00:30:00Z', sequence: 1 }),
    ],
  })
  db.updateProjectStats('proj-1')
}

describe('IPC Handlers', () => {
  let db: Database
  const event = {} as IpcMainInvokeEvent

  beforeEach(() => {
    vi.clearAllMocks()
    db = new Database(':memory:')
    registerIpcHandlers(db)
  })

  afterEach(() => {
    db.close()
  })

  describe('registerIpcHandlers', () => {
    it('registers all required channels', () => {
      const channels = vi.mocked(ipcMain.handle).mock.calls.map(c => c[0])
      expect(channels).toContain('projects:list')
      expect(channels).toContain('sessions:list')
      expect(channels).toContain('session:load')
      expect(channels).toContain('search:query')
      expect(channels).toContain('storage:overview')
      expect(channels).toContain('storage:preview')
      expect(channels).toContain('storage:apply')
      expect(channels).toContain('storage:remove-rule')
    })
  })

  describe('projects:list', () => {
    it('returns project list from database', () => {
      seedData(db)
      const handler = getHandler('projects:list')
      const result = handler(event)
      expect(result).toEqual([
        expect.objectContaining({
          id: 'proj-1',
          displayName: '/home/user/project-a',
          sessionCount: 1,
        }),
      ])
    })

    it('returns empty array when no projects', () => {
      const handler = getHandler('projects:list')
      expect(handler(event)).toEqual([])
    })
  })

  describe('sessions:list', () => {
    it('returns sessions for given project', () => {
      seedData(db)
      const handler = getHandler('sessions:list')
      const result = handler(event, 'proj-1')
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(expect.objectContaining({
        id: 'sess-1',
        title: 'Test session',
        messageCount: 2,
      }))
    })

    it('returns empty array for nonexistent project', () => {
      const handler = getHandler('sessions:list')
      expect(handler(event, 'nonexistent')).toEqual([])
    })
  })

  describe('session:load', () => {
    it('returns messages ordered by sequence', () => {
      seedData(db)
      const handler = getHandler('session:load')
      const result = handler(event, 'sess-1')
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual(expect.objectContaining({
        type: 'user',
        contentText: 'Hello world',
        sequence: 0,
      }))
      expect(result[1]).toEqual(expect.objectContaining({
        type: 'assistant',
        contentText: 'Hi there',
        sequence: 1,
      }))
    })

    it('returns empty array for invalid session id', () => {
      const handler = getHandler('session:load')
      expect(handler(event, 'invalid-id')).toEqual([])
    })
  })

  describe('search:query', () => {
    it('returns search results for matching query', () => {
      seedData(db)
      const handler = getHandler('search:query')
      const page = handler(event, 'Hello')
      expect(page.results).toHaveLength(1)
      expect(page.results[0]).toEqual(expect.objectContaining({
        sessionId: 'sess-1',
        projectId: 'proj-1',
      }))
    })

    it('returns empty page for no matches', () => {
      seedData(db)
      const handler = getHandler('search:query')
      const page = handler(event, 'nonexistent-xyz-query')
      expect(page.results).toEqual([])
      expect(page.hasMore).toBe(false)
    })

    it('filters by project when projectId provided', () => {
      seedData(db)
      db.indexSession({
        sessionId: 'sess-2',
        projectId: 'proj-2',
        projectDisplayName: '/home/user/project-b',
        title: 'Second session',
        messageCount: 1,
        filePath: '/fake/path/sess-2.jsonl',
        fileSize: 500,
        fileMtime: '2026-01-02T00:00:00Z',
        startedAt: '2026-01-02T00:00:00Z',
        endedAt: '2026-01-02T01:00:00Z',
        messages: [
          msg({ type: 'user', role: 'user', contentText: 'Hello from project b', timestamp: '2026-01-02T00:00:00Z', sequence: 0 }),
        ],
      })

      const handler = getHandler('search:query')
      const page = handler(event, 'Hello', 'proj-2')
      expect(page.results).toHaveLength(1)
      expect(page.results[0].projectId).toBe('proj-2')
    })
  })

  // ── v1.9.0: 儲存管理 handlers ──

  describe('storage:overview', () => {
    it('returns aggregated { stats, projects, inactiveSessions, rules }', () => {
      seedData(db)
      const handler = getHandler('storage:overview')
      const result = handler(event)
      expect(result.stats.sessionCount).toBe(1)
      expect(result.stats.messageCount).toBe(2)
      expect(Array.isArray(result.projects)).toBe(true)
      expect(result.projects[0].projectId).toBe('proj-1')
      expect(Array.isArray(result.inactiveSessions)).toBe(true)
      expect(result.rules).toEqual([])
    })

    it('threshold 0 marks all sessions as inactive', () => {
      seedData(db)
      const handler = getHandler('storage:overview')
      const result = handler(event, 0)
      expect(result.inactiveSessions.length).toBeGreaterThan(0)
    })

    it('invalid thresholdDays falls back to default (no throw)', () => {
      seedData(db)
      const handler = getHandler('storage:overview')
      expect(() => handler(event, -1)).not.toThrow()
      expect(() => handler(event, 'bad')).not.toThrow()
      expect(() => handler(event, 3.14)).not.toThrow()
    })
  })

  describe('storage:preview', () => {
    it('returns non-zero preview for matching rule', () => {
      seedData(db)
      const handler = getHandler('storage:preview')
      const preview = handler(event, { projectId: 'proj-1', dateFrom: null, dateTo: null })
      expect(preview.sessionCount).toBe(1)
      expect(preview.messageCount).toBe(2)
    })

    it('returns zero for rule matching nothing', () => {
      seedData(db)
      const handler = getHandler('storage:preview')
      const preview = handler(event, { projectId: 'no-such-proj', dateFrom: null, dateTo: null })
      expect(preview).toEqual({ sessionCount: 0, messageCount: 0, estimatedBytes: 0 })
    })

    it('throws on non-object input', () => {
      const handler = getHandler('storage:preview')
      expect(() => handler(event, null)).toThrow(/Invalid exclusion rule input/)
      expect(() => handler(event, 'not-an-object')).toThrow(/Invalid exclusion rule input/)
    })

    it('throws on wrong-type field', () => {
      const handler = getHandler('storage:preview')
      expect(() => handler(event, { projectId: 123, dateFrom: null, dateTo: null })).toThrow(/string or null/)
    })

    it('throws when all fields are null (DB normalizeRule rejects empty rule)', () => {
      const handler = getHandler('storage:preview')
      expect(() => handler(event, { projectId: null, dateFrom: null, dateTo: null })).toThrow(/at least one/)
    })
  })

  describe('storage:apply', () => {
    it('returns { rule, releasedBytes, vacuumed } and hard-deletes matched sessions', () => {
      seedData(db)
      const handler = getHandler('storage:apply')
      const result = handler(event, { projectId: 'proj-1', dateFrom: null, dateTo: null })
      expect(result.rule.projectId).toBe('proj-1')
      expect(typeof result.releasedBytes).toBe('number')
      expect(typeof result.vacuumed).toBe('boolean')
      expect(db.getMessages('sess-1')).toEqual([])
      expect(db.getExclusionRules()).toHaveLength(1)
    })
  })

  describe('storage:remove-rule', () => {
    it('removes the rule by id', () => {
      seedData(db)
      const applyHandler = getHandler('storage:apply')
      const { rule } = applyHandler(event, { projectId: 'proj-1', dateFrom: null, dateTo: null })
      expect(db.getExclusionRules()).toHaveLength(1)

      const removeHandler = getHandler('storage:remove-rule')
      removeHandler(event, rule.id)
      expect(db.getExclusionRules()).toEqual([])
    })

    it('throws on non-integer or negative id', () => {
      const handler = getHandler('storage:remove-rule')
      expect(() => handler(event, 'not-a-number')).toThrow(/Invalid rule id/)
      expect(() => handler(event, -1)).toThrow(/Invalid rule id/)
      expect(() => handler(event, 1.5)).toThrow(/Invalid rule id/)
    })
  })

  describe('sendIndexerStatus', () => {
    it('broadcasts status to all windows', () => {
      const mockSend = vi.fn()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
        { webContents: { send: mockSend } } as unknown as Electron.BrowserWindow,
      ])

      const status = { phase: 'indexing' as const, progress: 50, total: 10, current: 5 }
      sendIndexerStatus(status)
      expect(mockSend).toHaveBeenCalledWith('indexer:status', status)
    })

    it('handles no windows gracefully', () => {
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
      expect(() => sendIndexerStatus({
        phase: 'done', progress: 100, total: 0, current: 0,
      })).not.toThrow()
    })
  })
})
