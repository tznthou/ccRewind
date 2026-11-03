/**
 * 成本熱度條一格的底色：強度 0–1（這次呼叫的 output / 整場最大的 output）→ 成本熱度色的透明度 10%–100%。
 * color-mix(in srgb, X p%, transparent) = X 透明度 p；p 是改前 rgba(245, 158, 11, a) 的 a × 100，不取整。
 * 改前的 rgba() 在 Chromium 裡透明度會量化成 1/255 一階，color-mix() 保留精確值，所以畫出來可能差 1 個色階。
 */
export function costHeatCellBackground(intensity: number): string {
  return `color-mix(in srgb, var(--chart-cost-heat) ${(0.1 + intensity * 0.9) * 100}%, transparent)`
}
