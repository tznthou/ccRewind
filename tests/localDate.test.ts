import { describe, it, expect } from 'vitest'
import { formatLocalDate, isCalendarDate, localDateOf, localMidnightIso } from '../src/shared/localDate'
import { useTimeZone } from './fixtures/timeZone'

describe('formatLocalDate', () => {
  it('uses the local calendar date, not the UTC one', () => {
    useTimeZone('Pacific/Kiritimati')
    // 基里巴斯 10-17 05:00（UTC+14），UTC 還是 10-16
    expect(formatLocalDate(new Date('2026-10-16T15:00:00.000Z'))).toBe('2026-10-17')
  })

  it('pads the year, month and day like SQLite date()', () => {
    useTimeZone('America/New_York')
    expect(formatLocalDate(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(formatLocalDate(new Date(999, 11, 31))).toBe('0999-12-31')
  })
})

describe('localDateOf', () => {
  it('takes the local date of the instant, west of UTC too', () => {
    useTimeZone('America/New_York')
    // 紐約 10-16 21:30（EDT），UTC 已經是 10-17
    expect(localDateOf('2026-10-17T01:30:00.000Z')).toBe('2026-10-16')
  })

  it('converts an offset timestamp to the same instant before taking the local date', () => {
    useTimeZone('America/New_York')
    // +08:00 的 07-01 00:30 是 2024-06-30T16:30Z，紐約 06-30 12:30（EDT）
    expect(localDateOf('2024-07-01T00:30:00+08:00')).toBe('2024-06-30')
  })

  it('keeps the last minute of the 25-hour day on that day when DST ends', () => {
    useTimeZone('America/New_York')
    // 2026-11-01 02:00 EDT 撥回 01:00 EST，那天有 25 小時：23:59 EST 是 11-02T04:59Z，隔天午夜是 05:00Z
    expect(localDateOf('2026-11-02T04:59:00.000Z')).toBe('2026-11-01')
    expect(localDateOf('2026-11-02T05:00:00.000Z')).toBe('2026-11-02')
  })

  it('returns null for a timestamp it cannot parse', () => {
    expect(localDateOf('not-a-date')).toBeNull()
    expect(localDateOf('')).toBeNull()
  })
})

describe('localMidnightIso', () => {
  it('gives the UTC instant of local midnight, east of UTC', () => {
    useTimeZone('Pacific/Kiritimati')
    // 基里巴斯（UTC+14）10-10 的午夜是 10-09T10:00Z
    expect(localMidnightIso('2026-10-10')).toBe('2026-10-09T10:00:00.000Z')
    expect(localMidnightIso('2026-10-12', 1)).toBe('2026-10-12T10:00:00.000Z')
  })

  it('takes each day at its own offset across DST, and rolls over month ends', () => {
    useTimeZone('America/New_York')
    // 03-08 02:00 切夏令時間：03-08 的午夜還是 EST（05:00Z），03-09 的午夜已是 EDT（04:00Z）
    expect(localMidnightIso('2026-03-08')).toBe('2026-03-08T05:00:00.000Z')
    expect(localMidnightIso('2026-03-08', 1)).toBe('2026-03-09T04:00:00.000Z')
    // 11-01 有 25 小時：隔天午夜是 11-02T05:00Z
    expect(localMidnightIso('2026-11-01', 1)).toBe('2026-11-02T05:00:00.000Z')
    expect(localMidnightIso('2026-01-31', 1)).toBe('2026-02-01T05:00:00.000Z')
  })
})

describe('isCalendarDate', () => {
  it('accepts real dates only', () => {
    expect(isCalendarDate('2026-02-28')).toBe(true)
    expect(isCalendarDate('2024-02-29')).toBe(true)
    // 格式對、但不存在的日期：換成本地午夜時會滾到別的月份（02-30 → 03-02）
    expect(isCalendarDate('2026-02-30')).toBe(false)
    expect(isCalendarDate('2026-13-01')).toBe(false)
    expect(isCalendarDate('2026-00-10')).toBe(false)
    expect(isCalendarDate('2026-2-3')).toBe(false)
    expect(isCalendarDate('not-a-date')).toBe(false)
  })
})
