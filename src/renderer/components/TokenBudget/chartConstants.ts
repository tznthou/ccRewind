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

/** recharts 預設把 tooltip 的每一項畫成系列色：系列色寫死、不跟主題，淺青在亮色底上只有 1.3:1。字一律用主題的文字色，名稱已經說明是哪一項 */
export const CHART_TOOLTIP_ITEM_STYLE: CSSProperties = {
  color: 'var(--color-text)',
}
