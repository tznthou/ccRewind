/**
 * 成本熱度條一格的底色：強度 0–1（這次呼叫的 output / 整場最大的 output）→ 成本熱度色的透明度 10%–100%。
 * color-mix(in srgb, X p%, transparent) = X 透明度 p，跟改前的 rgba(245, 158, 11, a) 同一個顏色；p 不四捨五入（改前的透明度沒有取整）。
 */
export function costHeatCellBackground(intensity: number): string {
  return `color-mix(in srgb, var(--chart-cost-heat) ${(0.1 + intensity * 0.9) * 100}%, transparent)`
}
