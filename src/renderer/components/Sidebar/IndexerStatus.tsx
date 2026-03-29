import { useIndexerStatus } from '../../hooks/useIndexerStatus'
import styles from './Sidebar.module.css'

const PHASE_LABELS: Record<string, string> = {
  scanning: '掃描中',
  parsing: '解析中',
  indexing: '索引中',
  done: '索引完成',
}

export default function IndexerStatus() {
  const status = useIndexerStatus()

  if (!status || status.phase === 'done') return null

  const label = PHASE_LABELS[status.phase] ?? status.phase
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
