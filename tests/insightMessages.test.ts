import { describe, it, expect } from 'vitest'
import { LOCALES, translate } from '../src/renderer/i18n/messages'
import type { Insight } from '../src/renderer/components/TokenBudget/insightEngine'
import { mapInsightToMessages, type RenderedInsight } from '../src/renderer/components/TokenBudget/insightMessages'

interface Case {
  insight: Insight
  expected: RenderedInsight
}

const cases: Case[] = [
  {
    insight: { id: 'sp-user', severity: 'warning', icon: '⚡', data: { type: 'context_spike', turn: 5, deltaTokens: 25_000, cause: { kind: 'user_input' } } },
    expected: {
      titleKey: 'tokenBudget.insights.contextSpike.title',
      titleParams: { turn: 5, delta: '25.0K' },
      detailKey: 'tokenBudget.insights.contextSpike.cause.userInput',
      detailParams: undefined,
    },
  },
  {
    insight: { id: 'sp-bash', severity: 'warning', icon: '⚡', data: { type: 'context_spike', turn: 5, deltaTokens: 25_000, cause: { kind: 'bash' } } },
    expected: {
      titleKey: 'tokenBudget.insights.contextSpike.title',
      titleParams: { turn: 5, delta: '25.0K' },
      detailKey: 'tokenBudget.insights.contextSpike.cause.bash',
      detailParams: undefined,
    },
  },
  {
    insight: { id: 'sp-read', severity: 'warning', icon: '⚡', data: { type: 'context_spike', turn: 5, deltaTokens: 25_000, cause: { kind: 'read' } } },
    expected: {
      titleKey: 'tokenBudget.insights.contextSpike.title',
      titleParams: { turn: 5, delta: '25.0K' },
      detailKey: 'tokenBudget.insights.contextSpike.cause.read',
      detailParams: undefined,
    },
  },
  {
    insight: { id: 'sp-tool', severity: 'warning', icon: '⚡', data: { type: 'context_spike', turn: 5, deltaTokens: 25_000, cause: { kind: 'tool', tools: ['Edit', 'Write'] } } },
    expected: {
      titleKey: 'tokenBudget.insights.contextSpike.title',
      titleParams: { turn: 5, delta: '25.0K' },
      detailKey: 'tokenBudget.insights.contextSpike.cause.tool',
      detailParams: { tools: 'Edit, Write' },
    },
  },
  {
    insight: { id: 'lim-200k-w', severity: 'warning', icon: '🟡', data: { type: 'context_limit', limit: '200k', percent: 85, tokens: 170_000 } },
    expected: {
      titleKey: 'tokenBudget.insights.contextLimit.title',
      titleParams: { percent: 85, limit: '200K', tokens: '170.0K' },
      detailKey: 'tokenBudget.insights.contextLimit.detail.200k',
      detailParams: undefined,
    },
  },
  {
    insight: { id: 'lim-200k-c', severity: 'critical', icon: '🔴', data: { type: 'context_limit', limit: '200k', percent: 95, tokens: 190_000 } },
    expected: {
      titleKey: 'tokenBudget.insights.contextLimit.title',
      titleParams: { percent: 95, limit: '200K', tokens: '190.0K' },
      detailKey: 'tokenBudget.insights.contextLimit.detail.200k',
      detailParams: undefined,
    },
  },
  {
    insight: { id: 'lim-1m-w', severity: 'warning', icon: '🟡', data: { type: 'context_limit', limit: '1m', percent: 85, tokens: 850_000 } },
    expected: {
      titleKey: 'tokenBudget.insights.contextLimit.title',
      titleParams: { percent: 85, limit: '1M', tokens: '850.0K' },
      detailKey: 'tokenBudget.insights.contextLimit.detail.1mWarning',
      detailParams: undefined,
    },
  },
  {
    insight: { id: 'lim-1m-c', severity: 'critical', icon: '🔴', data: { type: 'context_limit', limit: '1m', percent: 95, tokens: 950_000 } },
    expected: {
      titleKey: 'tokenBudget.insights.contextLimit.title',
      titleParams: { percent: 95, limit: '1M', tokens: '950.0K' },
      detailKey: 'tokenBudget.insights.contextLimit.detail.1mCritical',
      detailParams: undefined,
    },
  },
  {
    insight: { id: 'cache-good', severity: 'good', icon: '✅', data: { type: 'cache_efficiency_good', rate: 0.85 } },
    expected: {
      titleKey: 'tokenBudget.insights.cacheGood.title',
      titleParams: { percent: 85 },
    },
  },
  {
    insight: { id: 'cache-poor', severity: 'warning', icon: '⚠️', data: { type: 'cache_efficiency_poor', rate: 0.15 } },
    expected: {
      titleKey: 'tokenBudget.insights.cachePoor.title',
      titleParams: { percent: 15 },
      detailKey: 'tokenBudget.insights.cachePoor.detail',
      detailParams: undefined,
    },
  },
  {
    insight: { id: 'hot-tools', severity: 'info', icon: '🔥', data: { type: 'output_hotspot', turn: 7, tokens: 5_400, tools: ['Edit'] } },
    expected: {
      titleKey: 'tokenBudget.insights.hotspot.title',
      titleParams: { turn: 7, tokens: '5.4K' },
      detailKey: 'tokenBudget.insights.hotspot.tools',
      detailParams: { tools: 'Edit' },
    },
  },
  {
    insight: { id: 'hot-empty', severity: 'info', icon: '🔥', data: { type: 'output_hotspot', turn: 7, tokens: 5_400, tools: [] } },
    expected: {
      titleKey: 'tokenBudget.insights.hotspot.title',
      titleParams: { turn: 7, tokens: '5.4K' },
      detailKey: undefined,
      detailParams: undefined,
    },
  },
  {
    insight: { id: 'grow-up', severity: 'warning', icon: '📈', data: { type: 'growth_accel', ratio: 2.5 } },
    expected: {
      titleKey: 'tokenBudget.insights.growthAccel.title',
      titleParams: { ratio: '2.5' },
      detailKey: 'tokenBudget.insights.growthAccel.detail',
      detailParams: undefined,
    },
  },
  {
    insight: { id: 'grow-down', severity: 'good', icon: '📉', data: { type: 'growth_decel', ratio: 0.4 } },
    expected: {
      titleKey: 'tokenBudget.insights.growthDecel.title',
      titleParams: { ratio: '0.4' },
      detailKey: 'tokenBudget.insights.growthDecel.detail',
      detailParams: undefined,
    },
  },
]

const PLACEHOLDER = /\{[a-zA-Z_]\w*\}/

describe('mapInsightToMessages mapping correctness', () => {
  for (const { insight, expected } of cases) {
    it(`${insight.id} maps to expected keys/params`, () => {
      expect(mapInsightToMessages(insight)).toEqual(expected)
    })
  }
})

describe('insightMessages i18n catalog coverage', () => {
  for (const locale of LOCALES) {
    describe(`locale: ${locale}`, () => {
      for (const { insight } of cases) {
        it(`${insight.id} renders without missing keys or placeholders`, () => {
          const rendered = mapInsightToMessages(insight)
          const title = translate(locale, rendered.titleKey, rendered.titleParams)
          expect(title).not.toBe(rendered.titleKey)
          expect(title).not.toMatch(PLACEHOLDER)

          if (rendered.detailKey) {
            const detail = translate(locale, rendered.detailKey, rendered.detailParams)
            expect(detail).not.toBe(rendered.detailKey)
            expect(detail).not.toMatch(PLACEHOLDER)
          }
        })
      }
    })
  }
})
