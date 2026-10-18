// 切時區的 fixture 是閘門：除了切得過去，還要證明該紅的時候會紅
import { describe, it, expect, beforeEach } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import { assertTimeZoneInEffect, timeZoneMismatches, useTimeZone, wallClockIn } from './fixtures/timeZone'

const ORIGINAL_TZ = process.env.TZ

/** 停在 UTC 的本地時間：C 函式庫或 JS 沒跟著換時，CI 上看到的就是這個 */
const utcWallClock = (instant: string): string => instant.slice(0, 19).replace('T', ' ')

/** SQLite 'localtime' 把 instant 換成的本地時間 */
function sqliteLocal(instant: string): string {
  const db = new BetterSqlite3(':memory:')
  try {
    return (db.prepare(`SELECT datetime(?, 'localtime') AS local`).get(instant) as { local: string }).local
  } finally {
    db.close()
  }
}

describe('useTimeZone', () => {
  it('moves SQLite localtime and JS Date to the zone', () => {
    useTimeZone('America/New_York')
    // 探測時刻以外的時刻：2026-10-17T16:30Z 在紐約是 12:30（EDT，UTC−4）
    expect(sqliteLocal('2026-10-17T16:30:00.000Z')).toBe('2026-10-17 12:30:00')
    expect(new Date('2026-10-17T16:30:00.000Z').getHours()).toBe(12)
  })

  // 依賴上一條先跑：vitest 同檔照宣告順序執行
  it('puts TZ back after the previous test', () => {
    expect(process.env.TZ).toBe(ORIGINAL_TZ)
  })

  it('rejects a misspelled zone name instead of running in UTC', () => {
    // libc 不認得的名稱不報錯、直接當 UTC（2026-10-18 實測）；這裡要變紅燈
    expect(() => useTimeZone('America/New_Yrok')).toThrow(/America\/New_Yrok/)
  })

  it('throws when the zone it is told about is not the one in effect', () => {
    // 沒切就宣稱在別的時區，跟「切了但沒生效」是同一個狀態（threads pool、C 函式庫不跟 TZ 走）
    const current = Intl.DateTimeFormat().resolvedOptions().timeZone
    const elsewhere = current === 'Pacific/Kiritimati' ? 'America/New_York' : 'Pacific/Kiritimati'
    expect(() => assertTimeZoneInEffect(elsewhere)).toThrow(/is not in effect/)
  })

  describe('from beforeEach', () => {
    beforeEach(() => {
      useTimeZone('Asia/Kolkata')
    })

    it('applies to the test body', () => {
      // 2026-10-17T20:45Z 在加爾各答是 10-18 02:15（UTC+5:30）
      expect(sqliteLocal('2026-10-17T20:45:00.000Z')).toBe('2026-10-18 02:15:00')
    })
  })
})

// 真的切時區做不出「只有一邊沒跟上」「只有夏天對不上」，比對邏輯直接餵觀測值測
describe('timeZoneMismatches', () => {
  it.each([
    ['SQLite', 'sqlite'],
    ['JS', 'js'],
  ] as const)('reports %s when only that side stays in UTC', (label, side) => {
    const mismatches = timeZoneMismatches('America/New_York', instant => {
      const observed = { sqlite: wallClockIn('America/New_York', instant), js: wallClockIn('America/New_York', instant) }
      observed[side] = utcWallClock(instant)
      return observed
    })
    expect(mismatches).toHaveLength(2) // 一月、七月各一筆
    expect(mismatches.every(m => m.startsWith(`${label} `))).toBe(true)
  })

  it('checks a summer instant, not only winter', () => {
    // 倫敦冬天跟 UTC 同時間：只驗一月，會把「其實停在 UTC」放過
    const mismatches = timeZoneMismatches('Europe/London', instant => ({ sqlite: utcWallClock(instant), js: utcWallClock(instant) }))
    expect(mismatches).toHaveLength(2) // 七月的 SQLite 與 JS
    expect(mismatches.every(m => m.includes('2026-07-15T12:00:00.000Z'))).toBe(true)
  })
})
