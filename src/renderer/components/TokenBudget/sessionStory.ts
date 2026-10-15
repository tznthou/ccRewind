import type { SessionTokenStats } from '../../../shared/types'
import type { MessageKey, TranslateParams } from '../../i18n/messages'
import { formatTokens } from '../../utils/formatTokens'
import { compactedCallIndexes, contextWindowEvidence, findCacheBreaks, SHORT_TTL_MINUTES } from './insightEngine'

// Token Budget 面板的「這場發生了什麼」：facts 只放數字（不翻譯、不帶樣式），故事句、卡片、事件、建議、圖例
// 都從同一份 facts 組出來，面板算一次 facts、切語言只重組文字。

type Turn = SessionTokenStats['turns'][number]

// ── Facts ──

interface EventBase {
  /** `${kind}-${call}`：同一次呼叫不會同時是「壓縮後第一次」與快取中斷（規則已排除），所以不重複 */
  id: string
  /** 第幾次呼叫（1 起算），不是 JSONL sequence */
  call: number
  /** 距這場最早一次呼叫幾分鐘；這次呼叫的時間戳無效就是 null */
  minutesFromStart: number | null
}

/** 第 call 次呼叫前對話被壓縮：before＝前一次呼叫的整段 prompt，after＝這一次的 */
export type CompactionEvent = EventBase & { kind: 'compaction'; before: number; after: number }

export type CacheBreakEvent =
  | (EventBase & { kind: 'idle_expired'; gapMinutes: number; rewrittenTokens: number })
  | (EventBase & {
    kind: 'model_switch'
    gapMinutes: number | null
    rewrittenTokens: number
    fromModel: string
    toModel: string
  })
  | (EventBase & { kind: 'unknown'; gapMinutes: number | null; rewrittenTokens: number })

export type SessionEvent = CompactionEvent | CacheBreakEvent

export interface CauseTally {
  count: number
  rewrittenTokens: number
}

export interface SessionFacts {
  calls: number
  /** 最早到最晚一次呼叫（含中間離開的時間）；有效時間戳不到兩個就是 null，不寫成「不到 1 分鐘」 */
  durationMinutes: number | null
  maxContext: number
  /** 最先到達最長 context 的那次呼叫；沒有呼叫就是 null */
  maxContextCall: number | null
  lastContext: number
  windowEvidence: '1m' | null
  /** 壓縮與快取中斷，依呼叫序 */
  events: SessionEvent[]
  compactions: CompactionEvent[]
  cacheBreaks: CacheBreakEvent[]
  rewrittenTokens: number
  idle: CauseTally
  modelSwitch: CauseTally
  unknown: CauseTally
}

function parseTime(timestamp: string | null): number | null {
  if (!timestamp) return null
  const ms = Date.parse(timestamp)
  return Number.isNaN(ms) ? null : ms
}

/**
 * 每次呼叫距最早一次呼叫幾分鐘（時間戳無效的是 null），以及整場的時長。
 * 取最早與最晚而不是第一次與最後一次：時間倒退（03-07 那場 DB 有重複片段）時，時長不會縮短、也不會出現負的「開始後」。
 */
function callTimes(turns: Turn[]): { sinceStart: Array<number | null>; durationMinutes: number | null } {
  const times = turns.map(t => parseTime(t.timestamp))
  let earliest = Infinity
  let latest = -Infinity
  let valid = 0
  for (const ms of times) {
    if (ms == null) continue
    valid++
    if (ms < earliest) earliest = ms
    if (ms > latest) latest = ms
  }
  return {
    sinceStart: times.map(ms => (ms == null ? null : (ms - earliest) / 60_000)),
    durationMinutes: valid >= 2 ? (latest - earliest) / 60_000 : null,
  }
}

function tally(breaks: CacheBreakEvent[], kind: CacheBreakEvent['kind']): CauseTally {
  const matching = breaks.filter(b => b.kind === kind)
  return { count: matching.length, rewrittenTokens: matching.reduce((sum, b) => sum + b.rewrittenTokens, 0) }
}

