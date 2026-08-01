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
 * 這則訊息會不會渲染出東西——必須與 MessageBubble 的兩個 early return 保持一致。
 *
 * 虛擬化需要它：列表的 count 若含不渲染的訊息，那些項目在被量到 0 之前都佔著
 * estimateSize，捲軸長度會虛胖、捲動時反覆修正位置。實測某 session 有超過半數
 * 訊息屬於此類（bookkeeping 記錄），影響不是邊緣情況。
 *
 * contentText 有值時直接放行，避免對長 session 的每一則都做 JSON.parse。
 */
export function isDisplayableMessage(message: Message): boolean {
  if (message.type === 'last-prompt') return false
  if (message.contentText) return true
  return extractToolBlocks(message.contentJson).length > 0
    || extractThinkingBlocks(message.contentJson).length > 0
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
