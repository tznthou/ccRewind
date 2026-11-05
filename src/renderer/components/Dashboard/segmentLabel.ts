/**
 * 專案健康度長條：段內放不放得下 outcome 名稱（只黑板，裁決 21；黑板計畫 PR2 改動 6）。
 * 段寬 = 佔比 × 長條寬。名稱是 .segmentLabel：--font-size-xs（12px × 字級）、左右 padding 各 4px（不隨字級）。
 * 字寬是估的：中文字（U+2E80 以後，含全形標點）1em，其他字元 7/12em（12px 時約 7px，spike 量過「一般」字級）。
 * 估少了名稱會被段的 overflow 切掉，三種字級的實際畫面另看（計畫完成條件 6）。
 */
const LABEL_FONT_PX = 12
const LABEL_PADDING_PX = 8
const CJK_EM = 1
const OTHER_EM = 7 / 12

export function labelWidthPx(name: string, fontScale: number): number {
  const em = [...name].reduce((sum, ch) => sum + (ch.codePointAt(0)! > 0x2e80 ? CJK_EM : OTHER_EM), 0)
  return em * LABEL_FONT_PX * fontScale + LABEL_PADDING_PX
}

/** 佔比 0 或算不出來（這個專案一筆都沒有 → 0 / 0 = NaN）時是 false：NaN 跟什麼比都是 false */
export function segmentLabelFits(name: string, share: number, barPx: number, fontScale: number): boolean {
  return share * barPx >= labelWidthPx(name, fontScale)
}
