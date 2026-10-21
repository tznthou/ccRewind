// 電腦目前時區的日期（YYYY-MM-DD）。main 的排除規則與 renderer 的側欄搜尋、儲存頁共用。
// SQL 端的日期條件也用這裡的 localMidnightIso 換算，不用 SQLite 的 'localtime'（兩邊的時區資料可能不同源）。

/** d 在電腦目前時區的日期 */
export function formatLocalDate(d: Date): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 時間戳在電腦目前時區的日期；解析不了回 null。
 * 輸入應帶 Z 或 offset（Claude Code 寫進 JSONL 的格式），先換算成同一時刻再取本地日期。
 * 不帶時區的字串 JS 當本地時間、SQLite 的日期函式當 UTC，兩邊會解讀成不同的時刻。
 */
export function localDateOf(timestamp: string): string | null {
  const d = new Date(timestamp)
  return Number.isNaN(d.getTime()) ? null : formatLocalDate(d)
}

/** YYYY-MM-DD 而且是真的日期：沒有 02-30、13 月；年份 0000–0099 也不收（Date 會把它當成 1900 年代） */
export function isCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const [y, m, d] = date.split('-').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d))
  return utc.getUTCFullYear() === y && utc.getUTCMonth() === m - 1 && utc.getUTCDate() === d
}

/**
 * 本地日期 date（YYYY-MM-DD）往後 days 天那一天的本地午夜，換成 UTC 的 ISO 字串（…T…Z，含毫秒）。
 * 用當地年月日建構：每一天的午夜照那一天的時差算，中間隔著夏令時間切換也對；午夜被夏令時間跳過的時區，
 * 得到的是那一天最早存在的時刻。date 要先用 isCalendarDate 驗過，不存在的日期會滾到別的月份（02-30 → 03-02）
 */
export function localMidnightIso(date: string, days = 0): string {
  const [y, m, d] = date.split('-').map(Number)
  const iso = new Date(y, m - 1, d + days).toISOString()
  // 9999-12-31 的隔天是一萬年，toISOString 寫成 +010000-…，SQLite 的日期函式讀不懂：用 9999 年的最後一刻代替
  return iso.startsWith('+') ? '9999-12-31T23:59:59.999Z' : iso
}
