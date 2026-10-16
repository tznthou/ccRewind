import { describe, it, expect } from 'vitest'
import { messages, translate } from '../src/renderer/i18n/messages'
import {
  adviceEmptyText,
  buildSessionFacts,
  chartRows,
  defaultLimit,
  eventItems,
  eventListText,
  eventSummaryRows,
  eventsNeedSummary,
  adviceItems,
  fillTemplate,
  formatSpan,
  legendItems,
  numberCards,
  storyParts,
  timelineMarkers,
  tooltipContent,
  windowPercent,
  type ListItem,
  type NumberCard,
  type SessionFacts,
  type TextPart,
  type Translate,
} from '../src/renderer/components/TokenBudget/sessionStory'
import type { SessionTokenStats } from '../src/shared/types'
import { call, makeStats, makeTurn, ts, type Turn } from './fixtures/tokenStats'

// ── Helpers ──

const tZh: Translate = (key, params) => translate('zh-TW', key, params)
const tEn: Translate = (key, params) => translate('en', key, params)

const text = (parts: TextPart[]) => parts.map(p => p.text).join('')
const bold = (parts: TextPart[]) => parts.filter(p => p.strong).map(p => p.text)

/** facts 是從哪份 stats 算出來的（i18n 覆蓋測試要畫 tooltip） */
const statsOf = new WeakMap<SessionFacts, SessionTokenStats>()

const factsOf = (turns: Turn[], compactions: SessionTokenStats['compactions'] = []) => {
  const stats = makeStats(turns, { compactions })
  const facts = buildSessionFacts(stats)
  statsOf.set(facts, stats)
  return facts
}

type BreakSpec = { cause: 'idle' | 'switch' | 'unknown'; rewritten: number; gap?: number }

/**
 * 從 100K 開始。每個中斷之後接一次正常呼叫（讀得到上一次的整段 prompt），所以第 k 個中斷（0 起算）在第 2 + 2k 次呼叫。
 * 閒置預設離開 120 分、其他預設間隔 2 分；換模型在 opus / sonnet 之間切換。重寫量要 ≤ 100K 才會原樣算進去。
 */
function withBreaks(spec: BreakSpec[]): Turn[] {
  let seq = 1
  let minute = 0
  let prevCtx = 100_000
  let model = 'claude-opus-4-6'
  const turns = [call({ sequence: seq, ctx: prevCtx, read: 0, write: prevCtx, minute, model })]
  for (const b of spec) {
    minute += b.gap ?? (b.cause === 'idle' ? 120 : 2)
    if (b.cause === 'switch') model = model === 'claude-opus-4-6' ? 'claude-sonnet-4-6' : 'claude-opus-4-6'
    const ctx = prevCtx + 1_000
    turns.push(call({ sequence: ++seq, ctx, read: 0, write: b.rewritten, minute, model }))
    minute += 1
    prevCtx = ctx + 1_000
    turns.push(call({ sequence: ++seq, ctx: prevCtx, read: ctx, write: 1_000, minute, model }))
  }
  return turns
}

/** n 次壓縮：每兩次呼叫之間夾一則摘要，呼叫每分鐘一次；第 k 次壓縮（1 起算）在第 k + 1 次呼叫前 */
function compactedSession(n: number): { turns: Turn[]; compactions: SessionTokenStats['compactions'] } {
  const turns: Turn[] = []
  const compactions: SessionTokenStats['compactions'] = []
  for (let i = 0; i <= n; i++) {
    turns.push(call({ sequence: 10 + i * 20, ctx: i % 2 === 0 ? 150_000 : 30_000, read: 0, write: 10_000, minute: i }))
    if (i < n) compactions.push({ sequence: 20 + i * 20 })
  }
  return { turns, compactions }
}

// 8bbffb1d 的形狀：壓縮一次 412,645 → 85,466
const compactedOnce = () => factsOf([
  call({ sequence: 10, ctx: 412_645, read: 400_000, write: 12_645, minute: 0 }),
  call({ sequence: 30, ctx: 85_466, read: 0, write: 85_466, minute: 198.24 }),
], [{ sequence: 20 }])

// 894f3b4a 的形狀：離開 2 小時 38 分（含）回來重寫，之後一次原因不明、間隔 11 分
const idleThenUnknown = () => factsOf(withBreaks([
  { cause: 'idle', rewritten: 99_000, gap: 158.5 },
  { cause: 'unknown', rewritten: 50_000, gap: 11 },
]))

// 什麼都沒發生的長對話（a8874a38 的形狀，縮短）
const quiet = () => factsOf([
  call({ sequence: 1, ctx: 10_000, read: 0, write: 10_000, minute: 0 }),
  call({ sequence: 2, ctx: 11_000, read: 10_000, write: 1_000, minute: 30 }),
  call({ sequence: 3, ctx: 12_000, read: 11_000, write: 1_000, minute: 100.56 }),
])

// 每種事件都有：閒置 2（第 2、8 次）、換模型 1（第 4 次）、原因不明 2（第 6、10 次）
const everyCause = () => factsOf(withBreaks([
  { cause: 'idle', rewritten: 50_000 },
  { cause: 'switch', rewritten: 30_000 },
  { cause: 'unknown', rewritten: 10_000 },
  { cause: 'idle', rewritten: 90_000 },
  { cause: 'unknown', rewritten: 20_000 },
]))

// 壓縮兩次、閒置兩次、原因不明一次，最長 171K 但沒有 1M 證據
const busyNoEvidence = () => factsOf([
  call({ sequence: 10, ctx: 170_000, read: 0, write: 170_000, minute: 0 }),
  call({ sequence: 20, ctx: 171_000, read: 170_000, write: 1_000, minute: 1 }),
  call({ sequence: 30, ctx: 40_000, read: 0, write: 40_000, minute: 2 }),
  call({ sequence: 40, ctx: 41_000, read: 40_000, write: 1_000, minute: 3 }),
  call({ sequence: 50, ctx: 42_000, read: 0, write: 41_000, minute: 100 }),
  call({ sequence: 60, ctx: 43_000, read: 42_000, write: 1_000, minute: 101 }),
  call({ sequence: 70, ctx: 20_000, read: 0, write: 20_000, minute: 102 }),
  call({ sequence: 80, ctx: 21_000, read: 20_000, write: 1_000, minute: 103 }),
  call({ sequence: 90, ctx: 22_000, read: 0, write: 21_000, minute: 200 }),
  call({ sequence: 100, ctx: 23_000, read: 22_000, write: 1_000, minute: 201 }),
  call({ sequence: 110, ctx: 24_000, read: 0, write: 23_000, minute: 203 }),
], [{ sequence: 25 }, { sequence: 65 }])

/** 只有一個數字的最長 context，用來測卡片副字 */
const maxOnly = (...contexts: number[]) => factsOf(contexts.map((ctx, i) => call({ sequence: i + 1, ctx, minute: i })))

const card = (facts: SessionFacts, id: string, t: Translate = tZh) => numberCards(facts, t).find(c => c.id === id)!

// ── Facts（只驗數字，跟文案分開） ──