export function buildSessionFacts(stats: SessionTokenStats): SessionFacts {
  const turns = stats.turns
  const { sinceStart, durationMinutes } = callTimes(turns)

  let maxContext = 0
  let maxContextCall: number | null = null
  turns.forEach((t, i) => {
    if (maxContextCall == null || t.contextTotal > maxContext) {
      maxContext = t.contextTotal
      maxContextCall = i + 1
    }
  })

  const compacted = compactedCallIndexes(turns, stats.compactions)
  const compactions: CompactionEvent[] = [...compacted].sort((a, b) => a - b).map(i => ({
    id: `compaction-${i + 1}`,
    kind: 'compaction',
    call: i + 1,
    minutesFromStart: sinceStart[i],
    before: turns[i - 1].contextTotal,
    after: turns[i].contextTotal,
  }))

  const cacheBreaks: CacheBreakEvent[] = findCacheBreaks(turns, compacted).map(b => {
    const i = b.turn - 1
    const base = { id: `${b.cause}-${b.turn}`, call: b.turn, minutesFromStart: sinceStart[i] }
    switch (b.cause) {
      case 'idle_expired':
        return { ...base, kind: 'idle_expired', gapMinutes: b.gapMinutes, rewrittenTokens: b.rewrittenTokens }
      case 'model_switch':
        // 規則只在前後兩次的模型都已知且不同時判成換模型
        return {
          ...base,
          kind: 'model_switch',
          gapMinutes: b.gapMinutes,
          rewrittenTokens: b.rewrittenTokens,
          fromModel: turns[i - 1].model ?? '',
          toModel: turns[i].model ?? '',
        }
      case 'unknown':
        return { ...base, kind: 'unknown', gapMinutes: b.gapMinutes, rewrittenTokens: b.rewrittenTokens }
    }
  })

  return {
    calls: turns.length,
    durationMinutes,
    maxContext,
    maxContextCall,
    lastContext: turns.length > 0 ? turns[turns.length - 1].contextTotal : 0,
    windowEvidence: contextWindowEvidence(turns),
    events: [...compactions, ...cacheBreaks].sort((a, b) => a.call - b.call),
    compactions,
    cacheBreaks,
    rewrittenTokens: cacheBreaks.reduce((sum, b) => sum + b.rewrittenTokens, 0),
    idle: tally(cacheBreaks, 'idle_expired'),
    modelSwitch: tally(cacheBreaks, 'model_switch'),
    unknown: tally(cacheBreaks, 'unknown'),
  }
}

/** 最長 context 是 1M 的幾 %（四捨五入）；沒有 1M 證據就不算，不拿 200K 去除 */
export function windowPercent(facts: SessionFacts): number | null {
  return facts.windowEvidence === '1m' ? Math.round(facts.maxContext / 10_000) : null
}

/** 上限線預設：有 1M 證據才畫 1M，沒證據不畫（不猜 200K） */
export function defaultLimit(facts: SessionFacts): '1m' | 'none' {
  return facts.windowEvidence === '1m' ? '1m' : 'none'
}

/** 沒有 1M 證據、最長 context 又到這裡時，提一句「看不出視窗是 200K 還是 1M」 */
const UNKNOWN_WINDOW_MENTION = 160_000

// ── 時間軸標記 ──

/** 快取中斷只畫重寫量最大的這幾個，其餘在清單 */
export const MAX_BREAK_MARKERS = 5
/** 壓縮次數不超過這個才加圖示 */
const COMPACTION_ICON_MAX = 5
/** 壓縮超過這麼多次，直線改淡色 */
const FAINT_COMPACTIONS_OVER = 20

export interface TimelineMarkers {
  compactions: CompactionEvent[]
  compactionIcons: boolean
  faintCompactions: boolean
  /** 依呼叫序 */
  breaks: CacheBreakEvent[]
  hiddenBreaks: number
}

export function timelineMarkers(facts: SessionFacts): TimelineMarkers {
  // 重寫量大的優先，同量取較早的；選完照呼叫序排
  const breaks = [...facts.cacheBreaks]
    .sort((a, b) => b.rewrittenTokens - a.rewrittenTokens || a.call - b.call)
    .slice(0, MAX_BREAK_MARKERS)
    .sort((a, b) => a.call - b.call)
  const compactions = facts.compactions
  return {
    compactions,
    compactionIcons: compactions.length <= COMPACTION_ICON_MAX,
    faintCompactions: compactions.length > FAINT_COMPACTIONS_OVER,
    breaks,
    hiddenBreaks: facts.cacheBreaks.length - breaks.length,
  }
}

/** 事件超過這麼多筆，清單先分類彙總 */
export const EVENT_LIST_MAX = 6

export function eventsNeedSummary(facts: SessionFacts): boolean {
  return facts.events.length > EVENT_LIST_MAX
}

// ── 文案 ──

export type Translate = (key: MessageKey, params?: TranslateParams) => string

export interface TextPart {
  text: string
  strong: boolean
}

