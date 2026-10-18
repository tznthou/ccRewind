// 測試裡切換時區（儀表板用本地時間的測試共用）
// SQLite 的 'localtime' 與 JS 的 Date 都讀程序的 TZ。改 process.env.TZ 只在程序主執行緒有效（vitest 的 forks pool 符合）：
// worker_threads 裡改了沒效果，時區名打錯也不報錯、兩邊都靜默變成 UTC（2026-10-18 實測）。
// 所以切完先拿固定時刻驗證兩邊真的換了，沒換就丟錯，不讓測試在錯的時區裡跑出「剛好通過」。
import BetterSqlite3 from 'better-sqlite3'
import { onTestFinished } from 'vitest'

// 一月、七月各一個：有夏令時間的時區兩季時差不同，只驗一季會放過「剛好那一季對上」
const PROBES = ['2026-01-15T12:00:00.000Z', '2026-07-15T12:00:00.000Z']

/** 程序對某個時刻算出的本地時間：SQLite 'localtime' 與 JS Date 各一份 */
export interface ObservedLocal {
  sqlite: string
  js: string
}

/** instant 在 timeZone 的牆上時間（跟 SQLite datetime() 同格式）；用 ICU 算，不受程序 TZ 影響。時區名不認得會丟 RangeError */
export function wallClockIn(timeZone: string, instant: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(instant)).map(p => [p.type, p.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
}

/** 程序目前時區下的牆上時間（JS Date 的本地時間） */
function localWallClock(instant: string): string {
  const d = new Date(instant)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 每個探測時刻，SQLite 與 JS 算出的本地時間跟 timeZone 應有的不同，就各列一筆 */
export function timeZoneMismatches(timeZone: string, observe: (instant: string) => ObservedLocal): string[] {
  const mismatches: string[] = []
  for (const instant of PROBES) {
    const expected = wallClockIn(timeZone, instant)
    const { sqlite, js } = observe(instant)
    if (sqlite !== expected) mismatches.push(`SQLite ${sqlite} at ${instant}, expected ${expected}`)
    if (js !== expected) mismatches.push(`JS ${js} at ${instant}, expected ${expected}`)
  }
  return mismatches
}

/** 程序現在真的在 timeZone，不是就丟錯 */
export function assertTimeZoneInEffect(timeZone: string): void {
  const probe = new BetterSqlite3(':memory:')
  try {
    const stmt = probe.prepare(`SELECT datetime(?, 'localtime') AS local`)
    const mismatches = timeZoneMismatches(timeZone, instant => ({
      sqlite: (stmt.get(instant) as { local: string }).local,
      js: localWallClock(instant),
    }))
    if (mismatches.length > 0) throw new Error(`time zone ${timeZone} is not in effect: ${mismatches.join('; ')}`)
  } finally {
    probe.close()
  }
}

/** 這個測試改用 timeZone 跑，測試結束把 TZ 還原成原值；只動 TZ，不像 vi.unstubAllEnvs() 會連別的 env stub 一起清掉 */
export function useTimeZone(timeZone: string): void {
  const original = process.env.TZ
  process.env.TZ = timeZone
  onTestFinished(() => {
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
  })
  assertTimeZoneInEffect(timeZone)
}