describe('buildSessionFacts', () => {
  it('measures the duration from the earliest to the latest call', () => {
    const facts = quiet()
    expect(facts.calls).toBe(3)
    expect(facts.durationMinutes).toBeCloseTo(100.56, 6)
    expect(facts.events).toEqual([])
  })

  it('takes the earliest and latest timestamps, so time going backwards neither shortens the span nor makes “since start” negative', () => {
    const facts = factsOf([
      call({ sequence: 10, ctx: 150_000, read: 0, write: 150_000, minute: 10 }),
      call({ sequence: 20, ctx: 151_000, read: 150_000, write: 1_000, minute: 50 }),
      call({ sequence: 40, ctx: 30_000, read: 0, write: 30_000, minute: 5 }),
      call({ sequence: 50, ctx: 31_000, read: 30_000, write: 1_000, minute: 60 }),
    ], [{ sequence: 30 }])
    expect(facts.durationMinutes).toBe(55)
    expect(facts.compactions).toEqual([
      { id: 'compaction-3', kind: 'compaction', call: 3, minutesFromStart: 0, before: 151_000, after: 30_000 },
    ])
  })

  it('leaves unknown times unknown instead of turning them into zero', () => {
    const facts = factsOf([
      call({ sequence: 10, ctx: 150_000, read: 0, write: 150_000, minute: 0 }),
      call({ sequence: 30, ctx: 20_000, read: 0, write: 20_000 }),
      call({ sequence: 40, ctx: 21_000, read: 20_000, write: 1_000, minute: 45 }),
    ], [{ sequence: 20 }])
    expect(facts.durationMinutes).toBe(45)
    expect(facts.compactions[0].minutesFromStart).toBeNull()
  })

  it('has no duration for a single call, or when the first or the last call has no usable time', () => {
    expect(factsOf([call({ sequence: 1, ctx: 5_000, minute: 0 })]).durationMinutes).toBeNull()
    expect(factsOf([call({ sequence: 1, ctx: 5_000, minute: 0 }), call({ sequence: 2, ctx: 6_000 })]).durationMinutes).toBeNull()
    expect(factsOf([
      makeTurn({ sequence: 1, contextTotal: 5_000, timestamp: 'not-a-date' }),
      makeTurn({ sequence: 2, contextTotal: 6_000, timestamp: ts(10) }),
    ]).durationMinutes).toBeNull()
    // two usable timestamps, but the session's start is unknown: "first to last call" cannot be measured
    expect(factsOf([
      call({ sequence: 1, ctx: 5_000 }),
      call({ sequence: 2, ctx: 6_000, minute: 5 }),
      call({ sequence: 3, ctx: 7_000, minute: 30 }),
    ]).durationMinutes).toBeNull()
  })

  // 第一次呼叫的時間不明，就不知道這場從什麼時候開始：最早一個有效時間戳不是開始，不能拿來寫「開始時」「開始後 D」
  it('does not say “since start” when the first call’s time is unknown', () => {
    const facts = factsOf([
      call({ sequence: 10, ctx: 150_000, read: 0, write: 150_000 }),
      call({ sequence: 20, ctx: 151_000, read: 150_000, write: 1_000 }),
      call({ sequence: 30, ctx: 152_000, read: 151_000, write: 1_000 }),
      call({ sequence: 50, ctx: 30_000, read: 0, write: 30_000, minute: 400 }),
    ], [{ sequence: 40 }])
    expect(facts.compactions[0]).toMatchObject({ call: 4, minutesFromStart: null })
    expect(eventItems(facts, tZh)[0].detail).toBe('第 4 次呼叫前')
  })

  it('finds the longest context and the first call that reached it', () => {
    const facts = maxOnly(50_000, 80_000, 80_000, 60_000)
    expect(facts).toMatchObject({ maxContext: 80_000, maxContextCall: 2, lastContext: 60_000 })
  })

  it('keeps the 1M evidence after the context shrinks again', () => {
    const facts = maxOnly(250_000, 195_000)
    expect(facts.windowEvidence).toBe('1m')
    expect(windowPercent(facts)).toBe(25)
  })

  it('numbers events by call order, not by JSONL sequence', () => {
    const facts = factsOf([
      call({ sequence: 5, ctx: 100_000, read: 0, write: 100_000, minute: 0 }),
      call({ sequence: 40, ctx: 101_000, read: 100_000, write: 1_000, minute: 1 }),
      call({ sequence: 90, ctx: 30_000, read: 0, write: 30_000, minute: 2 }),
      call({ sequence: 200, ctx: 31_000, read: 0, write: 31_000, minute: 90 }),
    ], [{ sequence: 60 }])
    expect(facts.events.map(e => [e.id, e.call])).toEqual([['compaction-3', 3], ['idle_expired-4', 4]])
  })

  it('tallies every cause and keeps the events in call order with stable ids', () => {
    const facts = everyCause()
    expect(facts.events.map(e => e.id)).toEqual(['idle_expired-2', 'model_switch-4', 'unknown-6', 'idle_expired-8', 'unknown-10'])
    expect(facts.idle).toEqual({ count: 2, rewrittenTokens: 140_000 })
    expect(facts.modelSwitch).toEqual({ count: 1, rewrittenTokens: 30_000 })
    expect(facts.unknown).toEqual({ count: 2, rewrittenTokens: 30_000 })
    expect(facts.rewrittenTokens).toBe(200_000)
    expect(facts.cacheBreaks.find(b => b.kind === 'model_switch')).toMatchObject({
      fromModel: 'claude-opus-4-6', toModel: 'claude-sonnet-4-6', gapMinutes: 2, rewrittenTokens: 30_000,
    })
  })

  it('describes an empty session without inventing anything', () => {
    expect(factsOf([])).toEqual({
      calls: 0,
      durationMinutes: null,
      maxContext: 0,
      maxContextCall: null,
      lastContext: 0,
      windowEvidence: null,
      events: [],
      compactions: [],
      compactedAfterLastCall: false,
      cacheUsed: false,
      cacheBreaks: [],
      rewrittenTokens: 0,
      idle: { count: 0, rewrittenTokens: 0 },
      modelSwitch: { count: 0, rewrittenTokens: 0 },
      unknown: { count: 0, rewrittenTokens: 0 },
    })
  })

  it('has nothing to say about a single call besides its size', () => {
    const facts = factsOf([call({ sequence: 1, ctx: 50_000, minute: 0 })])
    expect(facts).toMatchObject({ calls: 1, durationMinutes: null, maxContext: 50_000, events: [] })
  })

  // 以下四條從舊的 Compactions 測試搬來：fixture 與數字不變，改看事件
  describe('compactions', () => {
    it('records where the conversation was compacted and how much smaller it got', () => {
      const facts = factsOf([
        call({ sequence: 10, ctx: 412_645, read: 400_000, write: 12_645 }),
        call({ sequence: 30, ctx: 85_466, read: 0, write: 85_466 }),
      ], [{ sequence: 20 }])
      expect(facts.compactions).toEqual([
        { id: 'compaction-2', kind: 'compaction', call: 2, minutesFromStart: null, before: 412_645, after: 85_466 },
      ])
    })

    it('records every compaction, in order', () => {
      const facts = factsOf([
        call({ sequence: 10, ctx: 160_000 }),
        call({ sequence: 30, ctx: 40_000 }),
        call({ sequence: 50, ctx: 170_000 }),
        call({ sequence: 70, ctx: 45_000 }),
      ], [{ sequence: 20 }, { sequence: 60 }])
      expect(facts.compactions.map(c => [c.call, c.before, c.after])).toEqual([[2, 160_000, 40_000], [4, 170_000, 45_000]])
    })

    it('counts two summaries sitting between the same pair of calls once', () => {
      const facts = factsOf([call({ sequence: 10, ctx: 150_000 }), call({ sequence: 30, ctx: 20_000 })], [{ sequence: 20 }, { sequence: 25 }])
      expect(facts.compactions).toHaveLength(1)
    })

    // 最後一次呼叫之後的那則量不到前後，不在 compactions 裡，但另外記著（它算進次數，見「最後一次呼叫之後的壓縮」）
    it('leaves a summary at the very start (session continued from another) and one after the last call out of the measured compactions', () => {
      const facts = factsOf([call({ sequence: 5, ctx: 50_000 }), call({ sequence: 9, ctx: 52_000 })], [{ sequence: 0 }, { sequence: 99 }])
      expect(facts.compactions).toEqual([])
      expect(facts.compactedAfterLastCall).toBe(true)
    })
  })
})

