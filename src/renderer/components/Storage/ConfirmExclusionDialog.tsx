import { useState } from 'react'
import type { ExclusionPreview } from '../../../shared/types'
import { formatBytes } from '../../utils/formatBytes'
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
  const [acknowledged, setAcknowledged] = useState(false)
  const impactRatio = totalSessions > 0 ? preview.sessionCount / totalSessions : 0
  const highImpact = impactRatio > HIGH_IMPACT_RATIO

  return (
    <div className={styles.backdrop} onClick={() => { if (!isApplying) onCancel() }}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()}>
        <div className={styles.dialogTitle}>{title}</div>
        <div className={styles.dialogSummary}>
          將刪除 <strong>{preview.sessionCount}</strong> 個 session · <strong>{preview.messageCount.toLocaleString()}</strong> 條訊息 · 約 <strong>{formatBytes(preview.estimatedBytes)}</strong>
          {totalSessions > 0 && (
            <span>（佔全部 {(impactRatio * 100).toFixed(1)}%）</span>
          )}
        </div>

        {highImpact && (
          <div className={styles.warningBanner}>
            ⚠️ 此操作將刪除超過一半的資料。請再次確認。
          </div>
        )}

        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={acknowledged}
            disabled={isApplying}
            onChange={e => setAcknowledged(e.target.checked)}
          />
          我了解此操作不可復原
        </label>

        <div className={styles.dialogActions}>
          <button className={styles.button} onClick={onCancel} disabled={isApplying}>取消</button>
          <button
            className={`${styles.button} ${styles.dangerButton}`}
            disabled={!acknowledged || isApplying}
            onClick={onConfirm}
          >
            {isApplying ? '刪除中...' : '確認刪除'}
          </button>
        </div>
      </div>
    </div>
  )
}
