import { describe, it, expect } from 'vitest'
import { detectContextPlan, generateInsights } from '../src/renderer/components/TokenBudget/insightEngine'
import type { SessionTokenStats } from '../src/shared/types'

// ── Helpers ──

function makeTurn(
  overrides: Partial<SessionTokenStats['turns'][0]> & { sequence: number },
): SessionTokenStats['turns'][0] {
  return {
    timestamp: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    contextTotal: 0,
    hasToolUse: false,
    toolNames: [],
    model: null,
    ...overrides,
  }
}

function makeStats(
  turns: SessionTokenStats['turns'],
  overrides?: Partial<Omit<SessionTokenStats, 'turns'>>,
): SessionTokenStats {
  const totalInput = turns.reduce((s, t) => s + t.inputTokens, 0)
  const totalOutput = turns.reduce((s, t) => s + t.outputTokens, 0)
  const totalCacheRead = turns.reduce((s, t) => s + t.cacheReadTokens, 0)
  const totalCacheCreation = turns.reduce((s, t) => s + t.cacheCreationTokens, 0)
  const cacheHitRate = totalInput > 0 ? totalCacheRead / totalInput : 0

  return {
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalCacheReadTokens: totalCacheRead,
    totalCacheCreationTokens: totalCacheCreation,
    cacheHitRate,
    models: ['claude-sonnet-4-20250514'],
    primaryModel: 'claude-sonnet-4-20250514',
    turns,
    compactions: [],
    ...overrides,
  }
}

/** 基準時間 + N 分鐘 */
function ts(minutes: number): string {
  return new Date(Date.UTC(2026, 8, 25, 0, 0) + minutes * 60_000).toISOString()
}

/** 一次 API 呼叫: ctx = 整段 prompt(input + 讀 + 寫), read/write 是其中快取讀寫的部分 */
function call(o: {
  sequence: number
  ctx: number
  read?: number
  write?: number
  minute?: number
  model?: string | null
  tools?: string[]
  output?: number
}): SessionTokenStats['turns'][0] {
  const tools = o.tools ?? []
  return makeTurn({
    sequence: o.sequence,
    inputTokens: o.ctx,
    contextTotal: o.ctx,
    cacheReadTokens: o.read ?? 0,
    cacheCreationTokens: o.write ?? 0,
    outputTokens: o.output ?? 0,
    timestamp: o.minute == null ? null : ts(o.minute),
    model: o.model ?? null,
    hasToolUse: tools.length > 0,
    toolNames: tools,
  })
}

// ── Tests ──

