/** content array 裡的 thinking block（Claude 推理過程，原始 JSONL 保留在 message_content.content_json） */
export interface ThinkingBlock {
  type: 'thinking'
  thinking: string
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
