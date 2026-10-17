import type { Message } from '../../../shared/types'

export interface HeatInfo {
  /** 0–1 intensity based on context delta */
  intensity: number
  /** true if cache hit rate is good (>50%) */
  cacheGood: boolean
}

/** The message fields the heat computation reads */
export type HeatMessage = Pick<Message, 'id' | 'role' | 'inputTokens' | 'cacheReadTokens'>

/**
 * Heat info for each assistant message with token usage.
 * Returns a Map<messageId, HeatInfo> for O(1) lookup.
 */
export function computeTokenHeat(messages: readonly HeatMessage[]): Map<number, HeatInfo> {
  const map = new Map<number, HeatInfo>()
  // inputTokens is the whole context of the call, so 0 means the row carries no usage at all (`<synthetic>` replies).
  // Keeping such a row would make it the baseline, and the next real reply would count its entire context as growth.
  const assistantMsgs = messages.filter(m => m.role === 'assistant' && m.inputTokens != null && m.inputTokens > 0)

  if (assistantMsgs.length === 0) return map

  // Compute context deltas
  const deltas: number[] = []
  for (let i = 0; i < assistantMsgs.length; i++) {
    const curr = assistantMsgs[i].inputTokens!
    const prev = i > 0 ? assistantMsgs[i - 1].inputTokens! : 0
    deltas.push(Math.max(0, curr - prev))
  }

  const maxDelta = deltas.reduce((a, b) => Math.max(a, b), 1)

  for (let i = 0; i < assistantMsgs.length; i++) {
    const msg = assistantMsgs[i]
    const cacheRead = msg.cacheReadTokens ?? 0
    const total = msg.inputTokens ?? 0
    const cacheGood = total > 0 ? cacheRead / total > 0.5 : true

    map.set(msg.id, {
      intensity: deltas[i] / maxDelta,
      cacheGood,
    })
  }

  return map
}
