import type { WasteSession } from '../../../shared/types'
import { useI18n } from '../../i18n/useI18n'
import { formatTokens } from '../../utils/formatTokens'
import { formatDuration } from '../../utils/formatTime'
import { OUTCOME_I18N_KEY, resolveOutcomeColor, type OutcomeKey } from './outcomeColors'
import styles from './Dashboard.module.css'

interface Props {
  data: WasteSession[]
  onSessionClick?: (projectId: string, sessionId: string) => void
}

export default function UnresolvedSessions({ data, onSessionClick }: Props) {
  const { t } = useI18n()

  if (data.length === 0) {
    return <div className={styles.empty}>{t('dashboard.unresolved.empty')}</div>
  }

  return (
    <div className={styles.unresolvedList}>
      {data.slice(0, 10).map(s => {
        const status = (s.outcomeStatus ?? 'unknown') as OutcomeKey
        const labelKey = OUTCOME_I18N_KEY[status] ?? OUTCOME_I18N_KEY.unknown
        const handleActivate = () => onSessionClick?.(s.projectId, s.sessionId)
        return (
          <div
            key={s.sessionId}
            className={styles.unresolvedItem}
            role="button"
            tabIndex={0}
            onClick={handleActivate}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                handleActivate()
              }
            }}
          >
            <div className={styles.unresolvedName} title={s.intentText ?? undefined}>
              {s.intentText || t('dashboard.unresolved.noDescription')}
            </div>
            <div className={styles.unresolvedMeta}>{formatTokens(s.totalTokens)}</div>
            <div className={styles.unresolvedMeta}>{formatDuration(s.durationSeconds) || '-'}</div>
            <div className={styles.unresolvedMeta}>
              {s.fileCount > 0 ? t('dashboard.unresolved.unitFiles', { count: s.fileCount }) : '-'}
            </div>
            <span
              className={styles.outcomeBadge}
              style={{ background: resolveOutcomeColor(s.outcomeStatus), color: '#fff' }}
            >
              {t(labelKey)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
