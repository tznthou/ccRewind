import { describe, it, expect } from 'vitest'
import { computeTokenHeat, type HeatMessage } from '../../src/renderer/components/ChatView/tokenHeat'

let nextId = 1

/** inputTokens 是那次呼叫的整個 context（input + 快取讀 + 快取寫，見 parser 的 parseUsage） */
function assistant(inputTokens: number | null, cacheReadTokens: number | null = 0): HeatMessage {
  return { id: nextId++, role: 'assistant', inputTokens, cacheReadTokens }
}

function user(): HeatMessage {
  return { id: nextId++, role: 'user', inputTokens: null, cacheReadTokens: null }
}

describe('computeTokenHeat', () => {
  // 真實 DB（10-17）：主 session 有 78 場因此把整場最熱的標記標在 <synthetic> 的下一則
  it('用量全 0 的列（<synthetic>）不當成比較基準，下一則不會變成整場最熱', () => {
    const first = assistant(10_000)
    const synthetic = assistant(0, 0)
    const next = assistant(10_500)
    const heat = computeTokenHeat([first, user(), synthetic, user(), next])

    expect(heat.get(next.id)?.intensity).toBe(500 / 10_000)
    expect(heat.get(first.id)?.intensity).toBe(1)
    expect(heat.has(synthetic.id)).toBe(false)
  })

  it('沒有用量資料（null）的列也略過', () => {
    const first = assistant(10_000)
    const noUsage = assistant(null, null)
    const next = assistant(10_500)
    const heat = computeTokenHeat([first, noUsage, next])

    expect(heat.get(next.id)?.intensity).toBe(500 / 10_000)
    expect(heat.has(noUsage.id)).toBe(false)
  })

  it('強度是相對整場最大成長量的比例，context 變小算 0', () => {
    const a = assistant(1_000)
    const b = assistant(3_000)
    const c = assistant(2_500)
    const heat = computeTokenHeat([a, b, c])

    expect(heat.get(a.id)?.intensity).toBe(0.5)
    expect(heat.get(b.id)?.intensity).toBe(1)
    expect(heat.get(c.id)?.intensity).toBe(0)
  })

  it('快取讀取超過 context 的一半才算 cacheGood', () => {
    const good = assistant(1_000, 501)
    const half = assistant(1_000, 500)
    const heat = computeTokenHeat([good, half])

    expect(heat.get(good.id)?.cacheGood).toBe(true)
    expect(heat.get(half.id)?.cacheGood).toBe(false)
  })

  it('沒有任何用量資料時回傳空的 Map', () => {
    expect(computeTokenHeat([user(), assistant(null, null), assistant(0, 0)]).size).toBe(0)
  })
})