const PLACEHOLDER = /\{(\w+)\}/g

/**
 * 把模板依 `{k}` 切成片段，參數值整段成為一個片段，名字在 strong 裡的標成粗體。`t(key)` 不帶參數時回傳原始模板，
 * 所以粗體不必改 `t` 的介面。沒給值的占位符原樣留著，「殘留 `{…}`」的測試才抓得到。
 */
export function fillTemplate(
  template: string,
  params: Record<string, string> = {},
  strong: ReadonlySet<string> = new Set(),
): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const m of template.matchAll(PLACEHOLDER)) {
    if (m.index > last) parts.push({ text: template.slice(last, m.index), strong: false })
    const value = params[m[1]]
    parts.push(value === undefined ? { text: m[0], strong: false } : { text: value, strong: strong.has(m[1]) })
    last = m.index + m[0].length
  }
  if (last < template.length) parts.push({ text: template.slice(last), strong: false })
  return parts
}

const formatCount = (n: number) => n.toLocaleString('en-US')

/**
 * 面板用的長格式時長。一律無條件捨去，跟側欄的 `formatDuration` 同一慣例；規則的門檻（閒置 ≥60 分、短 TTL ≥5 分）
 * 都是對原始分鐘數比較，捨去才保證「畫面上的數字過門檻 ⇔ 規則過門檻」（四捨五入會讓 59.6 分顯示成 1 小時卻不算閒置過期）。
 */
export function formatSpan(minutes: number, t: Translate): string {
  const m = Math.floor(minutes)
  if (m < 1) return t('tokenBudget.span.underMinute')
  if (m < 60) return t('tokenBudget.span.minutes', { m })
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? t('tokenBudget.span.hours', { h }) : t('tokenBudget.span.hoursMinutes', { h, m: rest })
}

const isIdle = (b: CacheBreakEvent): b is Extract<CacheBreakEvent, { kind: 'idle_expired' }> => b.kind === 'idle_expired'

const STRONG_HEAD: ReadonlySet<string> = new Set(['duration', 'calls', 'maxContext'])
const STRONG_PERCENT: ReadonlySet<string> = new Set(['percent'])

export function storyParts(facts: SessionFacts, t: Translate): TextPart[] {
  const calls = t(facts.calls === 1 ? 'tokenBudget.story.calls.one' : 'tokenBudget.story.calls.other', { count: formatCount(facts.calls) })
  const maxContext = t('tokenBudget.story.tokens', { tokens: formatTokens(facts.maxContext) })
  const parts = facts.durationMinutes != null
    ? fillTemplate(t('tokenBudget.story.head'), { duration: formatSpan(facts.durationMinutes, t), calls, maxContext }, STRONG_HEAD)
    : fillTemplate(t('tokenBudget.story.headNoDuration'), { calls, maxContext }, STRONG_HEAD)

  const percent = windowPercent(facts)
  if (percent != null) {
    parts.push(...fillTemplate(t('tokenBudget.story.window1m'), { percent: t('tokenBudget.story.percent', { percent }) }, STRONG_PERCENT))
  } else {
    parts.push(...fillTemplate(t(facts.maxContext >= UNKNOWN_WINDOW_MENTION ? 'tokenBudget.story.windowUnknown' : 'tokenBudget.story.windowNone')))
  }

  const compactions = facts.compactions
  if (compactions.length === 1) {
    const c = compactions[0]
    parts.push(...fillTemplate(t('tokenBudget.story.compactedOnce'), {
      call: formatCount(c.call), before: formatTokens(c.before), after: formatTokens(c.after),
    }))
  } else if (compactions.length > 1) {
    parts.push(...fillTemplate(t('tokenBudget.story.compactedMany'), { count: formatCount(compactions.length) }))
  }

  const breaks = facts.cacheBreaks
  if (breaks.length === 0) {
    parts.push(...fillTemplate(t(compactions.length === 0 ? 'tokenBudget.story.cacheClean' : 'tokenBudget.story.cacheIntact')))
    return parts
  }
  parts.push(...fillTemplate(t(breaks.length === 1 ? 'tokenBudget.story.cacheBroken.one' : 'tokenBudget.story.cacheBroken.other'), {
    count: formatCount(breaks.length), tokens: formatTokens(facts.rewrittenTokens),
  }))
  const idle = breaks.filter(isIdle)
  if (idle.length === 1) {
    // 只中斷一次而且就是那次閒置：不說「其中 1 次」
    const key = breaks.length === 1 ? 'tokenBudget.story.cacheIdleOnly' : 'tokenBudget.story.cacheIdleOnce'
    parts.push(...fillTemplate(t(key), { gap: formatSpan(idle[0].gapMinutes, t) }))
  } else if (idle.length > 1) {
    parts.push(...fillTemplate(t('tokenBudget.story.cacheIdleMany'), { count: formatCount(idle.length) }))
  }
  parts.push(...fillTemplate(t('tokenBudget.story.end')))
  return parts
}

