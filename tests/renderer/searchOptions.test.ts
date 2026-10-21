import { describe, it, expect } from 'vitest'
import { buildSearchOptions } from '../../src/renderer/components/Sidebar/searchOptions'
import { useTimeZone } from '../fixtures/timeZone'

describe('buildSearchOptions', () => {
  it('starts N days back at local midnight: east of UTC, early in the morning', () => {
    useTimeZone('Pacific/Kiritimati')
    // 基里巴斯 04-15 05:00（UTC+14），UTC 還是 04-14。照 UTC 取日期會早一天
    const now = new Date('2026-04-14T15:00:00.000Z')
    expect(buildSearchOptions('7d', 'rank', now)).toEqual({ dateFrom: '2026-04-08', sortBy: 'rank' })
    expect(buildSearchOptions('30d', 'date', now)).toEqual({ dateFrom: '2026-03-16', sortBy: 'date' })
    expect(buildSearchOptions('90d', 'rank', now)).toEqual({ dateFrom: '2026-01-15', sortBy: 'rank' })
  })

  it('starts N days back at local midnight: west of UTC, late in the evening, across the start of DST', () => {
    useTimeZone('America/New_York')
    // 紐約 03-10 23:30（EDT，03-08 才切夏令時間），UTC 已是 03-11。7 天前是 03-03（EST）
    const now = new Date('2026-03-11T03:30:00.000Z')
    expect(buildSearchOptions('7d', 'rank', now)).toEqual({ dateFrom: '2026-03-03', sortBy: 'rank' })
  })

  it('"all" sends no date: nothing at all when sorting by rank', () => {
    const now = new Date('2026-04-14T15:00:00.000Z')
    expect(buildSearchOptions('all', 'rank', now)).toBeUndefined()
    expect(buildSearchOptions('all', 'date', now)).toEqual({ sortBy: 'date' })
  })
})
