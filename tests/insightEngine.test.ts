import { describe, it, expect } from 'vitest'
import {
  compactedCallIndexes,
  contextWindowEvidence,
  findCacheBreaks,
} from '../src/renderer/components/TokenBudget/insightEngine'
import type { SessionTokenStats } from '../src/shared/types'
import { call, makeStats, makeTurn } from './fixtures/tokenStats'

// ── Helpers ──

/** 規則層：這場的快取中斷（壓縮後第一次呼叫已排除） */
function breaksOf(turns: SessionTokenStats['turns'], compactions: SessionTokenStats['compactions'] = []) {
  return findCacheBreaks(turns, compactedCallIndexes(turns, compactions))
}

// ── Tests ──
describe('insightEngine', () => {
  // 視窗大小只認一條證據：任一次呼叫超過 200K，視窗就一定是 1M。模型名不算（同模型同月既有 >200K、也有 17 萬就壓縮的），
  // 壓縮貼著 165–170K 也不算（2026-10-15 實測：從未 >200K 的壓縮落在 160–165K 的比 165–170K 還多）
  describe('contextWindowEvidence', () => {
    it('is not evidence when no call exceeds 200K — exactly 200K is not over', () => {
      const turns = [
        makeTurn({ sequence: 1, contextTotal: 100_000 }),
        makeTurn({ sequence: 2, contextTotal: 200_000 }),
      ]
      expect(contextWindowEvidence(turns)).toBeNull()
    })

    it('is evidence of a 1M window from the first token over 200K', () => {
      expect(contextWindowEvidence([makeTurn({ sequence: 1, contextTotal: 200_001 })])).toBe('1m')
    })

    it('keeps the evidence after the context shrinks again', () => {
      const turns = [
        makeTurn({ sequence: 1, contextTotal: 100_000 }),
        makeTurn({ sequence: 2, contextTotal: 250_000 }),
        makeTurn({ sequence: 3, contextTotal: 180_000 }),
      ]
      expect(contextWindowEvidence(turns)).toBe('1m')
    })

    it('has no evidence for an empty session', () => {
      expect(contextWindowEvidence([])).toBeNull()
    })

    it('does not take the model name as evidence', () => {
      for (const model of ['claude-opus-4-6', 'claude-fable-5', 'claude-3-5-sonnet-20241022']) {
        expect(contextWindowEvidence([makeTurn({ sequence: 1, contextTotal: 100_000, model })])).toBeNull()
      }
    })
  })

  // 命中率 >70% 的「運作良好」與 <30% 的「僅 N%」已移除: 2026-09-30 實測 1,707 個 session 有 93.3% 被判良好,
  // 整段重寫 0–9 次的 session 全部判良好, 「僅 N%」的 28 個有 27 個只有 1–2 次呼叫(第一次呼叫本來就要寫快取)。
  // 命中率吃對話長度, 分不出快取有沒有壞掉; 改看「整段重寫」。
  it('still catches a rewrite in a session whose overall hit rate is above 90%', () => {
    let ctx = 100_000
    let rewritten = 0
    const turns = [call({ sequence: 1, ctx, read: 0, write: ctx, minute: 0 })]
    for (let i = 1; i <= 30; i++) {
      const prev = ctx
      ctx += 1_000
      if (i === 15) {
        // 離開 90 分鐘回來: 上一次的整段 prompt 都得重寫(多出來的 1K 是新內容，本來就要寫)
        rewritten = prev
        turns.push(call({ sequence: i + 1, ctx, read: 0, write: ctx, minute: i + 90 }))
      } else {
        // 其餘每次都讀到上一次的整段 prompt
        turns.push(call({ sequence: i + 1, ctx, read: prev, write: 1_000, minute: i + (i > 15 ? 90 : 0) }))
      }
    }
    const stats = makeStats(turns)
    expect(stats.cacheHitRate).toBeGreaterThan(0.9)
    expect(breaksOf(turns)).toEqual([{ turn: 16, cause: 'idle_expired', gapMinutes: 105 - 14, rewrittenTokens: rewritten }])
  })

  describe('Cache Breaks', () => {
    // a8874a38 的形狀: 218 次呼叫, 每次都讀得到上一次的整段 prompt
    it('emits nothing when every call reads the previous prompt from cache', () => {
      const turns = [
        call({ sequence: 1, ctx: 100_000, read: 0, write: 100_000, minute: 0 }),
        call({ sequence: 2, ctx: 101_000, read: 100_000, write: 1_000, minute: 1 }),
        call({ sequence: 3, ctx: 102_000, read: 101_000, write: 1_000, minute: 2 }),
      ]
      expect(breaksOf(turns)).toEqual([])
    })

    it('reports an idle expiry: gap and rewritten tokens', () => {
      const turns = [
        call({ sequence: 1, ctx: 100_000, read: 90_000, write: 10_000, minute: 0 }),
        call({ sequence: 2, ctx: 105_000, read: 0, write: 105_000, minute: 75 }),
      ]
      // 寫入 105K，但只有上一次的 100K 是因為過期才重寫；多出的 5K 是這次新增的
      expect(breaksOf(turns)).toEqual([{ turn: 2, cause: 'idle_expired', gapMinutes: 75, rewrittenTokens: 100_000 }])
    })

    // 重寫量＝快取沒斷的話本來讀得到的舊內容(上一次的 prompt 這次沒讀到的部分)。
    // 這次新增的內容本來就要寫入，不是中斷的代價；也不會超過這次實際寫入的量
    it.each<[string, { ctx: number; read: number; write: number }, { ctx: number; read: number; write: number }, number]>([
      ['a large paste on return is new content, not rewritten', { ctx: 10_000, read: 9_000, write: 1_000 }, { ctx: 100_000, read: 0, write: 100_000 }, 10_000],
      ['what was still read is not rewritten', { ctx: 100_000, read: 90_000, write: 10_000 }, { ctx: 105_000, read: 20_000, write: 85_000 }, 80_000],
      ['no more than was actually written', { ctx: 100_000, read: 90_000, write: 10_000 }, { ctx: 90_000, read: 0, write: 85_000 }, 85_000],
    ])('counts only the previous prompt as rewritten: %s', (_label, before, after, rewritten) => {
      const turns = [
        call({ sequence: 1, ...before, minute: 0 }),
        call({ sequence: 2, ...after, minute: 120 }),
      ]
      expect(breaksOf(turns)).toEqual([{ turn: 2, cause: 'idle_expired', gapMinutes: 120, rewrittenTokens: rewritten }])
    })

    it('draws the idle line at 60 minutes (>= 60 expired, 59 is not)', () => {
      const pair = (gap: number) => [
        call({ sequence: 1, ctx: 100_000, read: 90_000, write: 10_000, minute: 0 }),
        call({ sequence: 2, ctx: 100_500, read: 0, write: 100_500, minute: gap }),
      ]
      expect(breaksOf(pair(59)).map(b => b.cause)).toEqual(['unknown'])
      expect(breaksOf(pair(60)).map(b => b.cause)).toEqual(['idle_expired'])
    })

    it('attributes a rewrite to a model switch, even when the gap is also long', () => {
      const turns = [
        call({ sequence: 1, ctx: 100_000, read: 90_000, write: 10_000, minute: 0, model: 'claude-opus-4-6' }),
        call({ sequence: 2, ctx: 100_500, read: 0, write: 100_500, minute: 90, model: 'claude-sonnet-4-6' }),
      ]
      expect(breaksOf(turns).map(b => b.cause)).toEqual(['model_switch'])
    })

    it('does not call it a model switch when a model is unknown', () => {
      const turns = [
        call({ sequence: 1, ctx: 100_000, read: 90_000, write: 10_000, minute: 0, model: 'claude-opus-4-6' }),
        call({ sequence: 2, ctx: 100_500, read: 0, write: 100_500, minute: 1, model: null }),
      ]
      expect(breaksOf(turns).map(b => b.cause)).toEqual(['unknown'])
    })

    it('is not a rewrite when at least half of the previous prompt was still read', () => {
      const turns = [
        call({ sequence: 1, ctx: 100_000, read: 90_000, write: 10_000, minute: 0 }),
        call({ sequence: 2, ctx: 101_000, read: 60_000, write: 41_000, minute: 1 }),
      ]
      expect(breaksOf(turns)).toEqual([])
    })

    // MiniMax 等沒有 prompt caching 的供應商: 每次呼叫讀 0 寫 0(2026-03 的 7c9cb866 命中率 0%), 從頭到尾沒有快取可以「中斷」
    it('does not treat a provider without prompt caching as a string of cache breaks', () => {
      const turns = [
        call({ sequence: 1, ctx: 10_000, minute: 0 }),
        call({ sequence: 2, ctx: 12_000, minute: 1 }),
        call({ sequence: 3, ctx: 14_000, minute: 2 }),
      ]
      expect(breaksOf(turns)).toEqual([])
    })

    // 上一次沒有任何快取活動(prompt 太短、或剛從不支援快取的供應商換過來), 這一次第一次寫入: 之前沒有東西可以「斷」
    it('does not count the first time anything gets cached as a break', () => {
      const turns = [
        call({ sequence: 1, ctx: 3_000, read: 0, write: 0, minute: 0 }),
        call({ sequence: 2, ctx: 4_000, read: 0, write: 4_000, minute: 1 }),
      ]
      expect(breaksOf(turns)).toEqual([])
    })

    it('needs something to have been written: a prompt too short to cache is not a rewrite', () => {
      const turns = [
        call({ sequence: 1, ctx: 100_000, read: 90_000, write: 10_000, minute: 0 }),
        call({ sequence: 2, ctx: 100_500, read: 0, write: 0, minute: 90 }),
      ]
      expect(breaksOf(turns)).toEqual([])
    })

    it('is not a rewrite when the prompt shrank (rewind / trimmed history) — nothing was re-sent', () => {
      const turns = [
        call({ sequence: 1, ctx: 100_000, read: 90_000, write: 10_000, minute: 0 }),
        call({ sequence: 2, ctx: 70_000, read: 30_000, write: 40_000, minute: 1 }),
      ]
      expect(breaksOf(turns)).toEqual([])
    })

    // 壓縮後的第一次呼叫本來就要整段重寫; 就算 prompt 沒縮小(實測有 2 則小對話如此)也不能算快取中斷
    it('does not count the call right after a compaction as a cache break', () => {
      const turns = [
        call({ sequence: 10, ctx: 150_000, read: 140_000, write: 10_000, minute: 0 }),
        call({ sequence: 30, ctx: 149_000, read: 0, write: 149_000, minute: 6 }),
      ]
      const compactions = [{ sequence: 20 }]
      expect(breaksOf(turns, compactions)).toEqual([])
      expect([...compactedCallIndexes(turns, compactions)]).toEqual([1])
    })
  })
})
