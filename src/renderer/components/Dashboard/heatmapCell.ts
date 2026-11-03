/**
 * 工作時段熱度圖一格（那個小時有 session）的底色：強度 0–1（那個小時的數量 / 最多的那個小時）→ 熱度色的透明度 15%–85%。
 * color-mix(in srgb, X p%, transparent) = X 透明度 p，跟改前的 rgba(59, 130, 246, a) 同一個顏色；p 不四捨五入（改前的透明度沒有取整）。
 */
export function heatmapCellBackground(intensity: number): string {
  return `color-mix(in srgb, var(--chart-heat) ${(0.15 + intensity * 0.7) * 100}%, transparent)`
}
