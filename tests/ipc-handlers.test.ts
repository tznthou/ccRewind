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
  })

  afterEach(() => {
    db.close()
  })

  describe('registerIpcHandlers', () => {
    it('registers all required channels', () => {
      registerIpcHandlers(db)
      const channels = vi.mocked(ipcMain.handle).mock.calls.map(c => c[0])
      expect(channels).toContain('projects:list')
      expect(channels).toContain('sessions:list')
      expect(channels).toContain('session:load')
      expect(channels).toContain('search:query')
    })
  })

  describe('projects:list', () => {
    it('returns project list from database', () => {
      seedData(db)
      registerIpcHandlers(db)
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
      registerIpcHandlers(db)
      const handler = getHandler('projects:list')
      expect(handler(event)).toEqual([])
    })
  })

  describe('sessions:list', () => {
    it('returns sessions for given project', () => {
      seedData(db)
      registerIpcHandlers(db)
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
      registerIpcHandlers(db)
      const handler = getHandler('sessions:list')
      expect(handler(event, 'nonexistent')).toEqual([])
    })
  })

  describe('session:load', () => {
    it('returns messages ordered by sequence', () => {
      seedData(db)
      registerIpcHandlers(db)
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
      registerIpcHandlers(db)
      const handler = getHandler('session:load')
      expect(handler(event, 'invalid-id')).toEqual([])
    })
  })

  describe('search:query', () => {
    it('returns search results for matching query', () => {
      seedData(db)
      registerIpcHandlers(db)
      const handler = getHandler('search:query')
      const result = handler(event, 'Hello')
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(expect.objectContaining({
        sessionId: 'sess-1',
        projectId: 'proj-1',
      }))
    })

    it('returns empty array for no matches', () => {
      seedData(db)
      registerIpcHandlers(db)
      const handler = getHandler('search:query')
      expect(handler(event, 'nonexistent-xyz-query')).toEqual([])
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

      registerIpcHandlers(db)
      const handler = getHandler('search:query')
      const result = handler(event, 'Hello', 'proj-2')
      expect(result).toHaveLength(1)
      expect(result[0].projectId).toBe('proj-2')
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
