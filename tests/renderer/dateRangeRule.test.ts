import { describe, it, expect } from 'vitest'
import { buildDateRangeRule } from '../../src/renderer/components/Storage/dateRangeRule'

const fields = (overrides: Partial<Parameters<typeof buildDateRangeRule>[0]> = {}) => ({
  projectId: '', dateFrom: '', dateTo: '', dateFromIncomplete: false, dateToIncomplete: false, ...overrides,
})

describe('buildDateRangeRule', () => {
  it('builds the rule from real dates and the project', () => {
    expect(buildDateRangeRule(fields({ projectId: '-p', dateFrom: '2026-10-01', dateTo: '2026-10-21' })))
      .toEqual({ status: 'ready', rule: { projectId: '-p', dateFrom: '2026-10-01', dateTo: '2026-10-21' } })
    expect(buildDateRangeRule(fields({ projectId: '-p' })))
      .toEqual({ status: 'ready', rule: { projectId: '-p', dateFrom: null, dateTo: null } })
  })

  it('has no rule when nothing is filled in', () => {
    expect(buildDateRangeRule(fields())).toEqual({ status: 'empty' })
  })

  it('never drops a date that is filled in but not a real date: that would widen the range', () => {
    // 改年份時每打一個鍵就送一個值（0002、0020 年）；連續打數字時年份會吃成 6 位數；不存在的日期。
    // 當成沒填的話，那一端的條件就消失：起日變成「迄日以前全部」，迄日變成「起日以後全部」
    for (const bad of ['0002-10-21', '0020-10-21', '202610-02-01', '2026-02-30']) {
      expect(buildDateRangeRule(fields({ dateFrom: bad, dateTo: '2026-10-21' }))).toEqual({ status: 'invalid-date' })
      expect(buildDateRangeRule(fields({ projectId: '-p', dateFrom: '2026-10-01', dateTo: bad }))).toEqual({ status: 'invalid-date' })
    }
  })

  it('treats a date field the browser reports as incomplete as invalid, even though its value is empty', () => {
    // <input type="date"> 只填了一部分時 value 是空字串，跟沒填分不出來，要看 validity.badInput
    expect(buildDateRangeRule(fields({ projectId: '-p', dateFromIncomplete: true }))).toEqual({ status: 'invalid-date' })
    expect(buildDateRangeRule(fields({ dateFrom: '2026-10-01', dateToIncomplete: true }))).toEqual({ status: 'invalid-date' })
  })
})
