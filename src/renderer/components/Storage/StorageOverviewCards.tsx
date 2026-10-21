import type { StorageStats } from '../../../shared/types'
import { useI18n } from '../../i18n/useI18n'
import { localDateOf } from '../../../shared/localDate'
import { formatBytes } from '../../utils/formatBytes'
import styles from './Storage.module.css'

interface Props {
  stats: StorageStats
}

/**
 * 時間範圍卡用本地日期：挑「依日期範圍排除」的範圍時會參考它，要跟規則一樣照電腦目前的時區。
 * 沒有或解析不了的顯示「—」
 */
function localDateOrDash(timestamp: string | null): string {
  return (timestamp ? localDateOf(timestamp) : null) ?? '—'
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
        <div className={styles.cardValue}>{localDateOrDash(stats.earliestTimestamp)}</div>
        <div className={styles.cardSub}>→ {localDateOrDash(stats.latestTimestamp)}</div>
      </div>
    </div>
  )
}