describe('windowPercent / defaultLimit', () => {
  it('rounds the share of 1M the way the card shows it', () => {
    expect(windowPercent(maxOnly(794_999))).toBe(79)
    expect(windowPercent(maxOnly(795_000))).toBe(80)
  })

  it('has no percentage without evidence, however long the context', () => {
    expect(windowPercent(maxOnly(199_999))).toBeNull()
    expect(windowPercent(maxOnly(200_000))).toBeNull()
  })

  it('draws the 1M line by default only when there is evidence', () => {
    expect(defaultLimit(maxOnly(200_001))).toBe('1m')
    expect(defaultLimit(maxOnly(200_000))).toBe('none')
  })
})

// ── 文案 ──

describe('fillTemplate', () => {
  it('splits a template at its placeholders and marks the strong ones', () => {
    expect(fillTemplate('共 {a} 與 {b}。', { a: '1', b: '2' }, new Set(['b']))).toEqual([
      { text: '共 ', strong: false },
      { text: '1', strong: false },
      { text: ' 與 ', strong: false },
      { text: '2', strong: true },
      { text: '。', strong: false },
    ])
  })

  it('leaves a placeholder without a value in place, so the leftover shows up', () => {
    expect(text(fillTemplate('{a}{b}', { a: 'x' }))).toBe('x{b}')
  })
})

describe('formatSpan', () => {
  it.each<[number, string, string]>([
    [0, '不到 1 分鐘', 'under 1 min'],
    [0.5, '不到 1 分鐘', 'under 1 min'],
    [1, '1 分鐘', '1 min'],
    [59.5, '59 分鐘', '59 min'],
    [59.99, '59 分鐘', '59 min'],
    [60, '1 小時', '1 h'],
    [60.5, '1 小時', '1 h'],
    [61, '1 小時 1 分', '1 h 1 min'],
    [100.56, '1 小時 40 分', '1 h 40 min'],
    [1_500, '25 小時', '25 h'],
  ])('rounds %s minutes down: %s / %s', (minutes, zh, en) => {
    expect(formatSpan(minutes, tZh)).toBe(zh)
    expect(formatSpan(minutes, tEn)).toBe(en)
  })
})

describe('storyParts', () => {
  it('a quiet session', () => {
    const facts = quiet()
    expect(text(storyParts(facts, tZh))).toBe('這場對話 1 小時 40 分、3 次呼叫，內容最多累積到 12.0K token。過程中沒有被壓縮，快取也沒有中斷。')
    expect(bold(storyParts(facts, tZh))).toEqual(['1 小時 40 分', '3 次呼叫', '12.0K token'])
    expect(text(storyParts(facts, tEn))).toBe('This session ran 1 h 40 min over 3 calls, and the context peaked at 12.0K tokens. It was never compacted, and the cache never broke.')
    expect(bold(storyParts(facts, tEn))).toEqual(['1 h 40 min', '3 calls', '12.0K tokens'])
  })

  it('a 1M session compacted once', () => {
    const facts = compactedOnce()
    expect(text(storyParts(facts, tZh))).toBe('這場對話 3 小時 18 分、2 次呼叫，內容最多累積到 412.6K token，是 1M 視窗的 41%。第 2 次呼叫前對話被壓縮：412.6K → 85.5K。快取沒有中斷。')
    expect(bold(storyParts(facts, tZh))).toEqual(['3 小時 18 分', '2 次呼叫', '412.6K token', '41%'])
    expect(text(storyParts(facts, tEn))).toBe('This session ran 3 h 18 min over 2 calls, and the context peaked at 412.6K tokens, 41% of a 1M window. The conversation was compacted before call 2: 412.6K → 85.5K. The cache never broke.')
  })

  it('an idle expiry plus an unexplained break', () => {
    const facts = idleThenUnknown()
    expect(text(storyParts(facts, tZh))).toBe('這場對話 2 小時 51 分、5 次呼叫，內容最多累積到 104.0K token。快取中斷 2 次，共重寫 149.0K，其中 1 次是離開約 2 小時 38 分後回來。')
    expect(text(storyParts(facts, tEn))).toBe('This session ran 2 h 51 min over 5 calls, and the context peaked at 104.0K tokens. The cache broke 2 times, rewriting 149.0K in total; one of those came after about 2 h 38 min away.')
  })

  it('a single break that was an idle expiry', () => {
    const facts = factsOf(withBreaks([{ cause: 'idle', rewritten: 99_000, gap: 75 }]))
    expect(text(storyParts(facts, tZh))).toBe('這場對話 1 小時 16 分、3 次呼叫，內容最多累積到 102.0K token。快取中斷 1 次，共重寫 99.0K，是離開約 1 小時 15 分後回來。')
    expect(text(storyParts(facts, tEn))).toBe('This session ran 1 h 16 min over 3 calls, and the context peaked at 102.0K tokens. The cache broke once, rewriting 99.0K, after about 1 h 15 min away.')
  })

  it('a long context with no evidence of the window, compacted and broken several times', () => {
    const facts = busyNoEvidence()
    expect(text(storyParts(facts, tZh))).toBe('這場對話 3 小時 23 分、11 次呼叫，內容最多累積到 171.0K token，看不出這場的視窗是 200K 還是 1M。對話被壓縮 2 次。快取中斷 3 次，共重寫 85.0K，其中 2 次是離開 1 小時以上後回來。')
    expect(text(storyParts(facts, tEn))).toBe('This session ran 3 h 23 min over 11 calls, and the context peaked at 171.0K tokens; there\'s no telling whether the window was 200K or 1M. The conversation was compacted 2 times. The cache broke 3 times, rewriting 85.0K in total; 2 of those came after an hour or more away.')
  })

  // 故事句只點名閒置（它有建議可給）；其他原因只報次數與重寫量，句子照樣收尾
  it('breaks without an idle expiry still end the sentence', () => {
    const unknownOnly = factsOf(withBreaks([{ cause: 'unknown', rewritten: 10_000 }, { cause: 'unknown', rewritten: 20_000 }]))
    expect(text(storyParts(unknownOnly, tZh))).toBe('這場對話 6 分鐘、5 次呼叫，內容最多累積到 104.0K token。快取中斷 2 次，共重寫 30.0K。')
    expect(text(storyParts(unknownOnly, tEn))).toBe('This session ran 6 min over 5 calls, and the context peaked at 104.0K tokens. The cache broke 2 times, rewriting 30.0K in total.')
    const switchOnce = factsOf(withBreaks([{ cause: 'switch', rewritten: 30_000 }]))
    expect(text(storyParts(switchOnce, tZh))).toBe('這場對話 3 分鐘、3 次呼叫，內容最多累積到 102.0K token。快取中斷 1 次，共重寫 30.0K。')
    expect(text(storyParts(switchOnce, tEn))).toBe('This session ran 3 min over 3 calls, and the context peaked at 102.0K tokens. The cache broke once, rewriting 30.0K.')
  })

  it('leaves the duration out when there is none, instead of writing “under 1 min”', () => {
    const facts = factsOf([call({ sequence: 1, ctx: 5_000, read: 0, write: 5_000, minute: 0 })])
    expect(text(storyParts(facts, tZh))).toBe('這場對話 1 次呼叫，內容最多累積到 5.0K token。過程中沒有被壓縮，快取也沒有中斷。')
    expect(bold(storyParts(facts, tZh))).toEqual(['1 次呼叫', '5.0K token'])
    expect(text(storyParts(facts, tEn))).toBe('This session made 1 call, and the context peaked at 5.0K tokens. It was never compacted, and the cache never broke.')
  })
})

