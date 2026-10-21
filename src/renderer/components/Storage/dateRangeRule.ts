import { isCalendarDate } from '../../../shared/localDate'
import type { ExclusionRuleInput } from '../../../shared/types'

export interface DateRangeFields {
  projectId: string
  dateFrom: string
  dateTo: string
  /** 日期欄位只填了一部分（validity.badInput）：這時 value 是空字串，跟沒填分不出來 */
  dateFromIncomplete: boolean
  dateToIncomplete: boolean
}

export type DateRangeRuleState =
  | { status: 'empty' }
  | { status: 'invalid-date' }
  | { status: 'ready'; rule: ExclusionRuleInput }

/**
 * 「依日期範圍排除」表單目前的規則。日期欄位有填、卻不是真的日期（改年份時的 0002、連續打數字吃成 6 位數的年份、
 * 不存在的日期、只填了一部分）就是 invalid-date，不送預覽也不能送出：當成沒填的話那一端的條件就消失，
 * 範圍悄悄變寬，預覽和刪除都照變寬的範圍走。檢查跟 main 的 normalizeRule 是同一個（isCalendarDate）
 */
export function buildDateRangeRule(fields: DateRangeFields): DateRangeRuleState {
  const { projectId, dateFrom, dateTo, dateFromIncomplete, dateToIncomplete } = fields
  const invalid = (value: string, incomplete: boolean): boolean => incomplete || (value !== '' && !isCalendarDate(value))
  if (invalid(dateFrom, dateFromIncomplete) || invalid(dateTo, dateToIncomplete)) return { status: 'invalid-date' }
  const rule = { projectId: projectId || null, dateFrom: dateFrom || null, dateTo: dateTo || null }
  if (!rule.projectId && !rule.dateFrom && !rule.dateTo) return { status: 'empty' }
  return { status: 'ready', rule }
}
