import { describe, it, expect } from 'vitest'
import { generateInsights } from '../src/renderer/components/TokenBudget/insightEngine'
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
    ...overrides,
  }
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
      expect(spike!.title).toContain('Turn 2')
      expect(spike!.title).toContain('+25.0K')
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

    it('attributes spike to Bash tool', () => {
      const turns = [
        makeTurn({ sequence: 1, inputTokens: 10_000, contextTotal: 10_000 }),
        makeTurn({
          sequence: 2, inputTokens: 35_000, contextTotal: 35_000,
          hasToolUse: true, toolNames: ['Bash'],
        }),
      ]
      const insights = generateInsights(makeStats(turns))
      const spike = insights.find(i => i.id.startsWith('spike-'))
      expect(spike!.detail).toContain('Bash')
    })

    it('attributes spike to Read tool', () => {
      const turns = [
        makeTurn({ sequence: 1, inputTokens: 10_000, contextTotal: 10_000 }),
        makeTurn({
          sequence: 2, inputTokens: 35_000, contextTotal: 35_000,
          hasToolUse: true, toolNames: ['Read'],
        }),
      ]
      const insights = generateInsights(makeStats(turns))
      const spike = insights.find(i => i.id.startsWith('spike-'))
      expect(spike!.detail).toContain('large file read')
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
      expect(limit!.title).toContain('200K')
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
      expect(limit!.title).toContain('1M')
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
      expect(limit!.title).toContain('1M')
    })

    it('no warning for small context', () => {
      const turns = [
        makeTurn({ sequence: 1, inputTokens: 50_000, contextTotal: 50_000 }),
      ]
      const insights = generateInsights(makeStats(turns))
      const limit = insights.find(i => i.id.startsWith('ctx-limit'))
      expect(limit).toBeUndefined()
    })
  })

  describe('Cache Efficiency Assessment', () => {
    it('good when hit rate > 70%', () => {
      const stats = makeStats(
        [makeTurn({ sequence: 1, inputTokens: 100, cacheReadTokens: 80, contextTotal: 100 })],
        { cacheHitRate: 0.8 },
      )
      const insights = generateInsights(stats)
      const cache = insights.find(i => i.id === 'cache-good')
      expect(cache).toBeDefined()
      expect(cache!.severity).toBe('good')
      expect(cache!.title).toContain('80%')
    })

    it('warning when hit rate < 30%', () => {
      const stats = makeStats(
        [makeTurn({ sequence: 1, inputTokens: 100, contextTotal: 100 })],
        { cacheHitRate: 0.15 },
      )
      const insights = generateInsights(stats)
      const cache = insights.find(i => i.id === 'cache-poor')
      expect(cache).toBeDefined()
      expect(cache!.severity).toBe('warning')
    })

    it('silent for middle range (30-70%)', () => {
      const stats = makeStats(
        [makeTurn({ sequence: 1, inputTokens: 100, contextTotal: 100 })],
        { cacheHitRate: 0.5 },
      )
      const insights = generateInsights(stats)
      const cache = insights.find(i => i.id === 'cache-good' || i.id === 'cache-poor')
      expect(cache).toBeUndefined()
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
      expect(hot!.title).toContain('Turn 3')
      expect(hot!.detail).toContain('Edit')
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
    it('sorts by severity: critical > warning > info > good', () => {
      const turns = [
        makeTurn({ sequence: 1, inputTokens: 10_000, outputTokens: 500, contextTotal: 10_000 }),
        makeTurn({
          sequence: 2, inputTokens: 185_000, outputTokens: 8000, contextTotal: 185_000,
          hasToolUse: true, toolNames: ['Edit'],
        }),
      ]
      const stats = makeStats(turns, { cacheHitRate: 0.8 })
      const insights = generateInsights(stats)
      expect(insights.length).toBeGreaterThan(1)

      for (let i = 1; i < insights.length; i++) {
        const order = ['critical', 'warning', 'info', 'good']
        expect(order.indexOf(insights[i - 1].severity))
          .toBeLessThanOrEqual(order.indexOf(insights[i].severity))
      }
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
      const stats = makeStats(turns, { cacheHitRate: 0.5 })
      const insights = generateInsights(stats)
      expect(insights.find(i => i.id.startsWith('spike-'))).toBeUndefined()
      expect(insights.find(i => i.id === 'growth-accel')).toBeUndefined()
    })
  })
})
