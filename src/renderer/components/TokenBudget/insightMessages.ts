import type { MessageKey, TranslateParams } from '../../i18n/messages'
import { formatTokens } from '../../utils/formatTokens'
import { formatDuration } from '../../utils/formatTime'
import type { Insight, SpikeCause } from './insightEngine'

export interface RenderedInsight {
  titleKey: MessageKey
  titleParams?: TranslateParams
  detailKey?: MessageKey
  detailParams?: TranslateParams
}

function mapSpikeCause(cause: SpikeCause): { key: MessageKey; params?: TranslateParams } {
  switch (cause.kind) {
    case 'user_input':
      return { key: 'tokenBudget.insights.contextSpike.cause.userInput' }
    case 'bash':
      return { key: 'tokenBudget.insights.contextSpike.cause.bash' }
    case 'read':
      return { key: 'tokenBudget.insights.contextSpike.cause.read' }
    case 'tool':
      return {
        key: 'tokenBudget.insights.contextSpike.cause.tool',
        params: { tools: cause.tools.join(', ') },
      }
  }
}

function limitDetailKey(limit: '200k' | '1m', severity: Insight['severity']): MessageKey {
  if (limit === '200k') return 'tokenBudget.insights.contextLimit.detail.200k'
  return severity === 'critical'
    ? 'tokenBudget.insights.contextLimit.detail.1mCritical'
    : 'tokenBudget.insights.contextLimit.detail.1mWarning'
}

export function mapInsightToMessages(insight: Insight): RenderedInsight {
  const data = insight.data
  switch (data.type) {
    case 'context_spike': {
      const cause = mapSpikeCause(data.cause)
      return {
        titleKey: 'tokenBudget.insights.contextSpike.title',
        titleParams: { turn: data.turn, delta: formatTokens(data.deltaTokens) },
        detailKey: cause.key,
        detailParams: cause.params,
      }
    }
    case 'context_limit': {
      const limitLabel = data.limit === '200k' ? '200K' : '1M'
      return {
        titleKey: 'tokenBudget.insights.contextLimit.title',
        titleParams: { percent: data.percent, limit: limitLabel, tokens: formatTokens(data.tokens) },
        detailKey: limitDetailKey(data.limit, insight.severity),
      }
    }
    case 'cache_breaks':
      return {
        titleKey: 'tokenBudget.insights.cacheBreaks.title',
        titleParams: { count: data.total, tokens: formatTokens(data.rewrittenTokens) },
        // 有原因不明、且間隔 5 分鐘以上的: 補一句 API key／超額時快取只保留 5 分鐘
        detailKey: data.unknownLong > 0
          ? 'tokenBudget.insights.cacheBreaks.detailShortTtl'
          : 'tokenBudget.insights.cacheBreaks.detail',
        detailParams: { idle: data.idle, modelSwitch: data.modelSwitch, unknown: data.unknown },
      }
    case 'cache_idle_expired':
      return {
        titleKey: 'tokenBudget.insights.cacheIdle.title',
        titleParams: { gap: formatDuration(data.gapMinutes * 60), tokens: formatTokens(data.rewrittenTokens) },
        detailKey: 'tokenBudget.insights.cacheIdle.detail',
        detailParams: { turn: data.turn },
      }
    case 'compaction':
      return {
        titleKey: 'tokenBudget.insights.compaction.title',
        titleParams: { count: data.count },
        detailKey: data.count === 1
          ? 'tokenBudget.insights.compaction.detail.single'
          : 'tokenBudget.insights.compaction.detail.last',
        detailParams: { turn: data.turn, before: formatTokens(data.before), after: formatTokens(data.after) },
      }
    case 'output_hotspot': {
      const hasTools = data.tools.length > 0
      return {
        titleKey: 'tokenBudget.insights.hotspot.title',
        titleParams: { turn: data.turn, tokens: formatTokens(data.tokens) },
        detailKey: hasTools ? 'tokenBudget.insights.hotspot.tools' : undefined,
        detailParams: hasTools ? { tools: data.tools.join(', ') } : undefined,
      }
    }
    case 'growth_accel':
      return {
        titleKey: 'tokenBudget.insights.growthAccel.title',
        titleParams: { ratio: data.ratio.toFixed(1) },
        detailKey: 'tokenBudget.insights.growthAccel.detail',
      }
    case 'growth_decel':
      return {
        titleKey: 'tokenBudget.insights.growthDecel.title',
        titleParams: { ratio: data.ratio.toFixed(1) },
        detailKey: 'tokenBudget.insights.growthDecel.detail',
      }
  }
}