describe('numberCards', () => {
  it('lists duration, calls, longest context, compactions and cache breaks', () => {
    expect(numberCards(compactedOnce(), tZh)).toEqual([
      { id: 'duration', label: '時長', value: '3 小時 18 分', sub: '從第一次到最後一次呼叫' },
      { id: 'calls', label: '呼叫', value: '2 次', sub: null },
      { id: 'maxContext', label: '最長 context', value: '412.6K', sub: '1M 的 41%' },
      { id: 'compactions', label: '壓縮', value: '1 次', sub: null },
      { id: 'cacheBreaks', label: '快取中斷', value: '0 次', sub: null },
    ])
    expect(numberCards(compactedOnce(), tEn).map(c => [c.label, c.value, c.sub])).toEqual([
      ['Duration', '3 h 18 min', 'first to last call'],
      ['Calls', '2', null],
      ['Longest context', '412.6K', '41% of 1M'],
      ['Compactions', '1', null],
      ['Cache breaks', '0', null],
    ])
  })

  it('shows how much the breaks rewrote', () => {
    expect(card(idleThenUnknown(), 'cacheBreaks')).toMatchObject({ value: '2 次', sub: '重寫 149.0K' })
  })

  it('shows a dash for a duration it cannot know', () => {
    expect(card(maxOnly(5_000), 'duration')).toMatchObject({ value: '—', sub: null })
  })

  // 舊的 Context Limit Warning：不再有上限警告，同樣的數字改看副字
  it.each<[string, number[], string | null]>([
    ['850K', [850_000], '1M 的 85%'],
    ['920K', [920_000], '1M 的 92%'],
    ['800K', [800_000], '1M 的 80%'],
    ['50K', [50_000], null],
    ['226.8K is 23% of 1M, not 113% of 200K', [226_800], '1M 的 23%'],
    ['250K then 195K: the evidence stays and the share follows the longest', [250_000, 195_000], '1M 的 25%'],
    ['160K without evidence', [160_000], '視窗大小不明'],
    ['159,999 without evidence', [159_999], null],
  ])('longest context %s', (_label, contexts, sub) => {
    expect(card(maxOnly(...contexts), 'maxContext').sub).toBe(sub)
  })

  it('does not read a 1M window into a model name (Fable 5 at 167K)', () => {
    const facts = factsOf([call({ sequence: 1, ctx: 167_000, minute: 0, model: 'claude-fable-5' })])
    expect(facts.windowEvidence).toBeNull()
    expect(card(facts, 'maxContext').sub).toBe('視窗大小不明')
  })
})

describe('eventItems', () => {
  it('a compaction', () => {
    expect(eventItems(compactedOnce(), tZh)).toEqual([{
      id: 'compaction-2', icon: '📦', tone: 'info',
      title: '對話被壓縮：412.6K → 85.5K',
      detail: '第 2 次呼叫前 · 開始後 3 小時 18 分',
    }])
  })

  it('an idle expiry and an unexplained break after 11 minutes', () => {
    expect(eventItems(idleThenUnknown(), tZh)).toEqual([
      {
        id: 'idle_expired-2', icon: '⏰', tone: 'warning',
        title: '離開約 2 小時 38 分後回來，快取已過期，重寫 99.0K',
        detail: '第 2 次呼叫 · 開始後 2 小時 38 分。閒置超過保留時間，回來的第一句要把整段對話重新算過',
      },
      {
        id: 'unknown-4', icon: '⚠️', tone: 'info',
        title: '快取中斷，原因不明，重寫 50.0K',
        detail: '第 4 次呼叫 · 距上一次呼叫 11 分鐘。用 API key 或超出方案額度時，快取只保留 5 分鐘',
      },
    ])
  })

  it('a model switch', () => {
    expect(eventItems(everyCause(), tZh).find(e => e.id === 'model_switch-4')).toEqual({
      id: 'model_switch-4', icon: '🔄', tone: 'warning',
      title: '換模型，快取重寫 30.0K',
      detail: '第 4 次呼叫 · claude-opus-4-6 → claude-sonnet-4-6',
    })
  })

  // 舊 Cache Breaks 的 unknownLong（3 / 10 / null 分）：改看單筆說明有沒有補 5 分鐘那句
  it.each<[number | null, string]>([
    [3, '第 2 次呼叫 · 距上一次呼叫 3 分鐘'],
    [4.99, '第 2 次呼叫 · 距上一次呼叫 4 分鐘'],
    [5, '第 2 次呼叫 · 距上一次呼叫 5 分鐘。用 API key 或超出方案額度時，快取只保留 5 分鐘'],
    [10, '第 2 次呼叫 · 距上一次呼叫 10 分鐘。用 API key 或超出方案額度時，快取只保留 5 分鐘'],
  ])('mentions the 5-minute cache only for a gap of 5 minutes or more (gap %s)', (gap, detail) => {
    const facts = factsOf(withBreaks([{ cause: 'unknown', rewritten: 50_000, gap: gap ?? undefined }]))
    expect(eventItems(facts, tZh)[0].detail).toBe(detail)
  })

  it('leaves out the gap and the time since the start when the timestamps are missing', () => {
    const facts = factsOf([
      call({ sequence: 1, ctx: 100_000, read: 90_000, write: 10_000 }),
      call({ sequence: 2, ctx: 100_500, read: 0, write: 100_500 }),
    ])
    expect(eventItems(facts, tZh)[0].detail).toBe('第 2 次呼叫')
    const compaction = factsOf([call({ sequence: 10, ctx: 150_000 }), call({ sequence: 30, ctx: 20_000 })], [{ sequence: 20 }])
    expect(eventItems(compaction, tZh)[0].detail).toBe('第 2 次呼叫前')
  })

  it('says “at the start” within the first minute', () => {
    const facts = factsOf([
      call({ sequence: 10, ctx: 150_000, minute: 0 }),
      call({ sequence: 30, ctx: 20_000, minute: 0.5 }),
    ], [{ sequence: 20 }])
    expect(eventItems(facts, tZh)[0].detail).toBe('第 2 次呼叫前 · 開始時')
    expect(eventItems(facts, tEn)[0].detail).toBe('Before call 2 · at the start')
  })

  it('English wording', () => {
    expect(eventItems(idleThenUnknown(), tEn).map(e => [e.title, e.detail])).toEqual([
      ['Back after about 2 h 38 min away: cache expired, 99.0K rewritten', 'Call 2 · 2 h 38 min in. The cache timed out while idle, so the first message back reprocessed the whole conversation'],
      ['Cache broke for an unknown reason, 50.0K rewritten', 'Call 4 · 11 min after the previous call. With an API key or over your plan\'s usage, the cache only lasts 5 minutes'],
    ])
  })
})

describe('eventListText', () => {
  it('counts the events in the subtitle and the expand button', () => {
    expect(eventListText(idleThenUnknown(), tZh)).toEqual({
      title: '發生了什麼',
      subtitle: '2 件，依時間排序',
      empty: '這場沒有被壓縮，快取也沒有中斷。',
      expand: '依時間列出全部 2 筆',
      collapse: '收合成彙總',
    })
  })

  it('uses the singular in English and has no subtitle without events', () => {
    expect(eventListText(compactedOnce(), tEn).subtitle).toBe('1 event, in time order')
    expect(eventListText(idleThenUnknown(), tEn).subtitle).toBe('2 events, in time order')
    expect(eventListText(quiet(), tZh).subtitle).toBeNull()
  })
})