export type NumberCardId = 'duration' | 'calls' | 'maxContext' | 'compactions' | 'cacheBreaks'

export interface NumberCard {
  id: NumberCardId
  label: string
  value: string
  sub: string | null
}

export function numberCards(facts: SessionFacts, t: Translate): NumberCard[] {
  const count = (n: number) => t('tokenBudget.card.count', { count: formatCount(n) })
  const percent = windowPercent(facts)
  const maxContextSub = percent != null
    ? t('tokenBudget.card.maxContextSub1m', { percent })
    : facts.maxContext >= UNKNOWN_WINDOW_MENTION ? t('tokenBudget.card.maxContextSubUnknown') : null
  const breaks = facts.cacheBreaks.length
  return [
    facts.durationMinutes != null
      ? { id: 'duration', label: t('tokenBudget.card.duration'), value: formatSpan(facts.durationMinutes, t), sub: t('tokenBudget.card.durationSub') }
      : { id: 'duration', label: t('tokenBudget.card.duration'), value: t('tokenBudget.card.noValue'), sub: null },
    { id: 'calls', label: t('tokenBudget.card.calls'), value: count(facts.calls), sub: null },
    { id: 'maxContext', label: t('tokenBudget.card.maxContext'), value: formatTokens(facts.maxContext), sub: maxContextSub },
    { id: 'compactions', label: t('tokenBudget.card.compactions'), value: count(facts.compactions.length), sub: null },
    {
      id: 'cacheBreaks',
      label: t('tokenBudget.card.cacheBreaks'),
      value: count(breaks),
      sub: breaks > 0 ? t('tokenBudget.card.cacheBreaksSub', { tokens: formatTokens(facts.rewrittenTokens) }) : null,
    },
  ]
}

/** 閒置過期與換模型是使用者做得了什麼的（warning）；壓縮與原因不明只是事實（info） */
export type Tone = 'warning' | 'info'

export interface ListItem {
  id: string
  icon: string
  tone: Tone
  title: string
  detail: string
}

const EVENT_ICON: Record<SessionEvent['kind'], string> = {
  compaction: '📦',
  idle_expired: '⏰',
  model_switch: '🔄',
  unknown: '⚠️',
}

const EVENT_TONE: Record<SessionEvent['kind'], Tone> = {
  compaction: 'info',
  idle_expired: 'warning',
  model_switch: 'warning',
  unknown: 'info',
}

/** 「 · 開始後 D」；時間不明就整段省略 */
function sinceText(minutes: number | null, t: Translate): string {
  if (minutes == null) return ''
  if (Math.floor(minutes) < 1) return t('tokenBudget.events.sinceStart')
  return t('tokenBudget.events.since', { span: formatSpan(minutes, t) })
}

function eventItem(e: SessionEvent, t: Translate): ListItem {
  const base = { id: e.id, icon: EVENT_ICON[e.kind], tone: EVENT_TONE[e.kind] }
  const call = formatCount(e.call)
  switch (e.kind) {
    case 'compaction':
      return {
        ...base,
        title: t('tokenBudget.events.compaction.title', { before: formatTokens(e.before), after: formatTokens(e.after) }),
        detail: t('tokenBudget.events.compaction.detail', { call, since: sinceText(e.minutesFromStart, t) }),
      }
    case 'idle_expired':
      return {
        ...base,
        title: t('tokenBudget.events.idle.title', { gap: formatSpan(e.gapMinutes, t), tokens: formatTokens(e.rewrittenTokens) }),
        detail: t('tokenBudget.events.idle.detail', { call, since: sinceText(e.minutesFromStart, t) }),
      }
    case 'model_switch':
      return {
        ...base,
        title: t('tokenBudget.events.modelSwitch.title', { tokens: formatTokens(e.rewrittenTokens) }),
        detail: t('tokenBudget.events.modelSwitch.detail', { call, from: e.fromModel, to: e.toModel }),
      }
    case 'unknown': {
      const gap = e.gapMinutes == null ? '' : t('tokenBudget.events.gapSincePrevious', { span: formatSpan(e.gapMinutes, t) })
      // API key／超額時快取只保留 5 分鐘：間隔夠長的「原因不明」可能就是這樣過期的
      const shortTtl = e.gapMinutes != null && e.gapMinutes >= SHORT_TTL_MINUTES ? t('tokenBudget.events.unknown.shortTtl') : ''
      return {
        ...base,
        title: t('tokenBudget.events.unknown.title', { tokens: formatTokens(e.rewrittenTokens) }),
        detail: t('tokenBudget.events.unknown.detail', { call, gap }) + shortTtl,
      }
    }
  }
}

