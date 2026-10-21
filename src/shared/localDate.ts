// 電腦目前時區的日期（YYYY-MM-DD）。main 的排除規則與 renderer 的側欄搜尋、儲存頁共用；
// 格式跟 SQLite 的 date(x, 'localtime') 一樣，兩邊可以直接比字串。

/** d 在電腦目前時區的日期 */
export function formatLocalDate(d: Date): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 時間戳在電腦目前時區的日期；解析不了回 null。
 * 輸入應帶 Z 或 offset（Claude Code 寫進 JSONL 的格式），先換算成同一時刻再取本地日期。
 * 不帶時區的字串 JS 當本地時間、SQLite 的 date() 當 UTC，兩邊會解讀成不同的時刻。
 */
export function localDateOf(timestamp: string): string | null {
  const d = new Date(timestamp)
  return Number.isNaN(d.getTime()) ? null : formatLocalDate(d)
}
