import type { ThemeId } from './ThemeContext'

/**
 * localStorage 裡存的主題值 → app 現在用的主題（黑板計畫 PR2 改動 1、裁決 19）。
 * 這一版是改動前的行為原樣抽出來（舊的三個主題原樣、其他回時間線），還不會遷移：
 * tests/renderer/themeMigration.test.ts 先寫好遷移後的表、現在是紅的，下一步把這裡換成那張表。
 */
export function resolveTheme(stored: string | null): ThemeId {
  if (stored === 'archive' || stored === 'timeline' || stored === 'terminal') return stored
  return 'timeline'
}