export function eventItems(facts: SessionFacts, t: Translate): ListItem[] {
  return facts.events.map(e => eventItem(e, t))
}

/** 事件太多時的彙總：只列發生過的種類 */
export function eventSummaryRows(facts: SessionFacts, t: Translate): ListItem[] {
  const rows: ListItem[] = []
  const compactions = facts.compactions
  if (compactions.length > 0) {
    const latest = compactions[compactions.length - 1]
    rows.push({
      id: 'summary-compactions',
      icon: EVENT_ICON.compaction,
      tone: EVENT_TONE.compaction,
      title: t(compactions.length === 1 ? 'tokenBudget.events.summary.compactions.one' : 'tokenBudget.events.summary.compactions.other', {
        count: formatCount(compactions.length),
      }),
      detail: t('tokenBudget.events.summary.compactionsLatest', {
        call: formatCount(latest.call), before: formatTokens(latest.before), after: formatTokens(latest.after),
      }),
    })
  }
  const breaks = facts.cacheBreaks.length
  if (breaks > 0) {
    const { idle, modelSwitch, unknown } = facts
    const causes: string[] = []
    if (idle.count > 0) causes.push(t('tokenBudget.events.summary.idle', { count: formatCount(idle.count) }))
    if (modelSwitch.count > 0) causes.push(t('tokenBudget.events.summary.modelSwitch', { count: formatCount(modelSwitch.count) }))
    if (unknown.count > 0) causes.push(t('tokenBudget.events.summary.unknown', { count: formatCount(unknown.count) }))
    rows.push({
      id: 'summary-cache-breaks',
      icon: idle.count > 0 ? EVENT_ICON.idle_expired : modelSwitch.count > 0 ? EVENT_ICON.model_switch : EVENT_ICON.unknown,
      tone: idle.count + modelSwitch.count > 0 ? 'warning' : 'info',
      title: t(breaks === 1 ? 'tokenBudget.events.summary.breaks.one' : 'tokenBudget.events.summary.breaks.other', {
        count: formatCount(breaks), tokens: formatTokens(facts.rewrittenTokens),
      }),
      detail: causes.join(t('tokenBudget.events.summary.separator')),
    })
  }
  return rows
}

export interface EventListText {
  title: string
  /** 「N 件，依時間排序」；沒有事件就不寫 */
  subtitle: string | null
  empty: string
  /** 彙總展開成完整清單的按鈕 */
  expand: string
  collapse: string
}

export function eventListText(facts: SessionFacts, t: Translate): EventListText {
  const n = facts.events.length
  return {
    title: t('tokenBudget.events.title'),
    subtitle: n === 0
      ? null
      : t(n === 1 ? 'tokenBudget.events.subtitle.one' : 'tokenBudget.events.subtitle.other', { count: formatCount(n) }),
    empty: t('tokenBudget.events.empty'),
    expand: t('tokenBudget.events.expand', { count: formatCount(n) }),
    collapse: t('tokenBudget.events.collapse'),
  }
}

