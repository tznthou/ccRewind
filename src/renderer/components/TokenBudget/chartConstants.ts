import type { CSSProperties } from 'react'

export const TOKEN_COLORS = {
  cacheRead: '#67e8f9',
  cacheCreation: '#0891b2',
  newInput: '#0c4a6e',
  output: '#f59e0b',
} as const

/** 時間軸上快取中斷的點，跟事件清單的 warning／info 左框同色 */
export const MARKER_COLORS = {
  warning: '#f59e0b',
  info: '#3b82f6',
} as const

export const CHART_TOOLTIP_STYLE: CSSProperties = {
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  fontSize: 12,
}
