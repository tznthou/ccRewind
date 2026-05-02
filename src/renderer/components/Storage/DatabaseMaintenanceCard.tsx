import { useState, useEffect, useCallback } from 'react'
import type { DatabaseMaintenanceStats, CompactResult } from '../../../shared/types'
import { useI18n } from '../../i18n/useI18n'
import { formatBytes } from '../../utils/formatBytes'
import styles from './Storage.module.css'

const MIN_RECLAIMABLE_TO_SHOW_BYTES = 10 * 1024 * 1024

interface Props {
  /** 父層刷新 Storage overview 的 callback（DB 大小變了要連動刷新） */
  onAfterCompact: () => void | Promise<void>
}

type Mode = 'idle' | 'confirming' | 'compacting' | 'done'

export default function DatabaseMaintenanceCard({ onAfterCompact }: Props) {
  const { t } = useI18n()
  const [stats, setStats] = useState<DatabaseMaintenanceStats | null>(null)
  const [mode, setMode] = useState<Mode>('idle')
  const [lastResult, setLastResult] = useState<CompactResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.getDatabaseStats()
      .then(data => { if (!cancelled) setStats(data) })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : t('common.errorLoading')) })
    return () => { cancelled = true }
  }, [t])

  const runCompact = useCallback(async () => {
    setMode('compacting')
    setError(null)
    try {
      const result = await window.api.compactDatabase()
      setLastResult(result)
      setMode('done')
      const freshStats = await window.api.getDatabaseStats()
      setStats(freshStats)
      await onAfterCompact()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errorCompact'))
      setMode('idle')
    }
  }, [onAfterCompact, t])

  if (!stats) {
    if (!error) return null
    return (
      <div className={styles.section}>
        <div className={styles.sectionTitle}>{t('storage.section.maintenance')}</div>
        <div className={styles.errorText}>{t('storage.maintenance.errorLoad', { message: error })}</div>
      </div>
    )
  }

  const hasSignificantReclaimable = stats.reclaimableBytes >= MIN_RECLAIMABLE_TO_SHOW_BYTES
  if (!hasSignificantReclaimable && mode === 'idle' && !lastResult) return null

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>{t('storage.section.maintenance')}</div>

      <div className={styles.maintenanceHint}>
        {t('storage.maintenance.hint')}
      </div>

      <div className={styles.overviewGrid}>
        <div className={styles.card}>
          <div className={styles.cardLabel}>{t('storage.maintenance.dbSize')}</div>
          <div className={styles.cardValue}>{formatBytes(stats.dbBytes)}</div>
          <div className={styles.cardSub}>{t('storage.maintenance.dbSizeHint')}</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>{t('storage.maintenance.reclaimable')}</div>
          <div className={styles.cardValue}>{formatBytes(stats.reclaimableBytes)}</div>
          <div className={styles.cardSub}>{t('storage.maintenance.reclaimableHint')}</div>
        </div>
      </div>

      {error && <div className={styles.errorText} style={{ marginTop: 12 }}>{error}</div>}

      {mode === 'idle' && hasSignificantReclaimable && (
        <div className={styles.maintenanceActions}>
          <button
            className={styles.button}
            onClick={() => setMode('confirming')}
          >
            {t('storage.maintenance.compact')}
          </button>
        </div>
      )}

      {mode === 'confirming' && (
        <div className={styles.maintenanceBanner}>
          <div>
            {t('storage.maintenance.confirmTextPrefix')}
            <strong>{formatBytes(stats.reclaimableBytes)}</strong>
            {t('storage.maintenance.confirmTextSuffix')}
          </div>
          <div className={styles.maintenanceDisclaimer}>
            {t('storage.maintenance.disclaimer')}
          </div>
          <div className={styles.dialogActions}>
            <button className={styles.button} onClick={() => setMode('idle')}>{t('common.cancel')}</button>
            <button className={styles.button} onClick={runCompact}>{t('storage.maintenance.confirmCompact')}</button>
          </div>
        </div>
      )}

      {mode === 'compacting' && (
        <div className={styles.maintenanceBanner}>
          <div>{t('storage.maintenance.compacting')}</div>
        </div>
      )}

      {mode === 'done' && lastResult && (
        <div className={styles.maintenanceBanner}>
          <div>
            {t('storage.maintenance.releasedPrefix')}
            <strong>{formatBytes(lastResult.releasedBytes)}</strong>
            {t('storage.maintenance.releasedDelta', {
              before: formatBytes(lastResult.bytesBefore),
              after: formatBytes(lastResult.bytesAfter),
            })}
          </div>
          <div className={styles.dialogActions}>
            <button className={styles.button} onClick={() => { setMode('idle'); setLastResult(null) }}>{t('common.close')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
