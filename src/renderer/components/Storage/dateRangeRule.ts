import { isCalendarDate } from '../../../shared/localDate'
import type { ExclusionRuleInput } from '../../../shared/types'

/**
 * 「依日期範圍排除」表單目前的規則；什麼條件都沒有回 null。
 * 日期跟 main 的 normalizeRule 用同一個檢查（isCalendarDate）：改年份時日期欄位每打一個鍵就送一個值，
 * 0002、0020 年這種中間值 main 會拒絕，送過去只會在預覽換到一段錯誤訊息，所以先當成沒填
 */
export function buildDateRangeRule(projectId: string, dateFrom: string, dateTo: string): ExclusionRuleInput | null {
  const pid = projectId || null
  const df = isCalendarDate(dateFrom) ? dateFrom : null
  const dt = isCalendarDate(dateTo) ? dateTo : null
  if (!pid && !df && !dt) return null
  return { projectId: pid, dateFrom: df, dateTo: dt }
}
