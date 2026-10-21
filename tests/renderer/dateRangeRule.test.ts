import { describe, it, expect } from 'vitest'
import { buildDateRangeRule } from '../../src/renderer/components/Storage/dateRangeRule'

describe('buildDateRangeRule', () => {
  it('keeps real dates and the project', () => {
    expect(buildDateRangeRule('-p', '2026-10-01', '2026-10-21')).toEqual({ projectId: '-p', dateFrom: '2026-10-01', dateTo: '2026-10-21' })
  })

  it('treats a date main would reject as not filled in (the year typed so far, a day that does not exist)', () => {
    // 改年份時日期欄位每打一個鍵就送一個值：0002、0020 年 main 的 isCalendarDate 會拒絕，送過去只會換到一段英文錯誤
    expect(buildDateRangeRule('', '0002-10-21', '2026-10-21')).toEqual({ projectId: null, dateFrom: null, dateTo: '2026-10-21' })
    expect(buildDateRangeRule('-p', '2026-02-30', '')).toEqual({ projectId: '-p', dateFrom: null, dateTo: null })
    expect(buildDateRangeRule('-p', '2026-10-01', '0002-10-21')).toEqual({ projectId: '-p', dateFrom: '2026-10-01', dateTo: null })
  })

  it('gives no rule when nothing usable is set', () => {
    expect(buildDateRangeRule('', '', '')).toBeNull()
    expect(buildDateRangeRule('', '0020-10-21', '')).toBeNull()
  })
})
