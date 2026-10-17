import type { SessionTokenStats } from '../../../shared/types'

// Token Budget 的偵測規則：壓縮落在哪、快取哪裡整段重寫、有沒有 1M 視窗的證據。
// 只回傳數字，文字與樣式在 sessionStory.ts。

type Turn = SessionTokenStats['turns'][number]
type Compactions = SessionTokenStats['compactions']

/**
 * 壓縮摘要後面第一次呼叫的位置 i（turns[i - 1] 與 turns[i] 之間夾著壓縮），以 JSONL sequence 判斷。
 * 同一對呼叫之間有好幾則摘要只算一次。session 開頭的摘要（上一段對話帶進來的）不算這段對話的壓縮；
 * 最後一次呼叫之後的摘要沒有「壓縮後」的呼叫可以量，不列在這裡，由 compactedAfterLastCall 回報。
 * 兩個陣列都依 sequence 由小到大（SQL 已排序）。
 */
export function compactedCallIndexes(turns: Turn[], compactions: Compactions): Set<number> {
  const result = new Set<number>()
  let t = 0
  for (const c of compactions) {
    while (t < turns.length && turns[t].sequence < c.sequence) t++
    if (t > 0 && t < turns.length) result.add(t)
  }
  return result
}

/**
 * 最後一次呼叫之後有沒有壓縮摘要。之後沒有呼叫，量不到前後，但對話確實被壓縮過：要算進次數，
 * 文字要說量不到，不能說沒有。好幾則摘要只算一次，同 compactedCallIndexes；沒有呼叫就沒有「最後一次呼叫之後」。
 */
export function compactedAfterLastCall(turns: Turn[], compactions: Compactions): boolean {
  if (turns.length === 0) return false
  const last = turns[turns.length - 1].sequence
  return compactions.some(c => c.sequence > last)
}

// ── 視窗大小 ──

/** 視窗只有這個大小，一次呼叫的 context 就不可能超過它 */
const SMALL_WINDOW_TOKENS = 200_000

/**
 * 這場的視窗是 1M 的證據：任一次呼叫超過 200K（之後縮小也算）。沒有就是「不知道」，不是 200K。
 * 模型名不算證據（2026-10-15 實測：同模型同月既有超過 200K、也有 17 萬就壓縮的；`[1m]` 是 Claude Code 的設定，
 * 不會寫進 JSONL 的 model 欄），壓縮前貼著 165–170K 也不算（從未超過 200K 的壓縮落在 160–165K 的比 165–170K 還多）。
 */
export function contextWindowEvidence(turns: SessionTokenStats['turns']): '1m' | null {
  return turns.some(t => t.contextTotal > SMALL_WINDOW_TOKENS) ? '1m' : null
}

// ── 快取中斷 ──
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
/** API key／超額時主對話 TTL 預設只有 5 分鐘（可以設定成 1 小時） */
export const SHORT_TTL_MINUTES = 5

/** 閒置過期一定量得到間隔；其他原因的間隔可能不知道（缺時間戳） */
export type CacheBreak =
  | { turn: number; cause: 'idle_expired'; gapMinutes: number; rewrittenTokens: number }
  | { turn: number; cause: 'model_switch' | 'unknown'; gapMinutes: number | null; rewrittenTokens: number }

function minutesBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null
  const a = Date.parse(from)
  const b = Date.parse(to)
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null
  return (b - a) / 60_000
}

/** `turn` 是第幾次呼叫（1 起算），不是 JSONL sequence；依呼叫序 */
export function findCacheBreaks(turns: Turn[], compacted: ReadonlySet<number>): CacheBreak[] {
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
    // 中斷的代價是快取沒斷的話本來讀得到的舊內容：上一次的 prompt 這次沒讀到的部分（rewrote 保證它是正的）。
    // 這次新增的內容（回來後貼上的大段文字、上一次的輸出與工具結果）本來就要寫入，不算；也不超過實際寫入的量
    const rewrittenTokens = Math.min(cur.cacheCreationTokens, prev.contextTotal - cur.cacheReadTokens)
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