describe('eventSummaryRows', () => {
  it('lists up to six events in full and summarises from seven', () => {
    expect(eventsNeedSummary(factsOf(compactedSession(6).turns, compactedSession(6).compactions))).toBe(false)
    expect(eventsNeedSummary(factsOf(compactedSession(7).turns, compactedSession(7).compactions))).toBe(true)
  })

  it('summarises only the kinds that happened', () => {
    const { turns, compactions } = compactedSession(7)
    expect(eventSummaryRows(factsOf(turns, compactions), tZh)).toEqual([{
      id: 'summary-compactions', icon: '📦', tone: 'info',
      title: '對話被壓縮 7 次',
      detail: '最近一次在第 8 次呼叫前：150.0K → 30.0K',
    }])
  })

  it('counts each cause that happened, in a fixed order, and warns when something actionable happened', () => {
    expect(eventSummaryRows(everyCause(), tZh)).toEqual([{
      id: 'summary-cache-breaks', icon: '⏰', tone: 'warning',
      title: '快取中斷 5 次，共重寫 200.0K',
      detail: '離開太久 2、換模型 1、原因不明 2',
    }])
    expect(eventSummaryRows(everyCause(), tEn)[0]).toMatchObject({
      title: 'Cache broke 5 times, 200.0K rewritten',
      detail: 'away too long 2, model switch 1, unknown 2',
    })
  })

  // 舊 Cache Breaks 的 severity 測試：閒置或換模型 → warning，只有原因不明 → info；原因只列發生過的
  it.each<[string, BreakSpec[], string, string, string]>([
    ['only unexplained breaks', [{ cause: 'unknown', rewritten: 10_000 }, { cause: 'unknown', rewritten: 10_000 }], '⚠️', 'info', '原因不明 2'],
    ['a model switch and an unexplained break', [{ cause: 'switch', rewritten: 10_000 }, { cause: 'unknown', rewritten: 10_000 }], '🔄', 'warning', '換模型 1、原因不明 1'],
    ['an idle expiry', [{ cause: 'idle', rewritten: 10_000 }, { cause: 'unknown', rewritten: 10_000 }], '⏰', 'warning', '離開太久 1、原因不明 1'],
  ])('%s', (_label, spec, icon, tone, detail) => {
    expect(eventSummaryRows(factsOf(withBreaks(spec)), tZh)[0]).toMatchObject({ icon, tone, detail })
  })
})

describe('adviceItems', () => {
  it('has nothing to suggest when nothing happened', () => {
    expect(adviceItems(quiet(), tZh)).toEqual([])
    expect(adviceItems(compactedOnce(), tZh)).toEqual([])
  })

  it('suggests idle → model switch → unknown, quoting the biggest idle rewrite', () => {
    expect(adviceItems(everyCause(), tZh)).toEqual([
      {
        id: 'advice-idle', icon: '⏰', tone: 'warning',
        title: '離開 1 小時以上，回來時快取已經過期',
        detail: '訂閱額度內的主對話，快取閒置 1 小時就會過期，下一次呼叫要把整段對話重寫一次。這場第 8 次呼叫回來時重寫了 90.0K（這場共 2 次，合計 140.0K）。要離開又想保留脈絡，可以離開前先 /compact：快取還在時壓縮比較便宜，回來要重寫的只剩摘要。',
      },
      {
        id: 'advice-model-switch', icon: '🔄', tone: 'warning',
        title: '換模型會讓快取從頭寫',
        detail: '這場換了 1 次，共重寫 30.0K。模型和 effort 盡量在對話開頭選好。',
      },
      {
        id: 'advice-unknown', icon: '⚠️', tone: 'info',
        title: '有 2 次快取中斷找不出原因',
        detail: '共重寫 30.0K。進行中的對話可以用 Claude Code 的 /usage 看最近一次快取失效的可能原因。',
      },
    ])
    // 規則是閒置 >= 60 分：剛好 1 小時也算，所以寫「以上」不寫「超過」
    expect(adviceItems(everyCause(), tEn)[0].title).toBe('Away for an hour or more, and the cache had expired')
  })

  it('quotes the earlier call when two idle rewrites are the same size', () => {
    const facts = factsOf(withBreaks([{ cause: 'idle', rewritten: 60_000 }, { cause: 'idle', rewritten: 60_000 }]))
    expect(adviceItems(facts, tZh)[0].detail).toContain('這場第 2 次呼叫回來時重寫了 60.0K（這場共 2 次，合計 120.0K）')
  })

  it('leaves out the session total when there was only one idle expiry', () => {
    const facts = factsOf(withBreaks([{ cause: 'idle', rewritten: 99_000, gap: 75 }]))
    expect(adviceItems(facts, tZh)[0].detail).toContain('這場第 2 次呼叫回來時重寫了 99.0K。要離開')
  })

  it('counts several model switches and a single unexplained break', () => {
    const facts = factsOf(withBreaks([
      { cause: 'switch', rewritten: 30_000 },
      { cause: 'switch', rewritten: 20_000 },
      { cause: 'unknown', rewritten: 10_000 },
    ]))
    expect(adviceItems(facts, tZh).map(a => [a.title, a.detail])).toEqual([
      ['換模型會讓快取從頭寫', '這場換了 2 次，共重寫 50.0K。模型和 effort 盡量在對話開頭選好。'],
      ['有 1 次快取中斷找不出原因', '共重寫 10.0K。進行中的對話可以用 Claude Code 的 /usage 看最近一次快取失效的可能原因。'],
    ])
    expect(adviceItems(facts, tEn)[0].detail).toBe('This session switched 2 times, rewriting 50.0K. Pick the model and effort at the start of the conversation when you can.')
  })

  it('uses the singular in English', () => {
    const facts = factsOf(withBreaks([{ cause: 'switch', rewritten: 30_000 }, { cause: 'unknown', rewritten: 10_000 }]))
    expect(adviceItems(facts, tEn).map(a => [a.title, a.detail])).toEqual([
      ['Switching models restarts the cache', 'This session switched once, rewriting 30.0K. Pick the model and effort at the start of the conversation when you can.'],
      ['One cache break has no clear cause', '10.0K rewritten. In a live conversation, Claude Code\'s /usage shows the likely cause of the most recent cache miss.'],
    ])
  })
})

describe('timelineMarkers', () => {
  const sixBreaks = (sizes: number[]) => factsOf(withBreaks(sizes.map(rewritten => ({ cause: 'unknown' as const, rewritten }))))

  it('marks only the five biggest rewrites, in call order', () => {
    const markers = timelineMarkers(sixBreaks([10_000, 60_000, 30_000, 50_000, 20_000, 40_000]))
    expect(markers.breaks.map(b => b.rewrittenTokens)).toEqual([60_000, 30_000, 50_000, 20_000, 40_000])
    expect(markers.breaks.map(b => b.call)).toEqual([4, 6, 8, 10, 12])
    expect(markers.hiddenBreaks).toBe(1)
  })

  it('prefers the earlier call when rewrites are the same size', () => {
    const markers = timelineMarkers(sixBreaks([50_000, 50_000, 50_000, 50_000, 50_000, 50_000]))
    expect(markers.breaks.map(b => b.call)).toEqual([2, 4, 6, 8, 10])
  })

  it('draws compaction icons up to five times and fades the lines past twenty', () => {
    const marks = (n: number) => {
      const { turns, compactions } = compactedSession(n)
      return timelineMarkers(factsOf(turns, compactions))
    }
    expect(marks(5)).toMatchObject({ compactionIcons: true, faintCompactions: false })
    expect(marks(6)).toMatchObject({ compactionIcons: false, faintCompactions: false })
    expect(marks(20).faintCompactions).toBe(false)
    expect(marks(21).faintCompactions).toBe(true)
    expect(marks(21).compactions).toHaveLength(21)
  })
})

