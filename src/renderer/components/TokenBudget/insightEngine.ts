import type { SessionTokenStats } from '../../../shared/types'

export type InsightSeverity = 'critical' | 'warning' | 'info' | 'good'

export interface Insight {
  id: string
  severity: InsightSeverity
  icon: string
  title: string
  detail?: string
  turnRef?: number
}

// ── Helpers ──

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

// ── Rule 1: Context Spike Detection ──

function detectContextSpikes(turns: SessionTokenStats['turns']): Insight[] {
  const insights: Insight[] = []
  for (let i = 1; i < turns.length; i++) {
    const delta = turns[i].inputTokens - turns[i - 1].inputTokens
    const ratio = turns[i - 1].inputTokens > 0
      ? turns[i].inputTokens / turns[i - 1].inputTokens
      : 0

    if (delta > 20_000 || (ratio > 1.5 && delta > 5_000)) {
      const turn = turns[i]
      let cause = 'large user input or pasted content'
      if (turn.hasToolUse) {
        if (turn.toolNames.some(t => t.toLowerCase().includes('bash'))) {
          cause = 'Bash returned large output'
        } else if (turn.toolNames.some(t => t.toLowerCase().includes('read'))) {
          cause = 'large file read'
        } else {
          cause = `tool output (${turn.toolNames.slice(0, 3).join(', ')})`
        }
      }

      insights.push({
        id: `spike-${turn.sequence}`,
        severity: 'warning',
        icon: '⚡',
        title: `Turn ${turn.sequence} context surged +${formatTokens(delta)}`,
        detail: cause,
        turnRef: turn.sequence,
      })
    }
  }
  return insights
}

// ── Rule 2: Context Limit Warning ──

function assessContextLimit(turns: SessionTokenStats['turns']): Insight[] {
  if (turns.length === 0) return []
  const last = turns[turns.length - 1]
  const ctx = last.contextTotal

  // 1M limit: warning at 80%, critical at 90%
  if (ctx >= 900_000) {
    return [{
      id: 'ctx-limit-1m',
      severity: 'critical',
      icon: '🔴',
      title: `Context at ${Math.round(ctx / 10_000)}% of 1M limit (${formatTokens(ctx)})`,
      detail: 'Approaching maximum context window',
    }]
  }
  if (ctx >= 800_000) {
    return [{
      id: 'ctx-limit-1m',
      severity: 'warning',
      icon: '🟡',
      title: `Context at ${Math.round(ctx / 10_000)}% of 1M limit (${formatTokens(ctx)})`,
      detail: 'Consider using /compact to free up context',
    }]
  }

  // 200K limit: warning at 80%, critical at 90%
  if (ctx >= 180_000) {
    return [{
      id: 'ctx-limit-200k',
      severity: 'critical',
      icon: '🔴',
      title: `Context at ${Math.round(ctx / 2_000)}% of 200K limit (${formatTokens(ctx)})`,
      detail: 'Consider starting a new session or using /compact',
    }]
  }
  if (ctx >= 160_000) {
    return [{
      id: 'ctx-limit-200k',
      severity: 'warning',
      icon: '🟡',
      title: `Context at ${Math.round(ctx / 2_000)}% of 200K limit (${formatTokens(ctx)})`,
      detail: 'Consider starting a new session or using /compact',
    }]
  }

  return []
}

// ── Rule 3: Cache Efficiency Assessment ──

function assessCacheEfficiency(stats: SessionTokenStats): Insight[] {
  if (stats.totalInputTokens === 0) return []
  const rate = stats.cacheHitRate
  const pct = Math.round(rate * 100)

  if (rate > 0.7) {
    return [{
      id: 'cache-good',
      severity: 'good',
      icon: '✅',
      title: `Cache hit rate ${pct}% — prompt caching working well`,
    }]
  }

  if (rate < 0.3) {
    return [{
      id: 'cache-poor',
      severity: 'warning',
      icon: '⚠️',
      title: `Cache hit rate only ${pct}%`,
      detail: 'Most tokens are new input — likely a short session or frequent topic switches',
    }]
  }

  // Middle range: stay silent (noise < signal)
  return []
}

// ── Rule 4: Output Hot Spot ──

function detectOutputHotSpots(turns: SessionTokenStats['turns']): Insight[] {
  if (turns.length < 3) return []

  let totalOutput = 0
  let max = turns[0]
  for (const t of turns) {
    totalOutput += t.outputTokens
    if (t.outputTokens > max.outputTokens) max = t
  }

  const avgOutput = totalOutput / turns.length
  if (avgOutput === 0) return []

  if (max.outputTokens > avgOutput * 3 && max.outputTokens > 2_000) {
    return [{
      id: `hotspot-${max.sequence}`,
      severity: 'info',
      icon: '🔥',
      title: `Turn ${max.sequence} generated most output (${formatTokens(max.outputTokens)})`,
      detail: max.toolNames.length > 0
        ? `Tools: ${max.toolNames.slice(0, 4).join(', ')}`
        : undefined,
      turnRef: max.sequence,
    }]
  }

  return []
}

// ── Rule 5: Growth Rate Analysis ──

function analyzeGrowthRate(turns: SessionTokenStats['turns']): Insight[] {
  if (turns.length < 10) return []

  const mid = Math.floor(turns.length / 2)

  let firstHalfSum = 0
  for (let i = 1; i <= mid; i++) {
    firstHalfSum += turns[i].inputTokens - turns[i - 1].inputTokens
  }
  let secondHalfSum = 0
  for (let i = mid + 1; i < turns.length; i++) {
    secondHalfSum += turns[i].inputTokens - turns[i - 1].inputTokens
  }

  const avgFirst = firstHalfSum / mid
  const avgSecond = secondHalfSum / (turns.length - mid - 1)

  if (avgFirst <= 0) return []

  const ratio = avgSecond / avgFirst

  if (ratio > 2.0) {
    return [{
      id: 'growth-accel',
      severity: 'warning',
      icon: '📈',
      title: `Context growth accelerated ${ratio.toFixed(1)}x in second half`,
      detail: 'Efficiency declining as conversation grows',
    }]
  }

  if (ratio < 0.5) {
    return [{
      id: 'growth-decel',
      severity: 'good',
      icon: '📉',
      title: `Context growth slowed in second half (${ratio.toFixed(1)}x)`,
      detail: 'Cache efficiency improving over time',
    }]
  }

  return []
}

// ── Severity ordering ──

const SEVERITY_ORDER: Record<InsightSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
  good: 3,
}

// ── Public API ──

export function generateInsights(stats: SessionTokenStats): Insight[] {
  const insights: Insight[] = [
    ...detectContextSpikes(stats.turns),
    ...assessContextLimit(stats.turns),
    ...assessCacheEfficiency(stats),
    ...detectOutputHotSpots(stats.turns),
    ...analyzeGrowthRate(stats.turns),
  ]

  insights.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  return insights
}
