import { describe, it, expect } from 'vitest'
import { formatLocalDate, localDateOf } from '../src/shared/localDate'
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
