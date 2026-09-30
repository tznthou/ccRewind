import type { SessionTokenStats } from '../../../shared/types'

export type InsightSeverity = 'critical' | 'warning' | 'info' | 'good'

export type SpikeCause =
  | { kind: 'user_input' }
  | { kind: 'bash' }
  | { kind: 'read' }
  | { kind: 'tool'; tools: string[] }

/** `turn` 一律是「第幾次 API 呼叫」（從 1 起算），不是 JSONL 的 sequence */
export type InsightData =
  | { type: 'context_spike'; turn: number; deltaTokens: number; cause: SpikeCause }
  | { type: 'context_limit'; limit: '200k' | '1m'; percent: number; tokens: number }
  | {
    type: 'cache_breaks'
    total: number
    idle: number
    modelSwitch: number
    unknown: number
    /** 原因不明、且與上一次呼叫相隔 5 分鐘以上的次數（API key／超額時 TTL 只有 5 分鐘，這類可能是真的過期） */
    unknownLong: number
    rewrittenTokens: number
  }
  | { type: 'cache_idle_expired'; turn: number; gapMinutes: number; rewrittenTokens: number }
  | { type: 'compaction'; count: number; turn: number; before: number; after: number }
  | { type: 'output_hotspot'; turn: number; tokens: number; tools: string[] }
  | { type: 'growth_accel'; ratio: number }
  | { type: 'growth_decel'; ratio: number }

export interface Insight {
  id: string
  severity: InsightSeverity
  icon: string
  data: InsightData
  turnRef?: number
}

type Turn = SessionTokenStats['turns'][number]
type Compactions = SessionTokenStats['compactions']

/**
 * 壓縮摘要後面第一次呼叫的位置 i（turns[i - 1] 與 turns[i] 之間夾著壓縮），以 JSONL sequence 判斷。
 * 同一對呼叫之間有好幾則摘要只算一次。session 開頭的摘要（上一段對話帶進來的）不算這段對話的壓縮；
 * 最後一次呼叫之後的摘要沒有「壓縮後」的呼叫可以量，也不列。兩個陣列都依 sequence 由小到大（SQL 已排序）。
 */
function compactedCallIndexes(turns: Turn[], compactions: Compactions): Set<number> {
  const result = new Set<number>()
  let t = 0
  for (const c of compactions) {
    while (t < turns.length && turns[t].sequence < c.sequence) t++
    if (t > 0 && t < turns.length) result.add(t)
  }
  return result
}

// ── Rule 1: Context Spike Detection ──

function detectContextSpikes(turns: Turn[], compacted: ReadonlySet<number>): Insight[] {
  const insights: Insight[] = []
  for (let i = 1; i < turns.length; i++) {
    const prev = turns[i - 1]
    // 壓縮後 context 從摘要重新長起來，不是工具輸出
    if (compacted.has(i)) continue

    const delta = turns[i].inputTokens - prev.inputTokens
    const ratio = prev.inputTokens > 0 ? turns[i].inputTokens / prev.inputTokens : 0

    if (delta > 20_000 || (ratio > 1.5 && delta > 5_000)) {
      // 這次呼叫的輸入是在它自己叫工具「之前」送出的：多出來的內容是「上一次回應」叫的工具的結果
      let cause: SpikeCause = { kind: 'user_input' }
      if (prev.hasToolUse) {
        if (prev.toolNames.some(t => t.toLowerCase().includes('bash'))) {
          cause = { kind: 'bash' }
        } else if (prev.toolNames.some(t => t.toLowerCase().includes('read'))) {
          cause = { kind: 'read' }
        } else {
          cause = { kind: 'tool', tools: prev.toolNames.slice(0, 3) }
        }
      }

      const call = i + 1
      insights.push({
        id: `spike-${call}`,
        severity: 'warning',
        icon: '⚡',
        data: {
          type: 'context_spike',
          turn: call,
          deltaTokens: delta,
          cause,
        },
        turnRef: call,
      })
    }
  }
  return insights
}

// ── Rule 2: Context Limit Warning ──

