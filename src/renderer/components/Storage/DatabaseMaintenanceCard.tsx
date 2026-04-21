import { useState, useEffect, useCallback } from 'react'
import type { DatabaseMaintenanceStats, CompactResult } from '../../../shared/types'
import { formatBytes } from '../../utils/formatBytes'
import styles from './Storage.module.css'

const MIN_RECLAIMABLE_TO_SHOW_BYTES = 10 * 1024 * 1024

interface Props {
  /** 父層刷新 Storage overview 的 callback（DB 大小變了要連動刷新） */
  onAfterCompact: () => void | Promise<void>
}

type Mode = 'idle' | 'confirming' | 'compacting' | 'done'

export default function DatabaseMaintenanceCard({ onAfterCompact }: Props) {
  const [stats, setStats] = useState<DatabaseMaintenanceStats | null>(null)
  const [mode, setMode] = useState<Mode>('idle')
  const [lastResult, setLastResult] = useState<CompactResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.getDatabaseStats()
      .then(data => { if (!cancelled) setStats(data) })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : '載入失敗') })
    return () => { cancelled = true }
  }, [])

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
      setError(err instanceof Error ? err.message : '壓縮失敗')
      setMode('idle')
    }
  }, [onAfterCompact])

  if (!stats) {
    // stats 載入失敗時仍顯示錯誤 banner，避免 IPC 掛掉後 UI 靜默消失
    if (!error) return null
    return (
      <div className={styles.section}>
        <div className={styles.sectionTitle}>資料庫維護</div>
        <div className={styles.errorText}>無法載入維護資訊：{error}</div>
      </div>
    )
  }

  // 平常隱藏；有可回收空間或剛壓縮完才顯示
  const hasSignificantReclaimable = stats.reclaimableBytes >= MIN_RECLAIMABLE_TO_SHOW_BYTES
  if (!hasSignificantReclaimable && mode === 'idle' && !lastResult) return null

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>資料庫維護</div>

      <div className={styles.maintenanceHint}>
        「可回收空間」是資料庫內已刪除資料（例如排除規則清掉的 session）留下的空白頁。
        壓縮只整理檔案結構，<strong>不會影響任何對話、session 或 message</strong>。
      </div>

      <div className={styles.overviewGrid}>
        <div className={styles.card}>
          <div className={styles.cardLabel}>DB 大小</div>
          <div className={styles.cardValue}>{formatBytes(stats.dbBytes)}</div>
          <div className={styles.cardSub}>含 WAL / SHM</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>可回收空間</div>
          <div className={styles.cardValue}>{formatBytes(stats.reclaimableBytes)}</div>
          <div className={styles.cardSub}>已刪除資料留下的空檔</div>
        </div>
      </div>

      {error && <div className={styles.errorText} style={{ marginTop: 12 }}>{error}</div>}

      {mode === 'idle' && hasSignificantReclaimable && (
        <div className={styles.maintenanceActions}>
          <button
            className={styles.button}
            onClick={() => setMode('confirming')}
          >
            壓縮資料庫
          </button>
        </div>
      )}

      {mode === 'confirming' && (
        <div className={styles.maintenanceBanner}>
          <div>
            將執行 VACUUM，預計釋放 <strong>{formatBytes(stats.reclaimableBytes)}</strong>。
            壓縮期間 app 會暫停回應約 10 至 30 秒（視資料量而定），請勿關閉視窗。
          </div>
          <div className={styles.maintenanceDisclaimer}>
            僅整理資料庫檔案結構，不會刪除任何對話或訊息。
          </div>
          <div className={styles.dialogActions}>
            <button className={styles.button} onClick={() => setMode('idle')}>取消</button>
            <button className={styles.button} onClick={runCompact}>確認壓縮</button>
          </div>
        </div>
      )}

      {mode === 'compacting' && (
        <div className={styles.maintenanceBanner}>
          <div>壓縮中，請勿關閉 app...</div>
        </div>
      )}

      {mode === 'done' && lastResult && (
        <div className={styles.maintenanceBanner}>
          <div>
            已釋放 <strong>{formatBytes(lastResult.releasedBytes)}</strong>
            （{formatBytes(lastResult.bytesBefore)} → {formatBytes(lastResult.bytesAfter)}）
          </div>
          <div className={styles.dialogActions}>
            <button className={styles.button} onClick={() => { setMode('idle'); setLastResult(null) }}>關閉</button>
          </div>
        </div>
      )}
    </div>
  )
}