/** 只放這場真的發生過的，各一條、附本場數字；順序 閒置 → 換模型 → 不明 */
export function adviceItems(facts: SessionFacts, t: Translate): ListItem[] {
  const items: ListItem[] = []
  const idle = facts.cacheBreaks.filter(isIdle)
  if (idle.length > 0) {
    // 引重寫量最大的那次；同量取較早的（idle 已依呼叫序，嚴格大於才換）
    const biggest = idle.reduce((best, b) => (b.rewrittenTokens > best.rewrittenTokens ? b : best))
    const more = idle.length > 1
      ? t('tokenBudget.advice.idle.more', { count: formatCount(idle.length), tokens: formatTokens(facts.idle.rewrittenTokens) })
      : ''
    items.push({
      id: 'advice-idle',
      icon: EVENT_ICON.idle_expired,
      tone: 'warning',
      title: t('tokenBudget.advice.idle.title'),
      detail: t('tokenBudget.advice.idle.detail', { call: formatCount(biggest.call), tokens: formatTokens(biggest.rewrittenTokens), more }),
    })
  }
  const { modelSwitch, unknown } = facts
  if (modelSwitch.count > 0) {
    items.push({
      id: 'advice-model-switch',
      icon: EVENT_ICON.model_switch,
      tone: 'warning',
      title: t('tokenBudget.advice.modelSwitch.title'),
      detail: t(modelSwitch.count === 1 ? 'tokenBudget.advice.modelSwitch.detail.one' : 'tokenBudget.advice.modelSwitch.detail.other', {
        count: formatCount(modelSwitch.count), tokens: formatTokens(modelSwitch.rewrittenTokens),
      }),
    })
  }
  if (unknown.count > 0) {
    items.push({
      id: 'advice-unknown',
      icon: EVENT_ICON.unknown,
      tone: 'info',
      title: t(unknown.count === 1 ? 'tokenBudget.advice.unknown.title.one' : 'tokenBudget.advice.unknown.title.other', {
        count: formatCount(unknown.count),
      }),
      detail: t('tokenBudget.advice.unknown.detail', { tokens: formatTokens(unknown.rewrittenTokens) }),
    })
  }
  return items
}

export type LegendId = 'area' | 'compaction' | 'idle_expired' | 'model_switch' | 'unknown' | 'overflow'

export interface LegendItem {
  id: LegendId
  text: string
}

/** 圖下的白話圖例：面積說明 + 這場圖上真的有畫的標記 */
export function legendItems(facts: SessionFacts, t: Translate): LegendItem[] {
  const markers = timelineMarkers(facts)
  const items: LegendItem[] = [{ id: 'area', text: t('tokenBudget.chart.legend.area') }]
  if (markers.compactions.length > 0) items.push({ id: 'compaction', text: t('tokenBudget.chart.legend.compaction') })
  const drawn = new Set(markers.breaks.map(b => b.kind))
  if (drawn.has('idle_expired')) items.push({ id: 'idle_expired', text: t('tokenBudget.chart.legend.idle') })
  if (drawn.has('model_switch')) items.push({ id: 'model_switch', text: t('tokenBudget.chart.legend.modelSwitch') })
  if (drawn.has('unknown')) items.push({ id: 'unknown', text: t('tokenBudget.chart.legend.unknown') })
  if (markers.hiddenBreaks > 0) items.push({ id: 'overflow', text: t('tokenBudget.chart.legend.overflow', { count: MAX_BREAK_MARKERS }) })
  return items
}

// ── 圖表 ──

export interface ChartRow {
  call: number
  context: number
  cacheRead: number
  cacheWrite: number
  output: number
  minutesFromStart: number | null
  /** 這次呼叫的所有事件（含沒被畫成標記的），tooltip 用 */
  eventIds: string[]
}

export function chartRows(stats: SessionTokenStats, facts: SessionFacts): ChartRow[] {
  const { sinceStart } = callTimes(stats.turns)
  const byCall = new Map<number, string[]>()
  for (const e of facts.events) {
    const ids = byCall.get(e.call)
    if (ids) ids.push(e.id)
    else byCall.set(e.call, [e.id])
  }
  return stats.turns.map((turn, i) => ({
    call: i + 1,
    context: turn.contextTotal,
    cacheRead: turn.cacheReadTokens,
    cacheWrite: turn.cacheCreationTokens,
    output: turn.outputTokens,
    minutesFromStart: sinceStart[i],
    eventIds: byCall.get(i + 1) ?? [],
  }))
}

export interface TooltipContent {
  head: string
  length: string
  breakdown: string
  events: string[]
}

/** eventTitles：事件 id → 標題（`eventItems` 產生，面板算一次） */
export function tooltipContent(row: ChartRow, eventTitles: ReadonlyMap<string, string>, t: Translate): TooltipContent {
  return {
    head: t('tokenBudget.chart.tooltipHead', { call: formatCount(row.call), since: sinceText(row.minutesFromStart, t) }),
    length: t('tokenBudget.chart.tooltipLength', { tokens: formatTokens(row.context) }),
    breakdown: t('tokenBudget.chart.tooltipBreakdown', {
      read: formatTokens(row.cacheRead), write: formatTokens(row.cacheWrite), output: formatTokens(row.output),
    }),
    events: row.eventIds.flatMap(id => {
      const title = eventTitles.get(id)
      return title === undefined ? [] : [title]
    }),
  }
}