describe('insightEngine', () => {
  describe('Context Spike Detection', () => {
    it('detects spike when delta > 20K', () => {
      const turns = [
        makeTurn({ sequence: 1, inputTokens: 10_000, contextTotal: 10_000 }),
        makeTurn({ sequence: 2, inputTokens: 35_000, contextTotal: 35_000 }),
      ]
      const insights = generateInsights(makeStats(turns))
      const spike = insights.find(i => i.id.startsWith('spike-'))
      expect(spike).toBeDefined()
      expect(spike!.severity).toBe('warning')
      expect(spike!.data).toMatchObject({ type: 'context_spike', turn: 2, deltaTokens: 25_000 })
    })

    it('detects spike when ratio > 1.5x and delta > 5K', () => {
      const turns = [
        makeTurn({ sequence: 1, inputTokens: 5_000, contextTotal: 5_000 }),
        makeTurn({ sequence: 2, inputTokens: 12_000, contextTotal: 12_000 }),
      ]
      const insights = generateInsights(makeStats(turns))
      const spike = insights.find(i => i.id.startsWith('spike-'))
      expect(spike).toBeDefined()
      expect(spike!.turnRef).toBe(2)
    })

    // 一次呼叫的輸入是在它自己叫工具「之前」送出的: 多出來的內容是上一次回應的工具結果, 不是這一次叫的工具
    it('attributes spike to the Bash tool the previous response called', () => {
      const turns = [
        call({ sequence: 1, ctx: 10_000, tools: ['Bash'] }),
        call({ sequence: 2, ctx: 35_000 }),
      ]
      const insights = generateInsights(makeStats(turns))
      const spike = insights.find(i => i.id.startsWith('spike-'))
      expect(spike!.data).toMatchObject({ type: 'context_spike', cause: { kind: 'bash' } })
    })

    it('attributes spike to the Read tool the previous response called', () => {
      const turns = [
        call({ sequence: 1, ctx: 10_000, tools: ['Read'] }),
        call({ sequence: 2, ctx: 35_000 }),
      ]
      const insights = generateInsights(makeStats(turns))
      const spike = insights.find(i => i.id.startsWith('spike-'))
      expect(spike!.data).toMatchObject({ type: 'context_spike', cause: { kind: 'read' } })
    })

    it('does not blame tools called in the same response — spike after a tool-free response is user input', () => {
      const turns = [
        call({ sequence: 1, ctx: 10_000 }),
        call({ sequence: 2, ctx: 35_000, tools: ['Bash'] }),
      ]
      const insights = generateInsights(makeStats(turns))
      const spike = insights.find(i => i.id.startsWith('spike-'))
      expect(spike!.data).toMatchObject({ type: 'context_spike', cause: { kind: 'user_input' } })
    })

    it('ignores growth across a compaction — a summary regrowing the context is not tool output', () => {
      const turns = [
        call({ sequence: 10, ctx: 20_000 }),
        call({ sequence: 30, ctx: 60_000 }),
      ]
      const insights = generateInsights(makeStats(turns, { compactions: [{ sequence: 20 }] }))
      expect(insights.find(i => i.id.startsWith('spike-'))).toBeUndefined()
    })

    it('no spike for gradual growth', () => {
      const turns = [
        makeTurn({ sequence: 1, inputTokens: 10_000, contextTotal: 10_000 }),
        makeTurn({ sequence: 2, inputTokens: 12_000, contextTotal: 12_000 }),
      ]
      const insights = generateInsights(makeStats(turns))
      const spike = insights.find(i => i.id.startsWith('spike-'))
      expect(spike).toBeUndefined()
    })
  })

  describe('Context Limit Warning', () => {
    it('warns at 80% of 200K', () => {
      const turns = [
        makeTurn({ sequence: 1, inputTokens: 170_000, contextTotal: 170_000 }),
      ]
      const insights = generateInsights(makeStats(turns))
      const limit = insights.find(i => i.id.startsWith('ctx-limit'))
      expect(limit).toBeDefined()
      expect(limit!.severity).toBe('warning')
      expect(limit!.data).toMatchObject({ type: 'context_limit', limit: '200k' })
    })

    it('critical at 90% of 200K', () => {
      const turns = [
        makeTurn({ sequence: 1, inputTokens: 185_000, contextTotal: 185_000 }),
      ]
      const insights = generateInsights(makeStats(turns))
      const limit = insights.find(i => i.id.startsWith('ctx-limit'))
      expect(limit).toBeDefined()
      expect(limit!.severity).toBe('critical')
    })

    it('warns at 80% of 1M', () => {
      const turns = [
        makeTurn({ sequence: 1, inputTokens: 850_000, contextTotal: 850_000 }),
      ]
      const insights = generateInsights(makeStats(turns))
      const limit = insights.find(i => i.id.startsWith('ctx-limit'))
      expect(limit).toBeDefined()
      expect(limit!.severity).toBe('warning')
      expect(limit!.data).toMatchObject({ type: 'context_limit', limit: '1m' })
    })

    it('critical at 90% of 1M', () => {
      const turns = [
        makeTurn({ sequence: 1, inputTokens: 920_000, contextTotal: 920_000 }),
      ]
      const insights = generateInsights(makeStats(turns))
      const limit = insights.find(i => i.id.startsWith('ctx-limit'))
      expect(limit).toBeDefined()
      expect(limit!.severity).toBe('critical')
    })

    it('exact boundary 160K triggers warning (>=)', () => {
      const turns = [
        makeTurn({ sequence: 1, inputTokens: 160_000, contextTotal: 160_000 }),
      ]
      const insights = generateInsights(makeStats(turns))
      const limit = insights.find(i => i.id.startsWith('ctx-limit'))
      expect(limit).toBeDefined()
      expect(limit!.severity).toBe('warning')
    })

    it('exact boundary 180K triggers critical (>=)', () => {
      const turns = [
        makeTurn({ sequence: 1, inputTokens: 180_000, contextTotal: 180_000 }),
      ]
      const insights = generateInsights(makeStats(turns))
      const limit = insights.find(i => i.id.startsWith('ctx-limit'))
      expect(limit).toBeDefined()
      expect(limit!.severity).toBe('critical')
    })

    it('exact boundary 800K triggers 1M warning (>=)', () => {
      const turns = [
        makeTurn({ sequence: 1, inputTokens: 800_000, contextTotal: 800_000 }),
      ]
      const insights = generateInsights(makeStats(turns))
      const limit = insights.find(i => i.id.startsWith('ctx-limit'))
      expect(limit).toBeDefined()
      expect(limit!.severity).toBe('warning')
      expect(limit!.data).toMatchObject({ type: 'context_limit', limit: '1m' })
    })

    it('no warning for small context', () => {
      const turns = [
        makeTurn({ sequence: 1, inputTokens: 50_000, contextTotal: 50_000 }),
      ]
      const insights = generateInsights(makeStats(turns))
      const limit = insights.find(i => i.id.startsWith('ctx-limit'))
      expect(limit).toBeUndefined()
    })

    // Regression: ctx > 200K is physical proof of 1M plan; must not be misjudged
    // as 113% of 200K. (Real session screenshot: 226.8K showed "200K critical".)
    it('1M plan: ctx 226K (22%) → no limit insight', () => {
      const turns = [
        makeTurn({ sequence: 1, inputTokens: 226_800, contextTotal: 226_800 }),
      ]
      const insights = generateInsights(makeStats(turns))
      const limit = insights.find(i => i.id.startsWith('ctx-limit'))
      expect(limit).toBeUndefined()
    })

    it('1M plan: prior turn proves 1M, current 195K → no limit insight (not 200K critical)', () => {
      const turns = [
        makeTurn({ sequence: 1, inputTokens: 250_000, contextTotal: 250_000 }),
        makeTurn({ sequence: 2, inputTokens: 195_000, contextTotal: 195_000 }),
      ]
      const insights = generateInsights(makeStats(turns))
      const limit = insights.find(i => i.id.startsWith('ctx-limit'))
      expect(limit).toBeUndefined()
    })

    // Regression: Fable 5 (1M model) at 167K was incorrectly shown as "200K 上限的 84%"
    it('1M inferred from model: Fable 5 at 167K → no limit insight', () => {
      const turns = [
        makeTurn({ sequence: 1, inputTokens: 167_000, contextTotal: 167_000, model: 'claude-fable-5' }),
      ]
      const insights = generateInsights(makeStats(turns))
      const limit = insights.find(i => i.id.startsWith('ctx-limit'))
      expect(limit).toBeUndefined()
    })
  })

  describe('detectContextPlan', () => {
    it('returns 200k when no turn exceeds 200K', () => {
      const turns = [
        makeTurn({ sequence: 1, contextTotal: 100_000 }),
        makeTurn({ sequence: 2, contextTotal: 200_000 }),
      ]
      expect(detectContextPlan(turns)).toBe('200k')
    })

    it('returns 1m when any turn exceeds 200K', () => {
      const turns = [
        makeTurn({ sequence: 1, contextTotal: 100_000 }),
        makeTurn({ sequence: 2, contextTotal: 250_000 }),
        makeTurn({ sequence: 3, contextTotal: 180_000 }),
      ]
      expect(detectContextPlan(turns)).toBe('1m')
    })

    it('returns 200k for empty turns', () => {
      expect(detectContextPlan([])).toBe('200k')
    })

    it('returns 1m for Claude 4+ model even when tokens are low', () => {
      const turns = [
        makeTurn({ sequence: 1, contextTotal: 100_000, model: 'claude-opus-4-6' }),
      ]
      expect(detectContextPlan(turns)).toBe('1m')
    })

    it('returns 1m for Claude Fable 5', () => {
      const turns = [
        makeTurn({ sequence: 1, contextTotal: 50_000, model: 'claude-fable-5' }),
      ]
      expect(detectContextPlan(turns)).toBe('1m')
    })

    it('returns 200k for Claude 3.x model', () => {
      const turns = [
        makeTurn({ sequence: 1, contextTotal: 100_000, model: 'claude-3-5-sonnet-20241022' }),
      ]
      expect(detectContextPlan(turns)).toBe('200k')
    })

    it('returns 200k for Haiku 4.5 (200K-only model)', () => {
      const turns = [
        makeTurn({ sequence: 1, contextTotal: 100_000, model: 'claude-haiku-4-5-20251001' }),
      ]
      expect(detectContextPlan(turns)).toBe('200k')
    })

    it('returns 200k when model is null (no model info)', () => {
      const turns = [
        makeTurn({ sequence: 1, contextTotal: 100_000 }),
      ]
      expect(detectContextPlan(turns)).toBe('200k')
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
        // 離開 90 分鐘回來: 整段重寫
        rewritten = ctx
        turns.push(call({ sequence: i + 1, ctx, read: 0, write: ctx, minute: i + 90 }))
      } else {
        // 其餘每次都讀到上一次的整段 prompt
        turns.push(call({ sequence: i + 1, ctx, read: prev, write: 1_000, minute: i + (i > 15 ? 90 : 0) }))
      }
    }
    const stats = makeStats(turns)
    expect(stats.cacheHitRate).toBeGreaterThan(0.9)
    const summary = generateInsights(stats).find(i => i.id === 'cache-breaks')!
    expect(summary.data).toMatchObject({ total: 1, idle: 1, rewrittenTokens: rewritten })
  })

  describe('Cache Breaks', () => {
    // a8874a38 的形狀: 218 次呼叫, 每次都讀得到上一次的整段 prompt
    it('emits nothing when every call reads the previous prompt from cache', () => {
      const turns = [
        call({ sequence: 1, ctx: 100_000, read: 0, write: 100_000, minute: 0 }),
        call({ sequence: 2, ctx: 101_000, read: 100_000, write: 1_000, minute: 1 }),
        call({ sequence: 3, ctx: 102_000, read: 101_000, write: 1_000, minute: 2 }),
      ]
      const ids = generateInsights(makeStats(turns)).map(i => i.id)
      expect(ids).not.toContain('cache-breaks')
      expect(ids.some(id => id.startsWith('cache-idle-'))).toBe(false)
    })

    it('reports an idle expiry: gap and rewritten tokens', () => {
      const turns = [
        call({ sequence: 1, ctx: 100_000, read: 90_000, write: 10_000, minute: 0 }),
        call({ sequence: 2, ctx: 105_000, read: 0, write: 105_000, minute: 75 }),
      ]
      const insights = generateInsights(makeStats(turns))
      const summary = insights.find(i => i.id === 'cache-breaks')!
      expect(summary.data).toEqual({
        type: 'cache_breaks', total: 1, idle: 1, modelSwitch: 0, unknown: 0, unknownLong: 0, rewrittenTokens: 105_000,
      })
      const idle = insights.find(i => i.id === 'cache-idle-2')!
      expect(idle.data).toEqual({ type: 'cache_idle_expired', turn: 2, gapMinutes: 75, rewrittenTokens: 105_000 })
    })

    it('draws the idle line at 60 minutes (>= 60 expired, 59 is not)', () => {
      const pair = (gap: number) => [
        call({ sequence: 1, ctx: 100_000, read: 90_000, write: 10_000, minute: 0 }),
        call({ sequence: 2, ctx: 100_500, read: 0, write: 100_500, minute: gap }),
      ]
      const at59 = generateInsights(makeStats(pair(59))).find(i => i.id === 'cache-breaks')!
      expect(at59.data).toMatchObject({ idle: 0, unknown: 1 })
      const at60 = generateInsights(makeStats(pair(60))).find(i => i.id === 'cache-breaks')!
      expect(at60.data).toMatchObject({ idle: 1, unknown: 0 })
    })

    it('attributes a rewrite to a model switch, even when the gap is also long', () => {
      const turns = [
        call({ sequence: 1, ctx: 100_000, read: 90_000, write: 10_000, minute: 0, model: 'claude-opus-4-6' }),
        call({ sequence: 2, ctx: 100_500, read: 0, write: 100_500, minute: 90, model: 'claude-sonnet-4-6' }),
      ]
      const summary = generateInsights(makeStats(turns)).find(i => i.id === 'cache-breaks')!
      expect(summary.data).toMatchObject({ total: 1, modelSwitch: 1, idle: 0, unknown: 0 })
    })

    it('does not call it a model switch when a model is unknown', () => {
      const turns = [
        call({ sequence: 1, ctx: 100_000, read: 90_000, write: 10_000, minute: 0, model: 'claude-opus-4-6' }),
        call({ sequence: 2, ctx: 100_500, read: 0, write: 100_500, minute: 1, model: null }),
      ]
      const summary = generateInsights(makeStats(turns)).find(i => i.id === 'cache-breaks')!
      expect(summary.data).toMatchObject({ modelSwitch: 0, unknown: 1 })
    })

    it.each<[number | null, number]>([[3, 0], [10, 1], [null, 0]])(
      'counts an unexplained rewrite after a gap of %s minutes (unknownLong = %s: 5+ minutes may be a short TTL)',
      (gap, unknownLong) => {
        const turns = [
          call({ sequence: 1, ctx: 100_000, read: 90_000, write: 10_000, minute: 0 }),
          call({ sequence: 2, ctx: 100_500, read: 0, write: 100_500, minute: gap ?? undefined }),
        ]
        const summary = generateInsights(makeStats(turns)).find(i => i.id === 'cache-breaks')!
        expect(summary.data).toMatchObject({ unknown: 1, unknownLong })
      },
    )

    it('is not a rewrite when at least half of the previous prompt was still read', () => {
      const turns = [
        call({ sequence: 1, ctx: 100_000, read: 90_000, write: 10_000, minute: 0 }),
        call({ sequence: 2, ctx: 101_000, read: 60_000, write: 41_000, minute: 1 }),
      ]
      expect(generateInsights(makeStats(turns)).map(i => i.id)).not.toContain('cache-breaks')
    })

    // MiniMax 等沒有 prompt caching 的供應商: 每次呼叫讀 0 寫 0(2026-03 的 7c9cb866 命中率 0%), 從頭到尾沒有快取可以「中斷」
    it('does not treat a provider without prompt caching as a string of cache breaks', () => {
      const turns = [
        call({ sequence: 1, ctx: 10_000, minute: 0 }),
        call({ sequence: 2, ctx: 12_000, minute: 1 }),
        call({ sequence: 3, ctx: 14_000, minute: 2 }),
      ]
      expect(generateInsights(makeStats(turns)).map(i => i.id)).not.toContain('cache-breaks')
    })

    // 上一次沒有任何快取活動(prompt 太短、或剛從不支援快取的供應商換過來), 這一次第一次寫入: 之前沒有東西可以「斷」
    it('does not count the first time anything gets cached as a break', () => {
      const turns = [
        call({ sequence: 1, ctx: 3_000, read: 0, write: 0, minute: 0 }),
        call({ sequence: 2, ctx: 4_000, read: 0, write: 4_000, minute: 1 }),
      ]
      expect(generateInsights(makeStats(turns)).map(i => i.id)).not.toContain('cache-breaks')
    })

    it('needs something to have been written: a prompt too short to cache is not a rewrite', () => {
      const turns = [
        call({ sequence: 1, ctx: 100_000, read: 90_000, write: 10_000, minute: 0 }),
        call({ sequence: 2, ctx: 100_500, read: 0, write: 0, minute: 90 }),
      ]
      expect(generateInsights(makeStats(turns)).map(i => i.id)).not.toContain('cache-breaks')
    })

    it('is not a rewrite when the prompt shrank (rewind / trimmed history) — nothing was re-sent', () => {
      const turns = [
        call({ sequence: 1, ctx: 100_000, read: 90_000, write: 10_000, minute: 0 }),
        call({ sequence: 2, ctx: 70_000, read: 30_000, write: 40_000, minute: 1 }),
      ]
      expect(generateInsights(makeStats(turns)).map(i => i.id)).not.toContain('cache-breaks')
    })

    // 壓縮後的第一次呼叫本來就要整段重寫; 就算 prompt 沒縮小(實測有 2 則小對話如此)也不能算快取中斷
    it('does not count the call right after a compaction as a cache break', () => {
      const turns = [
        call({ sequence: 10, ctx: 150_000, read: 140_000, write: 10_000, minute: 0 }),
        call({ sequence: 30, ctx: 149_000, read: 0, write: 149_000, minute: 6 }),
      ]
      const insights = generateInsights(makeStats(turns, { compactions: [{ sequence: 20 }] }))
      expect(insights.map(i => i.id)).not.toContain('cache-breaks')
      expect(insights.map(i => i.id)).toContain('compactions')
    })

    it('summarises every break but lists only the three biggest idle expiries', () => {
      let seq = 1
      let minute = 0
      let prevCtx = 100_000
      const turns = [call({ sequence: seq, ctx: prevCtx, read: 0, write: prevCtx, minute })]
      for (const w of [50_000, 90_000, 20_000, 70_000, 30_000]) {
        // 離開兩小時回來: 整段重寫 w
        minute += 120
        const ctx = prevCtx + 1_000
        turns.push(call({ sequence: ++seq, ctx, read: 0, write: w, minute }))
        // 下一次呼叫讀得到這次的整段 prompt, 中間不再中斷
        minute += 1
        prevCtx = ctx + 1_000
        turns.push(call({ sequence: ++seq, ctx: prevCtx, read: ctx, write: 1_000, minute }))
      }
      const insights = generateInsights(makeStats(turns))
      const summary = insights.find(i => i.id === 'cache-breaks')!
      expect(summary.data).toMatchObject({ type: 'cache_breaks', total: 5, idle: 5, rewrittenTokens: 260_000 })
      const listed = insights.filter(i => i.id.startsWith('cache-idle-'))
      expect(listed).toHaveLength(3)
      const sizes = listed
        .map(i => (i.data.type === 'cache_idle_expired' ? i.data.rewrittenTokens : -1))
        .sort((a, b) => b - a)
      expect(sizes).toEqual([90_000, 70_000, 50_000])
    })

    it('is a warning when something actionable happened (idle expiry or model switch), otherwise info', () => {
      const base = [call({ sequence: 1, ctx: 100_000, read: 90_000, write: 10_000, minute: 0 })]
      const idle = generateInsights(makeStats([...base, call({ sequence: 2, ctx: 100_500, read: 0, write: 100_500, minute: 90 })]))
      expect(idle.find(i => i.id === 'cache-breaks')!.severity).toBe('warning')
      const unknown = generateInsights(makeStats([...base, call({ sequence: 2, ctx: 100_500, read: 0, write: 100_500, minute: 2 })]))
      expect(unknown.find(i => i.id === 'cache-breaks')!.severity).toBe('info')
    })
  })

  describe('Compactions', () => {
    it('reports where the conversation was compacted and how much smaller it got', () => {
      const turns = [
        call({ sequence: 10, ctx: 412_645, read: 400_000, write: 12_645 }),
        call({ sequence: 30, ctx: 85_466, read: 0, write: 85_466 }),
      ]
      const insight = generateInsights(makeStats(turns, { compactions: [{ sequence: 20 }] }))
        .find(i => i.id === 'compactions')!
      expect(insight.severity).toBe('info')
      expect(insight.data).toEqual({ type: 'compaction', count: 1, turn: 2, before: 412_645, after: 85_466 })
    })

    it('with several compactions, counts them all and describes the latest', () => {
      const turns = [
        call({ sequence: 10, ctx: 160_000 }),
        call({ sequence: 30, ctx: 40_000 }),
        call({ sequence: 50, ctx: 170_000 }),
        call({ sequence: 70, ctx: 45_000 }),
      ]
      const insight = generateInsights(makeStats(turns, { compactions: [{ sequence: 20 }, { sequence: 60 }] }))
        .find(i => i.id === 'compactions')!
      expect(insight.data).toEqual({ type: 'compaction', count: 2, turn: 4, before: 170_000, after: 45_000 })
    })

    it('counts two summaries sitting between the same pair of calls once', () => {
      const turns = [call({ sequence: 10, ctx: 150_000 }), call({ sequence: 30, ctx: 20_000 })]
      const insight = generateInsights(makeStats(turns, { compactions: [{ sequence: 20 }, { sequence: 25 }] }))
        .find(i => i.id === 'compactions')!
      expect(insight.data).toMatchObject({ count: 1 })
    })

    it('ignores a summary at the very start (session continued from another) and one after the last call', () => {
      const turns = [call({ sequence: 5, ctx: 50_000 }), call({ sequence: 9, ctx: 52_000 })]
      const stats = makeStats(turns, { compactions: [{ sequence: 0 }, { sequence: 99 }] })
      expect(generateInsights(stats).map(i => i.id)).not.toContain('compactions')
    })
  })

  describe('Call numbering', () => {
    // 畫面上的「第 N 輪」以前是 JSONL 的 sequence: 218 次呼叫的 session 會寫「第 1771 輪」
    it('numbers a spike by call order, not by JSONL sequence', () => {
      const turns = [
        call({ sequence: 5, ctx: 10_000 }),
        call({ sequence: 40, ctx: 12_000 }),
        call({ sequence: 90, ctx: 40_000 }),
      ]
      const spike = generateInsights(makeStats(turns)).find(i => i.id.startsWith('spike-'))!
      expect(spike.id).toBe('spike-3')
      expect(spike.turnRef).toBe(3)
      expect(spike.data).toMatchObject({ type: 'context_spike', turn: 3 })
    })

    it('numbers the output hot spot by call order', () => {
      const turns = [
        call({ sequence: 10, ctx: 1_000, output: 500 }),
        call({ sequence: 200, ctx: 2_000, output: 600 }),
        call({ sequence: 300, ctx: 3_000, output: 8_000 }),
        call({ sequence: 999, ctx: 4_000, output: 400 }),
      ]
      const hot = generateInsights(makeStats(turns)).find(i => i.id.startsWith('hotspot-'))!
      expect(hot.id).toBe('hotspot-3')
      expect(hot.turnRef).toBe(3)
      expect(hot.data).toMatchObject({ type: 'output_hotspot', turn: 3 })
    })
  })

  describe('Output Hot Spot', () => {
    it('detects outlier output turn', () => {
      const turns = [
        makeTurn({ sequence: 1, inputTokens: 1000, outputTokens: 500, contextTotal: 1000 }),
        makeTurn({ sequence: 2, inputTokens: 2000, outputTokens: 600, contextTotal: 2000 }),
        makeTurn({ sequence: 3, inputTokens: 3000, outputTokens: 8000, contextTotal: 3000, hasToolUse: true, toolNames: ['Edit', 'Write'] }),
        makeTurn({ sequence: 4, inputTokens: 4000, outputTokens: 400, contextTotal: 4000 }),
      ]
      const insights = generateInsights(makeStats(turns))
      const hot = insights.find(i => i.id.startsWith('hotspot-'))
      expect(hot).toBeDefined()
      expect(hot!.data).toMatchObject({
        type: 'output_hotspot',
        turn: 3,
        tools: expect.arrayContaining(['Edit', 'Write']),
      })
    })

    it('no hot spot when output is uniform', () => {
      const turns = [
        makeTurn({ sequence: 1, inputTokens: 1000, outputTokens: 500, contextTotal: 1000 }),
        makeTurn({ sequence: 2, inputTokens: 2000, outputTokens: 600, contextTotal: 2000 }),
        makeTurn({ sequence: 3, inputTokens: 3000, outputTokens: 550, contextTotal: 3000 }),
      ]
      const insights = generateInsights(makeStats(turns))
      const hot = insights.find(i => i.id.startsWith('hotspot-'))
      expect(hot).toBeUndefined()
    })
  })

  describe('Growth Rate Analysis', () => {
    it('detects accelerating growth', () => {
      // 12 turns: first half steady +1K, second half +5K
      const turns = Array.from({ length: 12 }, (_, i) => {
        const input = i < 6
          ? 10_000 + i * 1_000
          : 10_000 + 5 * 1_000 + (i - 5) * 5_000
        return makeTurn({ sequence: i + 1, inputTokens: input, contextTotal: input })
      })
      const insights = generateInsights(makeStats(turns))
      const growth = insights.find(i => i.id === 'growth-accel')
      expect(growth).toBeDefined()
      expect(growth!.severity).toBe('warning')
    })

    it('detects decelerating growth', () => {
      // 12 turns: first half +5K, second half +1K
      const turns = Array.from({ length: 12 }, (_, i) => {
        const input = i < 6
          ? 10_000 + i * 5_000
          : 10_000 + 5 * 5_000 + (i - 5) * 1_000
        return makeTurn({ sequence: i + 1, inputTokens: input, contextTotal: input })
      })
      const insights = generateInsights(makeStats(turns))
      const growth = insights.find(i => i.id === 'growth-decel')
      expect(growth).toBeDefined()
      expect(growth!.severity).toBe('good')
    })

    // 真實資料(9/26 的 8bbffb1d)顯示「成長減慢（-0.2x）」: 壓縮造成的下降被當成負成長, 倍率變負、誤報「減慢」
    it('does not read a compaction drop as negative growth', () => {
      // 12 次呼叫每次 +1K；第 8、9 次之間壓縮把 17K 砍到 12K，之後同樣每次 +1K
      const turns = Array.from({ length: 12 }, (_, i) =>
        call({ sequence: (i + 1) * 10, ctx: i < 8 ? 10_000 + i * 1_000 : 12_000 + (i - 8) * 1_000 }),
      )
      const insights = generateInsights(makeStats(turns, { compactions: [{ sequence: 85 }] }))
      expect(insights.find(i => i.id === 'growth-accel' || i.id === 'growth-decel')).toBeUndefined()
    })

    it('skipped for short sessions (< 10 turns)', () => {
      const turns = Array.from({ length: 5 }, (_, i) =>
        makeTurn({ sequence: i + 1, inputTokens: 10_000 + i * 5_000, contextTotal: 10_000 + i * 5_000 }),
      )
      const insights = generateInsights(makeStats(turns))
      const growth = insights.find(i => i.id === 'growth-accel' || i.id === 'growth-decel')
      expect(growth).toBeUndefined()
    })
  })

  describe('Sorting', () => {
    it('puts a critical insight ahead of warnings', () => {
      const turns = [
        makeTurn({ sequence: 1, inputTokens: 10_000, outputTokens: 500, contextTotal: 10_000 }),
        makeTurn({
          sequence: 2, inputTokens: 185_000, outputTokens: 8000, contextTotal: 185_000,
          hasToolUse: true, toolNames: ['Edit'],
        }),
      ]
      const stats = makeStats(turns)
      const insights = generateInsights(stats)
      expect(insights.length).toBeGreaterThan(1)

      for (let i = 1; i < insights.length; i++) {
        const order = ['critical', 'warning', 'info', 'good']
        expect(order.indexOf(insights[i - 1].severity))
          .toBeLessThanOrEqual(order.indexOf(insights[i].severity))
      }
    })
  })

  // 面板預設只顯示前 3 條，其餘收在「顯示其他 N 筆」後面。長 session 的「context 暴增」動輒好幾條(warning)，
  // 而壓縮與快取中斷是 info——只照嚴重度排，9/26 那場「壓縮」會排第 4 條被收起來，正好違背「看得出有沒有 compact」。
  describe('Display order — what happened comes before what was observed', () => {
    const ids = (stats: SessionTokenStats) => generateInsights(stats).map(i => i.id)

    it('puts a compaction ahead of any number of context spikes, inside the three the panel shows by default', () => {
      // 每次呼叫 +25K = 4 條暴增，接著壓縮
      const turns = [10, 20, 30, 40, 50].map((sequence, i) => call({ sequence, ctx: 10_000 + i * 25_000 }))
      turns.push(call({ sequence: 60, ctx: 30_000 }))
      const order = ids(makeStats(turns, { compactions: [{ sequence: 55 }] }))
      expect(order.filter(id => id.startsWith('spike-'))).toHaveLength(4)
      expect(order[0]).toBe('compactions')
    })

    it('puts cache breaks ahead of spikes even when the cause is unknown and the severity is only info', () => {
      const turns = [
        call({ sequence: 1, ctx: 10_000, read: 0, write: 10_000, minute: 0 }),
        call({ sequence: 2, ctx: 35_000, read: 10_000, write: 25_000, minute: 1 }),
        call({ sequence: 3, ctx: 60_000, read: 35_000, write: 25_000, minute: 2 }),
        call({ sequence: 4, ctx: 85_000, read: 60_000, write: 25_000, minute: 3 }),
        call({ sequence: 5, ctx: 86_000, read: 0, write: 86_000, minute: 4 }),
      ]
      const insights = generateInsights(makeStats(turns))
      expect(insights.find(i => i.id === 'cache-breaks')!.severity).toBe('info')
      const order = insights.map(i => i.id)
      expect(order.filter(id => id.startsWith('spike-'))).toHaveLength(3)
      expect(order[0]).toBe('cache-breaks')
    })

    it('still puts a critical context limit first — running out of room beats everything', () => {
      const turns = [
        call({ sequence: 1, ctx: 150_000, read: 140_000, write: 10_000 }),
        call({ sequence: 10, ctx: 20_000, read: 0, write: 20_000 }),
        call({ sequence: 30, ctx: 185_000, read: 20_000, write: 165_000 }),
      ]
      const order = ids(makeStats(turns, { compactions: [{ sequence: 5 }] }))
      expect(order.slice(0, 2)).toEqual(['ctx-limit-200k', 'compactions'])
    })

    // 規則的產生順序是熱點(info)在前、成長(warning)在後：排完要倒過來，才驗得到「觀察照嚴重度排」
    it('orders the observations by severity, not by the order the rules run in', () => {
      const turns = Array.from({ length: 12 }, (_, i) => call({
        sequence: i + 1,
        // 前半每次 +1K、後半每次 +4K：成長加速(warning)
        ctx: 10_000 + Math.min(i, 6) * 1_000 + Math.max(0, i - 6) * 4_000,
        // 第 3 次呼叫輸出特別多：產出熱點(info)
        output: i === 2 ? 8_000 : 100,
      }))
      expect(generateInsights(makeStats(turns)).map(i => i.id)).toEqual(['growth-accel', 'hotspot-3'])
    })
  })

  describe('Edge cases', () => {
    it('empty turns → no insights', () => {
      const stats = makeStats([])
      const insights = generateInsights(stats)
      expect(insights).toEqual([])
    })

    it('single turn → no spike, no growth rate', () => {
      const turns = [makeTurn({ sequence: 1, inputTokens: 50_000, contextTotal: 50_000 })]
      const stats = makeStats(turns)
      const insights = generateInsights(stats)
      expect(insights.find(i => i.id.startsWith('spike-'))).toBeUndefined()
      expect(insights.find(i => i.id === 'growth-accel')).toBeUndefined()
    })
  })
})