describe('legendItems', () => {
  it('explains the area, and the markers this session actually has', () => {
    expect(legendItems(quiet(), tZh)).toEqual([{ id: 'area', text: '每次呼叫送出的整段對話長度' }])
    expect(legendItems(compactedOnce(), tZh).map(l => l.id)).toEqual(['area', 'compaction'])
    expect(legendItems(idleThenUnknown(), tZh).map(l => [l.id, l.text])).toEqual([
      ['area', '每次呼叫送出的整段對話長度'],
      ['idle_expired', '離開太久，快取過期'],
      ['unknown', '快取中斷，原因不明'],
    ])
  })

  it('says when not every break is marked, and only names the kinds that were drawn', () => {
    const facts = factsOf(withBreaks([
      { cause: 'switch', rewritten: 1_000 },
      ...[60_000, 50_000, 40_000, 30_000, 20_000].map(rewritten => ({ cause: 'unknown' as const, rewritten })),
    ]))
    expect(legendItems(facts, tZh).map(l => [l.id, l.text])).toEqual([
      ['area', '每次呼叫送出的整段對話長度'],
      ['unknown', '快取中斷，原因不明'],
      ['overflow', '標記只畫重寫量最大的 5 個，其餘在下方清單'],
    ])
  })
})

describe('chartRows / tooltipContent', () => {
  it('has one row per call, with every event of that call even when it is not drawn', () => {
    const stats = makeStats(withBreaks([10_000, 60_000, 30_000, 50_000, 20_000, 40_000].map(rewritten => ({ cause: 'unknown' as const, rewritten }))))
    const facts = buildSessionFacts(stats)
    const rows = chartRows(stats, facts)
    expect(rows).toHaveLength(13)
    expect(timelineMarkers(facts).breaks.map(b => b.call)).not.toContain(2)
    expect(rows[1]).toEqual({
      call: 2, context: 101_000, cacheRead: 0, cacheWrite: 10_000, uncached: 91_000, output: 0, minutesFromStart: 2, eventIds: ['unknown-2'],
    })
    expect(rows[0].eventIds).toEqual([])
  })

  it('reads out the call, its time, its size and its events', () => {
    const turns = withBreaks([{ cause: 'idle', rewritten: 99_000, gap: 158.5 }])
    const facts = factsOf(turns)
    const rows = chartRows(makeStats(turns), facts)
    const titles = new Map(eventItems(facts, tZh).map(e => [e.id, e.title]))
    expect(tooltipContent(rows[1], titles, tZh)).toEqual({
      head: '第 2 次呼叫 · 開始後 2 小時 38 分',
      length: '對話長度 101.0K',
      breakdown: '快取讀取 0 · 寫入 99.0K · 新輸入 2.0K · 輸出 0',
      events: ['離開約 2 小時 38 分後回來，快取已過期，重寫 99.0K'],
    })
  })

  // 不支援 prompt caching 的供應商讀寫都是 0：只列讀寫的話，100K 的對話長度看起來像資料不見了
  it('accounts for the whole prompt: cache read + write + new input = length', () => {
    const turns = [call({ sequence: 1, ctx: 100_000, minute: 0 }), call({ sequence: 2, ctx: 101_000, minute: 1, output: 500 })]
    const rows = chartRows(makeStats(turns), factsOf(turns))
    expect(rows.map(r => r.cacheRead + r.cacheWrite + r.uncached)).toEqual(rows.map(r => r.context))
    expect(tooltipContent(rows[1], new Map(), tZh).breakdown).toBe('快取讀取 0 · 寫入 0 · 新輸入 101.0K · 輸出 500')
    expect(tooltipContent(rows[1], new Map(), tEn).breakdown).toBe('Cache read 0 · write 0 · new 101.0K · output 500')
  })
})

// ── 最後一次呼叫之後的壓縮 ──

