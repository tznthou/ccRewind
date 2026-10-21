import { formatLocalDate } from '../../../shared/localDate'
import type { SearchOptions, SearchSortBy } from '../../../shared/types'

export type DateRange = 'all' | '7d' | '30d' | '90d'

const DATE_RANGE_DAYS: Record<Exclude<DateRange, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
}

/**
 * 側欄搜尋的篩選條件。N 天＝從 N 天前的本地午夜起算，含今天共 N+1 個日曆天（儀表板的 7D 是 7 個，兩邊不同）。
 * 日期是電腦目前時區的日期，main 端把它換成本地午夜的時刻（localMidnightIso）再比。now 給測試釘住「現在」。
 */
export function buildSearchOptions(dateRange: DateRange, sortBy: SearchSortBy, now: Date = new Date()): SearchOptions | undefined {
  let dateFrom: string | undefined
  if (dateRange !== 'all') {
    // 用當地年月日建構：中間隔著夏令時間切換也是那一天
    dateFrom = formatLocalDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - DATE_RANGE_DAYS[dateRange]))
  }
  if (!dateFrom && sortBy === 'rank') return undefined
  return { dateFrom, sortBy }
}
