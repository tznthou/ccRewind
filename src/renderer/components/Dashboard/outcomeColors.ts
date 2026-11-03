import type { MessageKey } from '../../i18n/messages'

export type OutcomeKey = 'committed' | 'tested' | 'in-progress' | 'quick-qa' | 'unknown'

export const OUTCOME_KEYS: readonly OutcomeKey[] = [
  'committed',
  'tested',
  'in-progress',
  'quick-qa',
  'unknown',
] as const

export const OUTCOME_COLORS: Record<OutcomeKey, string> = {
  committed: 'var(--chart-outcome-committed)',
  tested: 'var(--chart-outcome-tested)',
  'in-progress': 'var(--chart-outcome-in-progress)',
  'quick-qa': 'var(--chart-outcome-quick-qa)',
  unknown: 'var(--chart-outcome-unknown)',
}

export const OUTCOME_I18N_KEY: Record<OutcomeKey, MessageKey> = {
  committed: 'dashboard.outcome.committed',
  tested: 'dashboard.outcome.tested',
  'in-progress': 'dashboard.outcome.inProgress',
  'quick-qa': 'dashboard.outcome.quickQa',
  unknown: 'dashboard.outcome.unknown',
}

export const DISTRIBUTION_KEY_TO_OUTCOME = {
  committed: 'committed',
  tested: 'tested',
  inProgress: 'in-progress',
  quickQa: 'quick-qa',
  unknown: 'unknown',
} as const satisfies Record<string, OutcomeKey>

export type DistributionKey = keyof typeof DISTRIBUTION_KEY_TO_OUTCOME

// Order must mirror OUTCOME_KEYS so the legend (rendered from OUTCOME_KEYS) and
// the stacked bar segments (rendered from DISTRIBUTION_KEYS) line up visually.
export const DISTRIBUTION_KEYS: readonly DistributionKey[] = [
  'committed',
  'tested',
  'inProgress',
  'quickQa',
  'unknown',
] as const

/**
 * DB 裡的 outcome 字串 → 認得的 OutcomeKey，其餘（null、空字串、沒見過的值）一律 unknown。
 * 用清單比對而不是 `status in OUTCOME_COLORS`：後者對 toString 這類繼承來的鍵也成立。
 */
export function outcomeKeyOf(status: string | null | undefined): OutcomeKey {
  return (OUTCOME_KEYS as readonly string[]).includes(status ?? '') ? (status as OutcomeKey) : 'unknown'
}
