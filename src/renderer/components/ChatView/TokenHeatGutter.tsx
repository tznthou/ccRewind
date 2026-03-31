import { useMemo } from 'react'
import type { Message } from '../../../shared/types'

interface HeatInfo {
  /** 0–1 intensity based on context delta */
  intensity: number
  /** true if cache hit rate is good (>50%) */
  cacheGood: boolean
}

/**
 * Pre-computes heat info for each message.
 * Returns a Map<messageId, HeatInfo> for O(1) lookup.
 */
export function useTokenHeat(messages: Message[]): Map<number, HeatInfo> {
  return useMemo(() => {
    const map = new Map<number, HeatInfo>()
    const assistantMsgs = messages.filter(m => m.role === 'assistant' && m.inputTokens != null)

    if (assistantMsgs.length === 0) return map

    // Compute context deltas
    const deltas: number[] = []
    for (let i = 0; i < assistantMsgs.length; i++) {
      const curr = assistantMsgs[i].inputTokens!
      const prev = i > 0 ? assistantMsgs[i - 1].inputTokens! : 0
      deltas.push(Math.max(0, curr - prev))
    }

    const maxDelta = Math.max(...deltas, 1)

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
  }, [messages])
}

/**
 * Returns inline style for a message's heat gutter indicator.
 * Uses inset box-shadow (not border-left) to avoid overriding theme borders.
 */
export function getHeatStyle(heat: HeatInfo | undefined): React.CSSProperties | undefined {
  if (!heat) return undefined
  const { intensity, cacheGood } = heat
  if (intensity === 0 && cacheGood) return undefined

  // Red = expensive (high delta), Green = cache-efficient
  const color = cacheGood
    ? `rgba(34, 197, 94, ${0.3 + intensity * 0.7})`   // green
    : `rgba(239, 68, 68, ${0.3 + intensity * 0.7})`    // red

  return { boxShadow: `inset 3px 0 0 ${color}` }
}
