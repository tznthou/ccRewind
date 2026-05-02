import { useState, useEffect, memo } from 'react'
import type { UpdateState } from '../../../shared/types'
import { useI18n } from '../../i18n/useI18n'
import styles from './UpdateBanner.module.css'

export default memo(function UpdateBanner() {
  const { t } = useI18n()
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
        <span className={styles.versionText}>v{state.latestVersion}</span>{' '}
        {t('updateBanner.suffix')}
      </div>
      <div className={styles.actions}>
        <button className={styles.downloadBtn} onClick={handleDownload}>
          {t('updateBanner.download')}
        </button>
        <button className={styles.dismissBtn} onClick={handleDismiss}>
          {t('updateBanner.dismiss')}
        </button>
      </div>
    </div>
  )
})