// 摘要落在最後一次呼叫之後時，沒有「壓縮後」的呼叫可以量前後，所以不畫在時間軸上（compactedCallIndexes 不列它）；
// 但對話確實被壓縮過：算進壓縮次數，故事句與事件清單寫「最後一次呼叫之後被壓縮，量不到前後」，不能寫成沒有被壓縮。
// 同一場拿掉這則摘要就是從沒壓縮過：三處維持原樣，確認改動沒有波及。
describe('a compaction after the last call', () => {
  const turns = () => [
    call({ sequence: 10, ctx: 10_000, read: 0, write: 10_000, minute: 0 }),
    call({ sequence: 20, ctx: 11_000, read: 10_000, write: 1_000, minute: 30 }),
    call({ sequence: 30, ctx: 12_000, read: 11_000, write: 1_000, minute: 100.56 }),
  ]
  const trailing = () => factsOf(turns(), [{ sequence: 40 }])

  it.each<[string, Translate, string]>([
    ['zh-TW', tZh, '這場對話 1 小時 40 分、3 次呼叫，內容最多累積到 12.0K token。最後一次呼叫之後對話被壓縮，量不到前後。快取沒有中斷。'],
    ['en', tEn, 'This session ran 1 h 40 min over 3 calls, and the context peaked at 12.0K tokens. The conversation was compacted after the last call, so the before and after can\'t be measured. The cache never broke.'],
  ])('%s: the story says it was compacted after the last call and that the before and after cannot be measured', (_locale, t, story) => {
    expect(text(storyParts(trailing(), t))).toBe(story)
  })

  it.each<[string, Translate, NumberCard]>([
    ['zh-TW', tZh, { id: 'compactions', label: '壓縮', value: '1 次', sub: null }],
    ['en', tEn, { id: 'compactions', label: 'Compactions', value: '1', sub: null }],
  ])('%s: the compactions card counts it', (_locale, t, expected) => {
    expect(card(trailing(), 'compactions', t)).toEqual(expected)
  })

  it.each<[string, Translate, string, ListItem]>([
    ['zh-TW', tZh, '1 件，依時間排序', { id: 'compaction-after-last-call', icon: '📦', tone: 'info', title: '對話被壓縮，量不到前後', detail: '最後一次呼叫之後' }],
    ['en', tEn, '1 event, in time order', { id: 'compaction-after-last-call', icon: '📦', tone: 'info', title: 'Conversation compacted, before and after can\'t be measured', detail: 'After the last call' }],
  ])('%s: the event list shows it', (_locale, t, subtitle, item) => {
    expect(eventListText(trailing(), t).subtitle).toBe(subtitle)
    expect(eventItems(trailing(), t)).toEqual([item])
  })

  it.each<[string, Translate, string, string, string]>([
    ['zh-TW', tZh, '這場對話 1 小時 40 分、3 次呼叫，內容最多累積到 12.0K token。過程中沒有被壓縮，快取也沒有中斷。', '0 次', '這場沒有被壓縮，快取也沒有中斷。'],
    ['en', tEn, 'This session ran 1 h 40 min over 3 calls, and the context peaked at 12.0K tokens. It was never compacted, and the cache never broke.', '0', 'This session was never compacted, and the cache never broke.'],
  ])('%s: the same session without that summary still says it was never compacted', (_locale, t, story, cardValue, empty) => {
    const facts = factsOf(turns())
    expect(text(storyParts(facts, t))).toBe(story)
    expect(card(facts, 'compactions', t).value).toBe(cardValue)
    expect(eventItems(facts, t)).toEqual([])
    expect(eventListText(facts, t)).toMatchObject({ subtitle: null, empty })
  })

  it('is recorded beside the measured compactions, not among them, and stays off the timeline', () => {
    const facts = trailing()
    expect(facts.compactedAfterLastCall).toBe(true)
    expect(facts.compactions).toEqual([])
    expect(facts.events).toEqual([])
    expect(timelineMarkers(facts).compactions).toEqual([])
    expect(legendItems(facts, tZh).map(l => l.id)).toEqual(['area'])
    expect(chartRows(statsOf.get(facts)!, facts).flatMap(r => r.eventIds)).toEqual([])
  })

  it('counts several summaries after the last call once, as between two calls', () => {
    expect(card(factsOf(turns(), [{ sequence: 40 }, { sequence: 45 }]), 'compactions').value).toBe('1 次')
  })

  // 量得到的壓縮之外還有最後一次呼叫之後的：一起算次數，故事句點出那一次量不到，事件清單把它排在最後
  it('counts together with the compactions that were measured', () => {
    const facts = factsOf([
      call({ sequence: 10, ctx: 150_000, read: 0, write: 150_000, minute: 0 }),
      call({ sequence: 30, ctx: 30_000, read: 0, write: 30_000, minute: 10 }),
      call({ sequence: 40, ctx: 31_000, read: 30_000, write: 1_000, minute: 11 }),
    ], [{ sequence: 20 }, { sequence: 50 }])
    expect(text(storyParts(facts, tZh))).toBe('這場對話 11 分鐘、3 次呼叫，內容最多累積到 150.0K token。對話被壓縮 2 次，其中 1 次在最後一次呼叫之後，量不到前後。快取沒有中斷。')
    expect(text(storyParts(facts, tEn))).toBe('This session ran 11 min over 3 calls, and the context peaked at 150.0K tokens. The conversation was compacted 2 times; one of those came after the last call, so its before and after can\'t be measured. The cache never broke.')
    expect(card(facts, 'compactions').value).toBe('2 次')
    expect(eventItems(facts, tZh).map(e => e.id)).toEqual(['compaction-2', 'compaction-after-last-call'])
    expect(eventListText(facts, tZh).subtitle).toBe('2 件，依時間排序')
  })

  it('comes after the cache breaks in the event list, and the story still reports the breaks', () => {
    const facts = factsOf(withBreaks([{ cause: 'unknown', rewritten: 50_000 }]), [{ sequence: 4 }])
    expect(text(storyParts(facts, tZh))).toBe('這場對話 3 分鐘、3 次呼叫，內容最多累積到 102.0K token。最後一次呼叫之後對話被壓縮，量不到前後。快取中斷 1 次，共重寫 50.0K。')
    expect(text(storyParts(facts, tEn))).toBe('This session ran 3 min over 3 calls, and the context peaked at 102.0K tokens. The conversation was compacted after the last call, so the before and after can\'t be measured. The cache broke once, rewriting 50.0K.')
    expect(eventItems(facts, tZh).map(e => e.id)).toEqual(['unknown-2', 'compaction-after-last-call'])
  })

  // 彙總的門檻看清單實際有幾筆：六次中斷加上這一筆是七筆
  it('counts toward the summary threshold, and the summary says the latest compaction could not be measured', () => {
    const facts = factsOf(withBreaks([10_000, 60_000, 30_000, 50_000, 20_000, 40_000].map(rewritten => ({ cause: 'unknown' as const, rewritten }))), [{ sequence: 99 }])
    expect(eventsNeedSummary(facts)).toBe(true)
    expect(eventListText(facts, tZh).expand).toBe('依時間列出全部 7 筆')
    expect(eventSummaryRows(facts, tZh)[0]).toEqual({
      id: 'summary-compactions', icon: '📦', tone: 'info',
      title: '對話被壓縮 1 次',
      detail: '最近一次在最後一次呼叫之後，量不到前後',
    })
    expect(eventSummaryRows(facts, tEn)[0]).toMatchObject({
      title: 'Conversation compacted once',
      detail: 'Most recent after the last call, before and after can\'t be measured',
    })
    const many = compactedSession(7)
    expect(eventSummaryRows(factsOf(many.turns, [...many.compactions, { sequence: 999 }]), tZh)[0]).toMatchObject({
      title: '對話被壓縮 8 次',
      detail: '最近一次在最後一次呼叫之後，量不到前後',
    })
  })
})

// ── 沒有用到 prompt 快取 ──

// 每次呼叫的快取讀寫都是 0（不支援 prompt caching 的供應商、prompt 太短沒法快取）：快取規則一律跳過，所以不會有中斷；
// 但沒有快取就談不上中斷，三處不能說「快取沒有中斷」，卡片也不能寫 0 次。建議全都跟快取有關，空狀態不能說「沒有可以省的」。
describe('a session that never used the prompt cache', () => {
  const noCacheTurns = () => [
    call({ sequence: 10, ctx: 20_000, minute: 0 }),
    call({ sequence: 20, ctx: 24_000, minute: 3 }),
    call({ sequence: 30, ctx: 30_000, minute: 9 }),
  ]
  const noCache = () => factsOf(noCacheTurns())

  it('records whether any call read or wrote the cache', () => {
    expect(noCache().cacheUsed).toBe(false)
    expect(quiet().cacheUsed).toBe(true)
    // 一次寫入就算用到
    expect(factsOf([call({ sequence: 1, ctx: 5_000 }), call({ sequence: 2, ctx: 6_000, write: 6_000 })]).cacheUsed).toBe(true)
  })

  it.each<[string, Translate, string]>([
    ['zh-TW', tZh, '這場對話 9 分鐘、3 次呼叫，內容最多累積到 30.0K token。過程中沒有被壓縮，也沒有用到 prompt 快取。'],
    ['en', tEn, 'This session ran 9 min over 3 calls, and the context peaked at 30.0K tokens. It was never compacted, and it didn\'t use prompt caching.'],
  ])('%s: the story says it did not use the cache, not that the cache never broke', (_locale, t, story) => {
    expect(text(storyParts(noCache(), t))).toBe(story)
  })

  it.each<[string, Translate, string]>([
    ['zh-TW', tZh, '這場對話 5 分鐘、2 次呼叫，內容最多累積到 150.0K token。第 2 次呼叫前對話被壓縮：150.0K → 30.0K。沒有用到 prompt 快取。'],
    ['en', tEn, 'This session ran 5 min over 2 calls, and the context peaked at 150.0K tokens. The conversation was compacted before call 2: 150.0K → 30.0K. It didn\'t use prompt caching.'],
  ])('%s: the same after a compaction', (_locale, t, story) => {
    const facts = factsOf([call({ sequence: 10, ctx: 150_000, minute: 0 }), call({ sequence: 30, ctx: 30_000, minute: 5 })], [{ sequence: 20 }])
    expect(text(storyParts(facts, t))).toBe(story)
  })

  it.each<[string, Translate, NumberCard]>([
    ['zh-TW', tZh, { id: 'cacheBreaks', label: '快取中斷', value: '—', sub: '沒有用到 prompt 快取' }],
    ['en', tEn, { id: 'cacheBreaks', label: 'Cache breaks', value: '—', sub: 'prompt caching not used' }],
  ])('%s: the cache-break card shows no count', (_locale, t, expected) => {
    expect(card(noCache(), 'cacheBreaks', t)).toEqual(expected)
  })

  it.each<[string, Translate, string]>([
    ['zh-TW', tZh, '這場沒有被壓縮，也沒有用到 prompt 快取。'],
    ['en', tEn, 'This session was never compacted, and it didn\'t use prompt caching.'],
  ])('%s: the empty event list says it did not use the cache', (_locale, t, empty) => {
    expect(eventItems(noCache(), t)).toEqual([])
    expect(eventListText(noCache(), t).empty).toBe(empty)
  })

  it.each<[string, Translate, string, string]>([
    ['zh-TW', tZh, '這場沒有用到 prompt 快取，所以這些跟快取有關的建議都不適用。', '這場沒有明顯可以省的地方。'],
    ['en', tEn, 'This session didn\'t use prompt caching, so none of these cache suggestions apply.', 'Nothing obvious to save in this session.'],
  ])('%s: the empty advice says the cache suggestions do not apply, instead of “nothing to save”', (_locale, t, noCacheEmpty, cachedEmpty) => {
    expect(adviceItems(noCache(), t)).toEqual([])
    expect(adviceEmptyText(noCache(), t)).toBe(noCacheEmpty)
    expect(adviceEmptyText(quiet(), t)).toBe(cachedEmpty)
  })
})

