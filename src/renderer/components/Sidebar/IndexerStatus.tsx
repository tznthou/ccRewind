import { useEffect, useState } from 'react'
import { useIndexerStatus } from '../../hooks/useIndexerStatus'
import { useI18n } from '../../i18n/useI18n'
import { useAppDispatch } from '../../context/AppContext'
import type { MessageKey } from '../../i18n/messages'
import styles from './Sidebar.module.css'

const PHASE_KEYS: Record<string, MessageKey> = {
  scanning: 'sidebar.indexer.scanning',
  parsing: 'sidebar.indexer.parsing',
  indexing: 'sidebar.indexer.indexing',
  done: 'sidebar.indexer.done',
}

/** lastIndexedAt（ISO 8601）相對 now（epoch ms）的人話格式。
 *  <10s = justNow、<60s = secondsAgo、<60min = minutesAgo、其餘 = hoursAgo。
 *  daysAgo 不需要——lastIndexedAt 不持久化，app 重啟即清，跨日場景不存在。 */
function formatLastIndexed(
  lastIndexedAt: string,
  now: number,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): string {
  const diffSec = Math.max(0, Math.floor((now - Date.parse(lastIndexedAt)) / 1000))
  if (diffSec < 10) return t('sidebar.indexer.lastIndexed.justNow')
  if (diffSec < 60) return t('sidebar.indexer.lastIndexed.secondsAgo', { count: diffSec })
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return t('sidebar.indexer.lastIndexed.minutesAgo', { count: diffMin })
  const diffHr = Math.floor(diffMin / 60)
  return t('sidebar.indexer.lastIndexed.hoursAgo', { count: diffHr })
}

export default function IndexerStatus() {
  const { status, triggerSync } = useIndexerStatus()
  const { t } = useI18n()
  const dispatch = useAppDispatch()
  const [now, setNow] = useState(() => Date.now())
  const [syncing, setSyncing] = useState(false)

  // 10 秒刷新一次「Xs ago」顯示
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 10_000)
    return () => window.clearInterval(id)
  }, [])

  if (!status) return null

  // 進度中：顯示 progress bar（既有行為，不顯示 Sync now button）
  if (status.phase !== 'done') {
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

  // 完成且有 lastIndexedAt：顯示「Xs ago」+ Sync now button
  if (status.lastIndexedAt == null) return null

  const handleSync = async () => {
    setSyncing(true)
    try {
      await triggerSync()
      dispatch({ type: 'ANNOUNCE', message: t('a11y.announcement.syncComplete') })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className={styles.indexerStatus}>
      <div className={styles.syncRow}>
        <span className={styles.indexerLabel}>
          {formatLastIndexed(status.lastIndexedAt, now, t)}
        </span>
        <button
          type="button"
          className={styles.syncButton}
          onClick={handleSync}
          disabled={syncing}
        >
          {t('sidebar.indexer.syncNow')}
        </button>
      </div>
    </div>
  )
}
