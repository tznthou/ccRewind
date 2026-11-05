import type { ThemeId } from './ThemeContext'

/**
 * localStorage 裡存的主題值 → app 現在用的主題（黑板計畫 PR2 改動 1、裁決 19）。
 * 檔案室與終端機移除了：檔案室改時間線、終端機改黑板；時間線與黑板原樣，其他（沒存過、亂碼）一律時間線。
 * public/scripts/theme-init.js 內嵌同一張表（React 之前就要寫 data-theme），tests/renderer/themeMigration.test.ts 兩份一起比。
 */
export function resolveTheme(stored: string | null): ThemeId {
  if (stored === 'board' || stored === 'terminal') return 'board'
  return 'timeline'
}
