/**
 * 專案健康度長條：段內放不放得下 outcome 名稱（只黑板，裁決 21；黑板計畫 PR2 改動 6）。
 * 段寬 = 佔比 × 長條寬；名稱是 --font-size-xs，會隨字級（FontScaleContext 的 1、1.1、1.25）變寬。
 * 這一版是空殼（一律放不下）：tests/renderer/segmentLabel.test.ts 先寫好該有的性質、現在是紅的，之後換成實作。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 空殼：參數是實作要用的簽名，測試先紅
export function segmentLabelFits(name: string, share: number, barPx: number, fontScale: number): boolean {
  return false
}
