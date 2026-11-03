/**
 * 工作時段熱度圖一格（那個小時有 session）的底色：強度 0–1（那個小時的數量 / 最多的那個小時）→ 熱度色的透明度 15%–85%。
 * color-mix(in srgb, X p%, transparent) = X 透明度 p；p 是改前 rgba(59, 130, 246, a) 的 a × 100，不取整。
 * 改前的 rgba() 在 Chromium 裡透明度會量化成 1/255 一階，color-mix() 保留精確值，所以畫出來可能差 1 個色階。
 */
export function heatmapCellBackground(intensity: number): string {
  return `color-mix(in srgb, var(--chart-heat) ${(0.15 + intensity * 0.7) * 100}%, transparent)`
}