// Detect plan window: (1) any turn >200K is physical proof of 1M context,
// (2) model family — Claude 3.x was 200K-only; Claude 4+/5+ default to 1M,
// (3) fallback to 200K when no model info is available.
export function detectContextPlan(turns: SessionTokenStats['turns']): '200k' | '1m' {
  for (const t of turns) {
    if (t.contextTotal > 200_000) return '1m'
  }
  const model = turns.find(t => t.model)?.model
  if (model && !model.startsWith('claude-3') && !model.includes('haiku')) return '1m'
  return '200k'
}

function assessContextLimit(turns: SessionTokenStats['turns']): Insight[] {
  if (turns.length === 0) return []
  const ctx = turns[turns.length - 1].contextTotal
  const plan = detectContextPlan(turns)

  if (plan === '1m') {
    if (ctx >= 900_000) {
      return [{
        id: 'ctx-limit-1m',
        severity: 'critical',
        icon: '🔴',
        data: { type: 'context_limit', limit: '1m', percent: Math.round(ctx / 10_000), tokens: ctx },
      }]
    }
    if (ctx >= 800_000) {
      return [{
        id: 'ctx-limit-1m',
        severity: 'warning',
        icon: '🟡',
        data: { type: 'context_limit', limit: '1m', percent: Math.round(ctx / 10_000), tokens: ctx },
      }]
    }
    return []
  }

  if (ctx >= 180_000) {
    return [{
      id: 'ctx-limit-200k',
      severity: 'critical',
      icon: '🔴',
      data: { type: 'context_limit', limit: '200k', percent: Math.round(ctx / 2_000), tokens: ctx },
    }]
  }
  if (ctx >= 160_000) {
    return [{
      id: 'ctx-limit-200k',
      severity: 'warning',
      icon: '🟡',
      data: { type: 'context_limit', limit: '200k', percent: Math.round(ctx / 2_000), tokens: ctx },
    }]
  }

  return []
}

// ── Rule 3: Compactions ──

function assessCompactions(turns: Turn[], compacted: ReadonlySet<number>): Insight[] {
  if (compacted.size === 0) return []
  // 每個壓縮 = 它前面最後一次呼叫 → 它後面第一次呼叫；細節描述最近一次
  const last = Math.max(...compacted)
  return [{
    id: 'compactions',
    severity: 'info',
    icon: '📦',
    data: {
      type: 'compaction',
      count: compacted.size,
      turn: last + 1,
      before: turns[last - 1].contextTotal,
      after: turns[last].contextTotal,
    },
  }]
}

// ── Rule 4: Cache Breaks ──
//
// 取代舊的「命中率 >70% 運作良好 / <30% 僅 N%」：命中率吃對話長度（每次呼叫重讀整段前綴，越長越接近 100%），
// 分不出快取有沒有壞掉——2026-09-30 實測 1,707 個 session 有 93.3% 被判良好，整段重寫 0–9 次的全部判良好。
// 有鑑別力的是「這次呼叫幾乎沒讀到上一次的整段 prompt」＝前綴斷了、整段重寫。

/** 讀到的不到上一次 prompt 的這個比例 → 整段重寫 */
const REWRITE_READ_RATIO = 0.5
/** 且 prompt 沒縮到上一次的這個比例以下（縮了是 rewind 或壓縮，沒有東西被重送） */
const REWRITE_KEEP_RATIO = 0.8
/** 間隔達此分鐘數視為閒置過期（2026-09-30 實測：<40 分鐘重寫 ≤5%、≥60 分鐘 91–94%；訂閱額度內主對話 TTL 1 小時） */
const IDLE_EXPIRED_MINUTES = 60
/** API key／超額時主對話 TTL 只有 5 分鐘 */
const SHORT_TTL_MINUTES = 5
const MAX_LISTED_IDLE = 3

/** 閒置過期一定量得到間隔；其他原因的間隔可能不知道（缺時間戳） */
type CacheBreak =
  | { turn: number; cause: 'idle_expired'; gapMinutes: number; rewrittenTokens: number }
  | { turn: number; cause: 'model_switch' | 'unknown'; gapMinutes: number | null; rewrittenTokens: number }

function minutesBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null
  const a = Date.parse(from)
  const b = Date.parse(to)
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null
  return (b - a) / 60_000
}

function findCacheBreaks(turns: Turn[], compacted: ReadonlySet<number>): CacheBreak[] {
  const breaks: CacheBreak[] = []
  for (let i = 1; i < turns.length; i++) {
    const prev = turns[i - 1]
    const cur = turns[i]
    // 沒有快取可以斷：上一次沒用到快取（不支援 prompt caching 的供應商）、或這次沒寫入任何東西（prompt 太短沒法快取）
    if (prev.cacheReadTokens + prev.cacheCreationTokens === 0 || cur.cacheCreationTokens === 0) continue
    // 壓縮後的第一次呼叫本來就要整段重寫
    if (compacted.has(i)) continue

    const rewrote = cur.cacheReadTokens < prev.contextTotal * REWRITE_READ_RATIO
      && cur.contextTotal >= prev.contextTotal * REWRITE_KEEP_RATIO
    if (!rewrote) continue

    const turn = i + 1
    const gap = minutesBetween(prev.timestamp, cur.timestamp)
    const rewrittenTokens = cur.cacheCreationTokens
    if (prev.model && cur.model && prev.model !== cur.model) {
      breaks.push({ turn, cause: 'model_switch', gapMinutes: gap, rewrittenTokens })
    } else if (gap != null && gap >= IDLE_EXPIRED_MINUTES) {
      breaks.push({ turn, cause: 'idle_expired', gapMinutes: gap, rewrittenTokens })
    } else {
      breaks.push({ turn, cause: 'unknown', gapMinutes: gap, rewrittenTokens })
    }
  }
  return breaks
}

function assessCacheBreaks(turns: Turn[], compacted: ReadonlySet<number>): Insight[] {
  const breaks = findCacheBreaks(turns, compacted)
  if (breaks.length === 0) return []

  const idle = breaks.filter(b => b.cause === 'idle_expired')
  const modelSwitch = breaks.filter(b => b.cause === 'model_switch')
  const unknown = breaks.filter(b => b.cause === 'unknown')
  const unknownLong = unknown.filter(b => b.gapMinutes != null && b.gapMinutes >= SHORT_TTL_MINUTES).length
  const rewrittenTokens = breaks.reduce((sum, b) => sum + b.rewrittenTokens, 0)

  const insights: Insight[] = [{
    id: 'cache-breaks',
    // 閒置過期與換模型是使用者做得了什麼的；原因不明的只是事實
    severity: idle.length + modelSwitch.length > 0 ? 'warning' : 'info',
    icon: idle.length > 0 ? '⏰' : '🔄',
    data: {
      type: 'cache_breaks',
      total: breaks.length,
      idle: idle.length,
      modelSwitch: modelSwitch.length,
      unknown: unknown.length,
      unknownLong,
      rewrittenTokens,
    },
  }]

  // 逐筆只列閒置過期（唯一有具體建議的原因），依重寫量取前幾；完整清單留給事件時間軸
  const biggestIdle = [...idle].sort((a, b) => b.rewrittenTokens - a.rewrittenTokens).slice(0, MAX_LISTED_IDLE)
  for (const b of biggestIdle) {
    insights.push({
      id: `cache-idle-${b.turn}`,
      severity: 'warning',
      icon: '⏰',
      data: {
        type: 'cache_idle_expired',
        turn: b.turn,
        gapMinutes: Math.round(b.gapMinutes),
        rewrittenTokens: b.rewrittenTokens,
      },
      turnRef: b.turn,
    })
  }
  return insights
}

// ── Rule 5: Output Hot Spot ──

