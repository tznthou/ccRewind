import type { CSSProperties } from 'react'

export const TOKEN_COLORS = {
  cacheRead: 'var(--chart-token-cache-read)',
  cacheCreation: 'var(--chart-token-cache-creation)',
  newInput: 'var(--chart-token-new-input)',
  output: 'var(--chart-token-output)',
} as const

/**
 * recharts 沒傳就畫自己的字面色（3.10.1）：軸線與刻度線 #666、直角座標圖 Tooltip 的游標線 #ccc、Area 的 hover 圓點外圈 #fff、
 * 圓餅每片的框 #fff。改傳 token：時間線的 token 值就是這些預設值（畫面不變），黑板是粉筆灰與板面色。
 * tests/renderer/chartColorTokens.test.ts 檢查每個會畫的元件都有傳。
 */
export const CHART_AXIS_LINE = { stroke: 'var(--chart-axis)' }
export const CHART_CURSOR = { stroke: 'var(--chart-cursor)' }
export const CHART_ACTIVE_DOT = { stroke: 'var(--chart-dot-ring)' }
export const CHART_SLICE_GAP = 'var(--chart-slice-gap)'

/** 時間軸上快取中斷的點，跟事件清單的 warning／info 左框同色 */
export const MARKER_COLORS = {
  warning: 'var(--chart-marker-warning)',
  info: 'var(--chart-marker-info)',
} as const

export const CHART_TOOLTIP_STYLE: CSSProperties = {
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  fontSize: 12,
}

/** recharts 預設把 tooltip 的每一項畫成系列色：系列色是給圖形用的（--chart-*），淺青在亮色底上只有 1.3:1。字一律用主題的文字色，名稱已經說明是哪一項 */
export const CHART_TOOLTIP_ITEM_STYLE: CSSProperties = {
  color: 'var(--color-text)',
}
