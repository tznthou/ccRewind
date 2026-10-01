/**
 * getSessionTokenStats 讀取時用的純函式（不碰 DB，database.ts 已經夠長）。
 * 兩個函式都要求輸入依 sequence 由小到大排好。
 */

/** compact 產生的摘要訊息開頭固定是這句（2026-02 到 2026-09 共 149 則完全一致） */
export const COMPACT_SUMMARY_PREFIX = 'This session is being continued from a previous conversation'

export interface UsageRow {
  sequence: number
  input_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
}

/**
 * 同一次 API 回應被 Claude Code 拆成多個 entries、各帶相同的 usage，只有輸出量是串流中途值
 * （c9ed37b7 的第 5/6/7/9 列：input/讀/寫都是 31670/14347/17321，輸出 9/9/9/215）。
 * requestId 去重（v1.7.2）只在重索引時生效，但 Claude Code 30 天清理刪掉的原檔永遠不會被重索引——
 * 去重上線前索引的 47 個 session 因此還留著重複列（2026-09-30 實測 5,146 列、顯示值約實際的 1.65 倍）。
 *
 * 讀取時把相鄰、三欄全等的列收合成最後一列：與 indexer 的 deduplicateTokensByRequestId 同語意，
 * 留最後一列輸出量才是完整值。這是規則不是證明：相鄰兩次真實呼叫的 context 通常會長，但 rewind 後換一句
 * token 數相同的話重送，棄用分支那次呼叫會跟新分支第一次呼叫三欄全等又相鄰——所以呼叫端只對證明不了
 * 做過去重的舊 session 收合（判斷方式見 getSessionTokenStats）。
 *
 * read + creation = 0 的列不收合：沒有快取的小呼叫（opus-4-8 的 input=10）兩次撞同一組數字是巧合，
 * 不是同一次回應（2026-07 有 11 列）。
 */
export function collapseDuplicateUsageRows<T extends UsageRow>(rows: readonly T[]): T[] {
  const out: T[] = []
  for (let i = 0; i < rows.length; i++) {
    const next = rows[i + 1]
    if (next && isSameResponse(rows[i], next)) continue
    out.push(rows[i])
  }
  return out
}

function isSameResponse(a: UsageRow, b: UsageRow): boolean {
  return a.input_tokens === b.input_tokens
    && a.cache_read_tokens === b.cache_read_tokens
    && a.cache_creation_tokens === b.cache_creation_tokens
    && a.cache_read_tokens + a.cache_creation_tokens > 0
}

export interface ToolRow {
  sequence: number
  tool_names: string
}

/**
 * 每次呼叫「這次回應」叫了哪些工具：前一次呼叫之後、到本次呼叫（含）為止的所有 assistant 列的聯集。
 * token 列只帶該回應最後一個 content block 的 tool_names，前面的 block 各自是別的列；
 * 被收合掉的重複列也在這個區間內，所以要用區間而不是只看 token 列。
 * 第一次呼叫之前的列歸第一次，最後一次呼叫之後的列不歸任何人。
 *
 * 這假設區間裡沒有用量的列都屬於本次回應：去重把同一回應前面的列設成 NULL；MiniMax 只在最後一個 chunk
 * 回報用量、前面的 chunk 是 0（2026-09-30 實測：用量為 0 又叫了工具的列全是這種，緊接著就是同一回應帶用量的列）。
 * 若是另一個完全不回報用量的回應，它的工具會被算到下一次呼叫——實測沒有這種資料，沒有 requestId 也分不出來。
 */
export function toolNamesPerCall(
  calls: ReadonlyArray<{ sequence: number }>,
  toolRows: readonly ToolRow[],
): string[][] {
  const result: string[][] = []
  let cursor = 0
  for (const call of calls) {
    const names = new Set<string>()
    while (cursor < toolRows.length && toolRows[cursor].sequence <= call.sequence) {
      for (const raw of toolRows[cursor].tool_names.split(',')) {
        const name = raw.trim()
        if (name) names.add(name)
      }
      cursor++
    }
    result.push([...names])
  }
  return result
}
