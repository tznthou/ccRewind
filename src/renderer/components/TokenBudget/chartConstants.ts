import type { CSSProperties } from 'react'

export const TOKEN_COLORS = {
  cacheRead: '#67e8f9',
  cacheCreation: '#0891b2',
  newInput: '#0c4a6e',
  output: '#f59e0b',
} as const

export const CHART_TOOLTIP_STYLE: CSSProperties = {
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  fontSize: 12,
}
