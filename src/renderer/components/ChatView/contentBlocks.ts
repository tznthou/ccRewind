import type { Message } from '../../../shared/types'

/** content array 裡的 thinking block（Claude 推理過程，原始 JSONL 保留在 message_content.content_json） */
export interface ThinkingBlock {
  type: 'thinking'
  thinking: string
}

interface ToolUseBlock {
  type: 'tool_use'
  name: string
  input: unknown
}

interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: unknown
}

export type ContentBlock = ToolUseBlock | ToolResultBlock

/** 從 message.contentJson 抽出 tool_use / tool_result blocks。寬容解析，壞結構回空陣列。 */
export function extractToolBlocks(contentJson: string | null): ContentBlock[] {
  if (!contentJson) return []
  try {
    const parsed = JSON.parse(contentJson)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (block: unknown): block is ContentBlock => {
        if (block == null || typeof block !== 'object') return false
        const b = block as Record<string, unknown>
        if (b.type === 'tool_use') return typeof b.name === 'string'
        if (b.type === 'tool_result') return typeof b.tool_use_id === 'string'
        return false
      },
    )
  } catch {
    return []
  }
}


/**
 * 從 message.contentJson 抽出 thinking blocks。
 * 仿 MessageBubble 的 extractToolBlocks 範式：寬容解析，壞結構回空陣列、不中斷。
 */
export function extractThinkingBlocks(contentJson: string | null): ThinkingBlock[] {
  if (!contentJson) return []
  try {
    const parsed = JSON.parse(contentJson)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (block: unknown): block is ThinkingBlock => {
        if (block == null || typeof block !== 'object') return false
        const b = block as Record<string, unknown>
        return b.type === 'thinking' && typeof b.thinking === 'string'
      },
    )
  } catch {
    return []
  }
}

/**
 * 這則訊息會不會渲染出東西——必須與 MessageBubble 的兩個 early return 保持一致，
 * 兩邊漂移會讓虛擬列表的 count 與實際列數對不上。
 *
 * 虛擬化需要它：不渲染的訊息若留在 count 裡，在被量到 0 之前都佔著 estimateSize，
 * 捲軸長度虛胖、捲動時反覆修正位置。實測最大的 session 是 36,533 則裡只有 12,604
 * 則會渲染（65% 是 bookkeeping 記錄），不是邊緣情況。
 *
 * 只讀三個欄位，簽章就收到這三個——呼叫端能一眼看出契約，測試也不必湊出整個 Message。
 *
 * contentText 有值時直接放行省掉 parse，但實測全庫 89.7% 的訊息沒有 contentText，
 * 所以多數情況仍會走到下面兩個 extractor。整體成本實測 18-25ms（最大 session，
 * 14.8MB content_json），且只在開啟 session 時跑一次，不值得為它改架構。
 */
export function isDisplayableMessage(
  message: Pick<Message, 'type' | 'contentText' | 'contentJson'>,
): boolean {
  if (message.type === 'last-prompt') return false
  if (message.contentText) return true
  return extractToolBlocks(message.contentJson).length > 0
    || extractThinkingBlocks(message.contentJson).length > 0
}
