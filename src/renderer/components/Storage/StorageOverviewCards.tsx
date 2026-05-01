import type { StorageStats } from '../../../shared/types'
import { useI18n } from '../../i18n/useI18n'
import { formatBytes } from '../../utils/formatBytes'
import { formatDateOnly } from '../../utils/formatTime'
import styles from './Storage.module.css'

interface Props {
  stats: StorageStats
}

export default function StorageOverviewCards({ stats }: Props) {
  const { t } = useI18n()
  return (
    <div className={styles.overviewGrid}>
      <div className={styles.card}>
        <div className={styles.cardLabel}>{t('storage.overview.dbSize')}</div>
        <div className={styles.cardValue}>{formatBytes(stats.dbBytes)}</div>
        <div className={styles.cardSub}>{t('storage.overview.dbSizeHint')}</div>
      </div>
      <div className={styles.card}>
        <div className={styles.cardLabel}>{t('storage.overview.sessions')}</div>
        <div className={styles.cardValue}>{stats.sessionCount.toLocaleString()}</div>
        <div className={styles.cardSub}>{t('storage.overview.projectCount', { count: stats.projectCount })}</div>
      </div>
      <div className={styles.card}>
        <div className={styles.cardLabel}>{t('storage.overview.messages')}</div>
        <div className={styles.cardValue}>{stats.messageCount.toLocaleString()}</div>
      </div>
      <div className={styles.card}>
        <div className={styles.cardLabel}>{t('storage.overview.timeRange')}</div>
        <div className={styles.cardValue}>{formatDateOnly(stats.earliestTimestamp)}</div>
        <div className={styles.cardSub}>→ {formatDateOnly(stats.latestTimestamp)}</div>
      </div>
    </div>
  )
}
