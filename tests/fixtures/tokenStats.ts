// Token Budget 測試共用的 SessionTokenStats 造法（insightEngine / sessionStory 兩個測試檔共用）
import type { SessionTokenStats } from '../../src/shared/types'

export type Turn = SessionTokenStats['turns'][number]

export function makeTurn(overrides: Partial<Turn> & { sequence: number }): Turn {
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

export function makeStats(
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

/** 基準時間 + N 分鐘（可以是小數） */
export function ts(minutes: number): string {
  return new Date(Date.UTC(2026, 8, 25, 0, 0) + minutes * 60_000).toISOString()
}

/** 一次 API 呼叫: ctx = 整段 prompt(input + 讀 + 寫), read/write 是其中快取讀寫的部分; 不給 minute 時間戳就是 null */
export function call(o: {
  sequence: number
  ctx: number
  read?: number
  write?: number
  minute?: number
  model?: string | null
  tools?: string[]
  output?: number
}): Turn {
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
