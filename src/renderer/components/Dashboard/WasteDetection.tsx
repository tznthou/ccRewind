import type { WasteSession } from '../../../shared/types'
import { formatTokens } from '../../utils/formatTokens'
import { formatDuration } from '../../utils/formatTime'
import styles from './Dashboard.module.css'

interface Props {
  data: WasteSession[]
  onSessionClick?: (sessionId: string) => void
}

const OUTCOME_COLORS: Record<string, string> = {
  'in-progress': '#f59e0b',
  'quick-qa': '#06b6d4',
}

export default function WasteDetection({ data, onSessionClick }: Props) {
  if (data.length === 0) {
    return <div className={styles.empty}>No waste detected</div>
  }

  return (
    <div className={styles.wasteList}>
      {data.slice(0, 10).map(s => (
        <div
          key={s.sessionId}
          className={styles.wasteItem}
          onClick={() => onSessionClick?.(s.sessionId)}
        >
          <div className={styles.wasteName} title={s.intentText ?? undefined}>
            {s.intentText || 'No description'}
          </div>
          <div className={styles.wasteMeta}>
            {formatTokens(s.totalTokens)}
          </div>
          <div className={styles.wasteMeta}>
            {formatDuration(s.durationSeconds) || '-'}
          </div>
          <div className={styles.wasteMeta}>
            {s.fileCount > 0 ? `${s.fileCount} files` : '-'}
          </div>
          <span
            className={styles.outcomeBadge}
            style={{ background: OUTCOME_COLORS[s.outcomeStatus ?? ''] ?? 'var(--color-text-muted)', color: '#fff' }}
          >
            {s.outcomeStatus ?? 'unknown'}
          </span>
        </div>
      ))}
    </div>
  )
}
