import { useMemo, type CSSProperties } from 'react'
import type { Message } from '../../../shared/types'
import { computeTokenHeat, type HeatInfo } from './tokenHeat'

export type { HeatInfo } from './tokenHeat'

/**
 * Pre-computes heat info for each message.
 * Returns a Map<messageId, HeatInfo> for O(1) lookup.
 */
export function useTokenHeat(messages: Message[]): Map<number, HeatInfo> {
  return useMemo(() => computeTokenHeat(messages), [messages])
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
