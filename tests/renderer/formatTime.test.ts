import { describe, it, expect } from 'vitest'
import { formatLocalDateOnly } from '../../src/renderer/utils/formatTime'
import { useTimeZone } from '../fixtures/timeZone'

describe('formatLocalDateOnly', () => {
  it('shows the local date east of UTC', () => {
    useTimeZone('Pacific/Kiritimati')
    // 基里巴斯 10-19 01:30（UTC+14），UTC 還是 10-18；取字串前 10 碼會差一天
    expect(formatLocalDateOnly('2026-10-18T11:30:00.000Z')).toBe('2026-10-19')
  })

  it('shows the local date west of UTC', () => {
    useTimeZone('America/New_York')
    // 紐約 10-18 21:30（EDT），UTC 已是 10-19
    expect(formatLocalDateOnly('2026-10-19T01:30:00.000Z')).toBe('2026-10-18')
  })

  it('shows a dash when there is no time or it cannot be read', () => {
    expect(formatLocalDateOnly(null)).toBe('—')
    expect(formatLocalDateOnly('')).toBe('—')
    expect(formatLocalDateOnly('not-a-date')).toBe('—')
  })
})
