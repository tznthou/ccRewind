import path from 'node:path'
import { describe, it, expect, vi, afterAll } from 'vitest'

// index.ts 是 Electron 入口: 一 import 就跑啟動流程(whenReady → 開 DB、註冊 IPC、建主視窗、掛 activate)。
// electron、DB、IPC、indexer、建視窗都換成假的就載得進來, 驗它把這些接在一起的方式。
// macOS 從 Dock 重開的視窗靠的就是 activate 那一行: 傳錯 reindex、或拿掉「沒有視窗才建」, 其他測試都不會紅
const h = vi.hoisted(() => {
  const handlers: Record<string, Array<() => void>> = {}
  let resolveReady: () => void = () => {}
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })
  return { handlers, ready, resolveReady: () => resolveReady(), windows: [] as unknown[] }
})

// DB 路徑走 os.homedir(): 指到暫存路徑, 萬一哪天拿掉 Database 的 mock 也碰不到真的 ~/.ccrewind
const fakeHome = await vi.hoisted(async () => {
  const os = await import('node:os')
  const nodePath = await import('node:path')
  const home = nodePath.join(os.tmpdir(), `ccrewind-index-test-${process.pid}`)
  vi.stubEnv('HOME', home)
  vi.stubEnv('USERPROFILE', home)
  return home
})

vi.mock('electron', () => ({
  app: {
    isPackaged: true, // 不走只在開發中才加的 CSP
    whenReady: () => h.ready,
    on: (event: string, handler: () => void) => {
      ;(h.handlers[event] ??= []).push(handler)
    },
    quit: vi.fn(),
  },
  BrowserWindow: { getAllWindows: () => h.windows },
  session: { defaultSession: { webRequest: { onHeadersReceived: vi.fn() } } },
}))
vi.mock('../src/main/database', () => ({
  Database: vi.fn(function (this: { close: () => void }) {
    this.close = vi.fn()
  }),
}))
vi.mock('../src/main/ipc-handlers', () => ({ registerIpcHandlers: vi.fn(), sendIndexerStatus: vi.fn() }))
vi.mock('../src/main/indexer', () => ({ triggerIndexer: vi.fn(() => Promise.resolve()) }))
vi.mock('../src/main/mainWindow', () => ({ createMainWindow: vi.fn() }))

import { Database } from '../src/main/database'
import { registerIpcHandlers, sendIndexerStatus } from '../src/main/ipc-handlers'
import { triggerIndexer } from '../src/main/indexer'
import { createMainWindow, type ReindexTrigger } from '../src/main/mainWindow'
import '../src/main/index'

afterAll(() => {
  vi.unstubAllEnvs()
})

function reindexPassedTo(call: number): (trigger: ReindexTrigger) => void {
  return vi.mocked(createMainWindow).mock.calls[call][0]
}

// 同一次 app 啟動, 依序跑(index.ts 只會 import 一次)
describe('index.ts start-up wiring', () => {
  it('does nothing before the app is ready, not even listening for activate', () => {
    expect(Database).not.toHaveBeenCalled()
    expect(createMainWindow).not.toHaveBeenCalled()
    expect(h.handlers.activate).toBeUndefined()
  })

  it('opens the database under the home directory, registers IPC and creates the main window once ready', async () => {
    h.resolveReady()
    await h.ready
    expect(Database).toHaveBeenCalledWith(path.join(fakeHome, '.ccrewind', 'index.db'))
    expect(registerIpcHandlers).toHaveBeenCalledWith(vi.mocked(Database).mock.instances[0])
    expect(createMainWindow).toHaveBeenCalledTimes(1)
    expect(reindexPassedTo(0)).toBeTypeOf('function')
  })

  it('indexes through triggerIndexer with the database and the status sender', () => {
    reindexPassedTo(0)('load')
    expect(triggerIndexer).toHaveBeenCalledWith(vi.mocked(Database).mock.instances[0], sendIndexerStatus)
  })

  it('logs a failed index, with a message for each trigger, instead of leaving the rejection unhandled', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(triggerIndexer).mockRejectedValueOnce(new Error('scan failed'))
    reindexPassedTo(0)('load')
    vi.mocked(triggerIndexer).mockRejectedValueOnce(new Error('scan failed'))
    reindexPassedTo(0)('focus')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(error.mock.calls.map((args) => args[0])).toEqual(['Indexer failed:', 'Focus reindex failed:'])
    error.mockRestore()
  })

  // macOS: 關掉最後一個視窗 app 還在, 點 Dock 由 activate 重建; 重建的視窗要拿到同一個 reindex 才會索引
  it('on activate creates a window only when none is open, with the same reindex', () => {
    expect(h.handlers.activate).toHaveLength(1)
    h.windows.push({})
    h.handlers.activate[0]()
    expect(createMainWindow).toHaveBeenCalledTimes(1)
    h.windows.length = 0
    h.handlers.activate[0]()
    expect(createMainWindow).toHaveBeenCalledTimes(2)
    expect(reindexPassedTo(1)).toBe(reindexPassedTo(0))
  })
})
