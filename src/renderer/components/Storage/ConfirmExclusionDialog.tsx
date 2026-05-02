import { useState } from 'react'
import type { ExclusionPreview } from '../../../shared/types'
import { useI18n } from '../../i18n/useI18n'
import ExclusionPreviewSummary from './ExclusionPreviewSummary'
import styles from './Storage.module.css'

interface Props {
  title: string
  preview: ExclusionPreview
  totalSessions: number
  isApplying?: boolean
  onConfirm: () => void
  onCancel: () => void
}

const HIGH_IMPACT_RATIO = 0.5

export default function ConfirmExclusionDialog({ title, preview, totalSessions, isApplying, onConfirm, onCancel }: Props) {
  const { t } = useI18n()
  const [acknowledged, setAcknowledged] = useState(false)
  const impactRatio = totalSessions > 0 ? preview.sessionCount / totalSessions : 0
  const highImpact = impactRatio > HIGH_IMPACT_RATIO

  return (
    <div className={styles.backdrop} onClick={() => { if (!isApplying) onCancel() }}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()}>
        <div className={styles.dialogTitle}>{title}</div>
        <div className={styles.dialogSummary}>
          <ExclusionPreviewSummary preview={preview} />
          {totalSessions > 0 && (
            <span>{t('storage.confirm.impactRatio', { percent: (impactRatio * 100).toFixed(1) })}</span>
          )}
        </div>

        {highImpact && (
          <div className={styles.warningBanner}>
            {t('storage.confirm.warningHighImpact')}
          </div>
        )}

        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={acknowledged}
            disabled={isApplying}
            onChange={e => setAcknowledged(e.target.checked)}
          />
          {t('storage.confirm.acknowledge')}
        </label>

        <div className={styles.dialogActions}>
          <button className={styles.button} onClick={onCancel} disabled={isApplying}>{t('common.cancel')}</button>
          <button
            className={`${styles.button} ${styles.dangerButton}`}
            disabled={!acknowledged || isApplying}
            onClick={onConfirm}
          >
            {isApplying ? t('storage.confirm.deleting') : t('storage.confirm.deleteAction')}
          </button>
        </div>
      </div>
    </div>
  )
}