// ── i18n：每種句型中英都渲染得出來 ──

describe('i18n coverage', () => {
  const CJK = /[\u3000-\u9fff\uff00-\uffef]/
  const LEFTOVER = /\{[^}]*\}|tokenBudget\./

  /** 每種事件都有：壓縮 1、閒置 2、換模型 1、原因不明 2（含一筆 ≥5 分） */
  function everything(): SessionFacts {
    const turns = withBreaks([
      { cause: 'idle', rewritten: 50_000 },
      { cause: 'switch', rewritten: 30_000 },
      { cause: 'unknown', rewritten: 10_000, gap: 8 },
      { cause: 'idle', rewritten: 90_000 },
      { cause: 'unknown', rewritten: 20_000 },
    ])
    // 最後一次之後補一次壓縮，讓壓縮與中斷同時出現
    const last = turns[turns.length - 1]
    turns.push(call({ sequence: last.sequence + 2, ctx: 20_000, read: 0, write: 20_000, minute: 999, model: last.model }))
    return factsOf(turns, [{ sequence: last.sequence + 1 }])
  }

  /** 走遍 builder 的每個分支：單複數、有無時長、三種視窗子句、事件彙總、圖例超過 5 個、不到 1 分鐘、開始時 */
  const fixtures = (): Array<[string, SessionFacts]> => [
    ['quiet', quiet()],
    ['compacted once', compactedOnce()],
    ['idle then unknown', idleThenUnknown()],
    ['every cause', everyCause()],
    ['busy, no evidence', busyNoEvidence()],
    ['single call', maxOnly(5_000)],
    ['single idle', factsOf(withBreaks([{ cause: 'idle', rewritten: 99_000, gap: 75 }]))],
    ['switches and one unknown', factsOf(withBreaks([
      { cause: 'switch', rewritten: 30_000 },
      { cause: 'switch', rewritten: 20_000 },
      { cause: 'unknown', rewritten: 10_000 },
    ]))],
    ['six breaks', factsOf(withBreaks([10_000, 60_000, 30_000, 50_000, 20_000, 40_000].map(rewritten => ({ cause: 'unknown' as const, rewritten }))))],
    ['seven compactions', factsOf(compactedSession(7).turns, compactedSession(7).compactions)],
    ['under a minute', factsOf(withBreaks([{ cause: 'unknown', rewritten: 10_000, gap: 0.5 }]))],
    ['at the start', factsOf([call({ sequence: 10, ctx: 150_000, minute: 0 }), call({ sequence: 30, ctx: 20_000, minute: 0.5 })], [{ sequence: 20 }])],
    ['everything', everything()],
    ['compacted after the last call', factsOf([call({ sequence: 1, ctx: 5_000, read: 0, write: 5_000, minute: 0 })], [{ sequence: 2 }])],
    ['compacted twice, once after the last call', factsOf([
      call({ sequence: 10, ctx: 412_645, read: 400_000, write: 12_645, minute: 0 }),
      call({ sequence: 30, ctx: 85_466, read: 0, write: 85_466, minute: 198.24 }),
    ], [{ sequence: 20 }, { sequence: 40 }])],
    ['six breaks and a compaction after the last call', factsOf(withBreaks([10_000, 60_000, 30_000, 50_000, 20_000, 40_000].map(rewritten => ({ cause: 'unknown' as const, rewritten }))), [{ sequence: 99 }])],
    ['never used the cache', factsOf([call({ sequence: 1, ctx: 20_000, minute: 0 }), call({ sequence: 2, ctx: 24_000, minute: 3 })])],
  ]

  function allStrings(facts: SessionFacts, t: Translate): string[] {
    const stats = statsOf.get(facts)!
    const items = [...eventItems(facts, t), ...eventSummaryRows(facts, t), ...adviceItems(facts, t)]
    const titles = new Map(eventItems(facts, t).map(e => [e.id, e.title]))
    const tips = chartRows(stats, facts).filter(r => r.eventIds.length > 0 || r.call === 1).map(r => tooltipContent(r, titles, t))
    const listText = eventListText(facts, t)
    return [
      text(storyParts(facts, t)),
      ...numberCards(facts, t).flatMap(c => [c.label, c.value, c.sub ?? '']),
      listText.title, listText.subtitle ?? '', listText.empty, listText.expand, listText.collapse,
      adviceEmptyText(facts, t),
      ...items.flatMap(i => [i.title, i.detail]),
      ...legendItems(facts, t).map(l => l.text),
      ...tips.flatMap(tip => [tip.head, tip.length, tip.breakdown, ...tip.events]),
    ]
  }

  it('the everything fixture really has every kind of event', () => {
    const facts = everything()
    expect(new Set(facts.events.map(e => e.kind))).toEqual(new Set(['compaction', 'idle_expired', 'model_switch', 'unknown']))
  })

  it.each(['zh-TW', 'en'] as const)('%s renders every sentence of every fixture without a missing key or a leftover placeholder', (locale) => {
    const t: Translate = (key, params) => translate(locale, key, params)
    for (const [name, facts] of fixtures()) {
      for (const s of allStrings(facts, t)) expect(s, name).not.toMatch(LEFTOVER)
    }
  })

  it('English output has no Chinese characters or full-width punctuation in it', () => {
    const offenders = fixtures().flatMap(([name, facts]) => allStrings(facts, tEn).filter(s => CJK.test(s)).map(s => `${name}: ${s}`))
    expect(offenders).toEqual([])
  })

  // 分支沒走到的模板，占位符寫錯也不會有人發現：每個經過 builder 的 key 都要被上面的 fixture 渲染過
  it('the fixtures render every builder key at least once', () => {
    const used = new Set<string>()
    const t: Translate = (key, params) => {
      used.add(key)
      return translate('en', key, params)
    }
    for (const [, facts] of fixtures()) allStrings(facts, t)
    // 元件直接用的標籤：沒有參數、不經 builder（advice.empty 依有沒有用到快取換句子，改由 adviceEmptyText 產生）
    const componentOnly = new Set(['tokenBudget.story.label', 'tokenBudget.advice.title'])
    const builderKeys = Object.keys(messages['zh-TW'])
      .filter(k => /^tokenBudget\.(story|card|events|advice|span)\./.test(k) || /^tokenBudget\.chart\.(tooltip|legend)/.test(k))
      .filter(k => !componentOnly.has(k))
    // 只確認篩選條件真的篩到東西（10-16 時是 79 個），不是要釘死數量
    expect(builderKeys.length).toBeGreaterThan(60)
    expect(builderKeys.filter(k => !used.has(k))).toEqual([])
  })
})
