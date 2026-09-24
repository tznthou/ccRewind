import type { ExclusionMode, ExclusionPreview, ExclusionRule } from '../../../shared/types'

/** 對話框預設選「保留資料」：刪除不可逆，什麼都不動直接確認的結果必須是資料還在 */
export const DEFAULT_EXCLUSION_MODE: ExclusionMode = 'rule-only'

/** 刪除超過全部 session 的這個比例就警告（嚴格大於） */
const HIGH_IMPACT_RATIO = 0.5

export interface ExclusionDialogView {
  /** 有符合的 session 才有東西可刪；0 筆時只能保留資料 */
  canDelete: boolean
  /** 實際生效的模式：不能刪時一律是 rule-only，不管畫面上選了什麼 */
  mode: ExclusionMode
  /** 影響比例與高影響警告描述的是「要刪掉多少」，只屬於刪除 */
  showImpactRatio: boolean
  impactRatio: number
  highImpact: boolean
  /** 只有不可逆的刪除要勾選確認 */
  needsAcknowledge: boolean
}

export function exclusionDialogView(
  preview: ExclusionPreview,
  totalSessions: number,
  selected: ExclusionMode,
): ExclusionDialogView {
  const canDelete = preview.sessionCount > 0
  const mode: ExclusionMode = canDelete ? selected : 'rule-only'
  const isDelete = mode === 'delete'
  const showImpactRatio = isDelete && totalSessions > 0
  const impactRatio = showImpactRatio ? preview.sessionCount / totalSessions : 0
  return {
    canDelete,
    mode,
    showImpactRatio,
    impactRatio,
    highImpact: showImpactRatio && impactRatio > HIGH_IMPACT_RATIO,
    needsAcknowledge: isDelete,
  }
}

/** delete 規則移除後，建規則時刪掉的資料不會跟著回來，要先講清楚；rule-only 沒動過資料，直接移除 */
export function removalNeedsConfirm(rule: Pick<ExclusionRule, 'mode'>): boolean {
  return rule.mode === 'delete'
}
