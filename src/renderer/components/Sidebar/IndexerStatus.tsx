import { useIndexerStatus } from '../../hooks/useIndexerStatus'
import { useI18n } from '../../i18n/useI18n'
import type { MessageKey } from '../../i18n/messages'
import styles from './Sidebar.module.css'

const PHASE_KEYS: Record<string, MessageKey> = {
  scanning: 'sidebar.indexer.scanning',
  parsing: 'sidebar.indexer.parsing',
  indexing: 'sidebar.indexer.indexing',
  done: 'sidebar.indexer.done',
}

export default function IndexerStatus() {
  const status = useIndexerStatus()
  const { t } = useI18n()

  if (!status || status.phase === 'done') return null

  const labelKey = PHASE_KEYS[status.phase]
  const label = labelKey ? t(labelKey) : status.phase
  const percent = status.total > 0
    ? Math.round((status.current / status.total) * 100)
    : 0

  return (
    <div className={styles.indexerStatus}>
      <div className={styles.indexerLabel}>
        {label} ({status.current}/{status.total})
      </div>
      <div
        className={styles.progressTrack}
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={styles.progressFill}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
