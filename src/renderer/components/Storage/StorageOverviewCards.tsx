import type { StorageStats } from '../../../shared/types'
import { formatBytes } from '../../utils/formatBytes'
import styles from './Storage.module.css'

interface Props {
  stats: StorageStats
}

function formatDateOnly(iso: string | null): string {
  if (!iso) return '—'
  return iso.substring(0, 10)
}

export default function StorageOverviewCards({ stats }: Props) {
  return (
    <div className={styles.overviewGrid}>
      <div className={styles.card}>
        <div className={styles.cardLabel}>DB 大小</div>
        <div className={styles.cardValue}>{formatBytes(stats.dbBytes)}</div>
        <div className={styles.cardSub}>含 WAL / SHM sidecar</div>
      </div>
      <div className={styles.card}>
        <div className={styles.cardLabel}>Sessions</div>
        <div className={styles.cardValue}>{stats.sessionCount.toLocaleString()}</div>
        <div className={styles.cardSub}>{stats.projectCount} 個專案</div>
      </div>
      <div className={styles.card}>
        <div className={styles.cardLabel}>Messages</div>
        <div className={styles.cardValue}>{stats.messageCount.toLocaleString()}</div>
      </div>
      <div className={styles.card}>
        <div className={styles.cardLabel}>時間範圍</div>
        <div className={styles.cardValue}>{formatDateOnly(stats.earliestTimestamp)}</div>
        <div className={styles.cardSub}>→ {formatDateOnly(stats.latestTimestamp)}</div>
      </div>
    </div>
  )
}
