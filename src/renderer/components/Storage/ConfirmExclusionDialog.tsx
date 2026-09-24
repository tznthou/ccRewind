import { useState } from 'react'
import type { ExclusionMode, ExclusionPreview } from '../../../shared/types'
import { useI18n } from '../../i18n/useI18n'
import ExclusionPreviewSummary from './ExclusionPreviewSummary'
import { DEFAULT_EXCLUSION_MODE, exclusionDialogView } from './exclusionDialog'
import styles from './Storage.module.css'

interface Props {
  title: string
  preview: ExclusionPreview
  totalSessions: number
  isApplying?: boolean
  onConfirm: (mode: ExclusionMode) => void
  onCancel: () => void
}

export default function ConfirmExclusionDialog({ title, preview, totalSessions, isApplying, onConfirm, onCancel }: Props) {
  const { t } = useI18n()
  const [selected, setSelected] = useState<ExclusionMode>(DEFAULT_EXCLUSION_MODE)
  const [acknowledged, setAcknowledged] = useState(false)
  const view = exclusionDialogView(preview, totalSessions, selected)
  const isDelete = view.mode === 'delete'

  // 換選項時清掉勾選：「我了解不可復原」是對這一次刪除的確認，不能沿用到下一次選擇
  const choose = (mode: ExclusionMode) => {
    setSelected(mode)
    setAcknowledged(false)
  }

  return (
    <div className={styles.backdrop} onClick={() => { if (!isApplying) onCancel() }}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()}>
        <div className={styles.dialogTitle}>{title}</div>

        <fieldset className={styles.modeGroup} disabled={isApplying}>
          <legend className={styles.modeLegend}>{t('storage.confirm.mode.label')}</legend>
          <label className={styles.modeOption}>
            <input
              type="radio"
              name="exclusion-mode"
              checked={view.mode === 'rule-only'}
              onChange={() => choose('rule-only')}
            />
            <span>
              <span className={styles.modeTitle}>{t('storage.confirm.mode.ruleOnly')}</span>
              <span className={styles.modeHint}>{t('storage.confirm.mode.ruleOnlyHint')}</span>
            </span>
          </label>
          <label className={view.canDelete ? styles.modeOption : `${styles.modeOption} ${styles.modeOptionDisabled}`}>
            <input
              type="radio"
              name="exclusion-mode"
              checked={isDelete}
              disabled={!view.canDelete}
              onChange={() => choose('delete')}
            />
            <span>
              <span className={styles.modeTitle}>{t('storage.confirm.mode.delete')}</span>
              <span className={styles.modeHint}>
                {view.canDelete ? t('storage.confirm.mode.deleteHint') : t('storage.confirm.mode.deleteUnavailable')}
              </span>
            </span>
          </label>
        </fieldset>

        <div className={styles.dialogSummary}>
          {!view.canDelete
            ? <span>{t('storage.confirm.noMatchHint')}</span>
            : isDelete
              ? <>
                  <ExclusionPreviewSummary preview={preview} verb="delete" />
                  {view.showImpactRatio && (
                    <span>{t('storage.confirm.impactRatio', { percent: (view.impactRatio * 100).toFixed(1) })}</span>
                  )}
                </>
              : <span>{t('storage.confirm.keepSummary', { count: preview.sessionCount })}</span>
          }
        </div>

        {view.highImpact && (
          <div className={styles.warningBanner}>
            {t('storage.confirm.warningHighImpact')}
          </div>
        )}

        {view.needsAcknowledge && (
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={isApplying}
              onChange={e => setAcknowledged(e.target.checked)}
            />
            {t('storage.confirm.acknowledge')}
          </label>
        )}

        <div className={styles.dialogActions}>
          <button className={styles.button} onClick={onCancel} disabled={isApplying}>{t('common.cancel')}</button>
          <button
            className={isDelete ? `${styles.button} ${styles.dangerButton}` : styles.button}
            disabled={(view.needsAcknowledge && !acknowledged) || isApplying}
            onClick={() => onConfirm(view.mode)}
          >
            {isApplying
              ? isDelete ? t('storage.confirm.deleting') : t('storage.confirm.creatingRule')
              : isDelete ? t('storage.confirm.deleteAction') : t('storage.confirm.createRuleAction')}
          </button>
        </div>
      </div>
    </div>
  )
}
