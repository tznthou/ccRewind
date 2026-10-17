import { describe, it, expect, vi, beforeAll } from 'vitest'
import type { ElectronAPI } from '../src/shared/types'

// preload 轉送參數用的是 invoke(channel, ...args: any[])，少轉一個參數型別檢查抓不到；
// 儀表板的 days 漏掉時 handler 會用預設 30 天，剛好等於畫面的預設區間，截圖也看不出來
const { invoke, exposeInMainWorld } = vi.hoisted(() => ({ invoke: vi.fn(), exposeInMainWorld: vi.fn() }))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke, on: vi.fn(), removeListener: vi.fn() },
}))

let api: ElectronAPI

beforeAll(async () => {
  await import('../src/preload/index')
  api = exposeInMainWorld.mock.calls[0][1] as ElectronAPI
})

describe('preload: dashboard range APIs', () => {
  it.each([
    ['getUsageStats', 'stats:usage'],
    ['getToolDistribution', 'stats:tools'],
    ['getTagDistribution', 'stats:tags'],
    ['getWorkPatterns', 'stats:patterns'],
    ['getEfficiencyTrend', 'stats:efficiency'],
  ] as const)('%s forwards the project and the days to %s', async (method, channel) => {
    await api[method]('proj-1', 7)
    expect(invoke).toHaveBeenLastCalledWith(channel, 'proj-1', 7)
    await api[method](null, 0)
    expect(invoke).toHaveBeenLastCalledWith(channel, null, 0)
  })
})