function detectOutputHotSpots(turns: SessionTokenStats['turns']): Insight[] {
  if (turns.length < 3) return []

  let totalOutput = 0
  let maxIdx = 0
  turns.forEach((t, i) => {
    totalOutput += t.outputTokens
    if (t.outputTokens > turns[maxIdx].outputTokens) maxIdx = i
  })
  const max = turns[maxIdx]

  const avgOutput = totalOutput / turns.length
  if (avgOutput === 0) return []

  if (max.outputTokens > avgOutput * 3 && max.outputTokens > 2_000) {
    const call = maxIdx + 1
    return [{
      id: `hotspot-${call}`,
      severity: 'info',
      icon: '🔥',
      data: {
        type: 'output_hotspot',
        turn: call,
        tokens: max.outputTokens,
        tools: max.toolNames.slice(0, 4),
      },
      turnRef: call,
    }]
  }

  return []
}

// ── Rule 6: Growth Rate Analysis ──

function analyzeGrowthRate(turns: Turn[], compacted: ReadonlySet<number>): Insight[] {
  if (turns.length < 10) return []

  const mid = Math.floor(turns.length / 2)

  let firstHalfSum = 0
  let firstHalfCount = 0
  let secondHalfSum = 0
  let secondHalfCount = 0
  for (let i = 1; i < turns.length; i++) {
    // 壓縮造成的下降不是「負成長」：不排除的話倍率會變負（實測 9/26 的 8bbffb1d 顯示「減慢（-0.2x）」）
    if (compacted.has(i)) continue
    const delta = turns[i].inputTokens - turns[i - 1].inputTokens
    if (i <= mid) {
      firstHalfSum += delta
      firstHalfCount++
    } else {
      secondHalfSum += delta
      secondHalfCount++
    }
  }
  if (firstHalfCount === 0 || secondHalfCount === 0) return []

  const avgFirst = firstHalfSum / firstHalfCount
  const avgSecond = secondHalfSum / secondHalfCount

  if (avgFirst <= 0) return []

  const ratio = avgSecond / avgFirst

  if (ratio > 2.0) {
    return [{
      id: 'growth-accel',
      severity: 'warning',
      icon: '📈',
      data: { type: 'growth_accel', ratio },
    }]
  }

  if (ratio < 0.5) {
    return [{
      id: 'growth-decel',
      severity: 'good',
      icon: '📉',
      data: { type: 'growth_decel', ratio },
    }]
  }

  return []
}

// ── Display order ──

const SEVERITY_ORDER: Record<InsightSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
  good: 3,
}

/** 「這場對話發生過的事」，相對於各種對數字的觀察（暴增、熱點、成長） */
const EVENT_TYPES: ReadonlySet<InsightData['type']> = new Set(['compaction', 'cache_breaks', 'cache_idle_expired'])

/**
 * 面板預設只顯示前 3 條，其餘收在「顯示其他 N 筆」後面。長 session 的「context 暴增」動輒好幾條（warning），
 * 只照嚴重度排的話，壓縮（info）與原因不明的快取中斷（info）會被擠到後面——9/26 那場「對話被壓縮」排第 4 條、
 * 預設看不到，正好違背「看得出有沒有 compact」。所以：快撞到 context 上限（critical）最急，其次是發生過的事，
 * 最後才是各種觀察。發生過的事之間照產生順序（壓縮 → 快取中斷 → 閒置過期，見 generateInsights），
 * 觀察之間照嚴重度。顏色仍由 severity 決定，不為了排序把 info 升成 warning。
 */
function displayRank(insight: Insight): number {
  if (insight.severity === 'critical') return 0
  if (EVENT_TYPES.has(insight.data.type)) return 1
  return 2 + SEVERITY_ORDER[insight.severity]
}

// ── Public API ──

export function generateInsights(stats: SessionTokenStats): Insight[] {
  const compacted = compactedCallIndexes(stats.turns, stats.compactions)
  // 同一層內保持這個順序（sort 是穩定的）：壓縮在快取中斷前面
  const insights: Insight[] = [
    ...assessCompactions(stats.turns, compacted),
    ...assessCacheBreaks(stats.turns, compacted),
    ...detectContextSpikes(stats.turns, compacted),
    ...assessContextLimit(stats.turns),
    ...detectOutputHotSpots(stats.turns),
    ...analyzeGrowthRate(stats.turns, compacted),
  ]

  insights.sort((a, b) => displayRank(a) - displayRank(b))
  return insights
}
