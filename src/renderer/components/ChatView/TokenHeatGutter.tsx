import { useMemo, type CSSProperties } from 'react'
import type { Message } from '../../../shared/types'

export interface HeatInfo {
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
  }, [messages])
}

export interface HeatGutterProps {
  /** "positive" (cache-efficient) or "negative" (expensive) */
  attr: 'positive' | 'negative'
  /** CSS custom property: --heat-intensity as percentage */
  style: CSSProperties
}

/**
 * Returns data-heat attribute value + CSS custom property for intensity.
 * Color is CSS-driven via color-mix() — each theme defines its own heat colors.
 */
export function getHeatProps(heat: HeatInfo | undefined): HeatGutterProps | undefined {
  if (!heat) return undefined
  const { intensity, cacheGood } = heat
  if (intensity === 0 && cacheGood) return undefined

  const pct = Math.round((0.65 + intensity * 0.35) * 100)

  return {
    attr: cacheGood ? 'positive' : 'negative',
    style: { '--heat-intensity': `${pct}%` } as CSSProperties,
  }
}
