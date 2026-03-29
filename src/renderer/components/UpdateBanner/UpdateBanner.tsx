import { useState, useEffect, memo } from 'react'
import type { UpdateState } from '../../../shared/types'
import styles from './UpdateBanner.module.css'

export default memo(function UpdateBanner() {
  const [state, setState] = useState<UpdateState | null>(null)

  useEffect(() => {
    let ignore = false
    window.api.checkForUpdates()
      .then((s) => { if (!ignore) setState(s) })
      .catch((err) => console.warn('Update check failed:', err))
    return () => { ignore = true }
  }, [])

  if (!state || state.status !== 'available') return null

  const handleDownload = () => {
    window.api.openReleasePage().catch(() => {})
  }

  const handleDismiss = () => {
    if (state.latestVersion) {
      window.api.dismissUpdate(state.latestVersion)
      setState((prev) => prev ? { ...prev, status: 'dismissed' } : prev)
    }
  }

  return (
    <div className={styles.banner} role="status">
      <div className={styles.info}>
        <span className={styles.versionText}>v{state.latestVersion}</span> 可供更新
      </div>
      <div className={styles.actions}>
        <button className={styles.downloadBtn} onClick={handleDownload}>
          下載
        </button>
        <button className={styles.dismissBtn} onClick={handleDismiss}>
          略過
        </button>
      </div>
    </div>
  )
})
