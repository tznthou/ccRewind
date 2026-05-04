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
  committed: '#22c55e',
  tested: '#3b82f6',
  'in-progress': '#f59e0b',
  'quick-qa': '#06b6d4',
  unknown: 'var(--color-text-muted)',
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

export function resolveOutcomeColor(status: string | null | undefined): string {
  if (status && status in OUTCOME_COLORS) {
    return OUTCOME_COLORS[status as OutcomeKey]
  }
  return OUTCOME_COLORS.unknown
}
