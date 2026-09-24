import { Fragment, useState } from 'react'
import type { ExclusionRule, ProjectBreakdown } from '../../../shared/types'
import { useI18n } from '../../i18n/useI18n'
import { lastSegment } from '../../utils/pathDisplay'
import { formatDateOnly } from '../../utils/formatTime'
import { removalNeedsConfirm } from './exclusionDialog'
import styles from './Storage.module.css'

interface Props {
  rules: ExclusionRule[]
  projects: ProjectBreakdown[]
  onRemove: (id: number) => void
}

export default function ExclusionRulesList({ rules, projects, onRemove }: Props) {
  const { t } = useI18n()
  // 正在確認移除的 delete 規則（一次只展開一條）
  const [confirmingId, setConfirmingId] = useState<number | null>(null)

  function formatRule(rule: ExclusionRule): string {
    const parts: string[] = []
    if (rule.projectId != null) {
      const p = projects.find(x => x.projectId === rule.projectId)
      parts.push(t('storage.rules.format.project', { name: p ? lastSegment(p.displayName) : rule.projectId }))
    }
    if (rule.dateFrom != null && rule.dateTo != null) {
      parts.push(t('storage.rules.format.dateRange', { from: rule.dateFrom, to: rule.dateTo }))
    } else if (rule.dateFrom != null) {
      parts.push(t('storage.rules.format.dateFrom', { from: rule.dateFrom }))
    } else if (rule.dateTo != null) {
      parts.push(t('storage.rules.format.dateTo', { to: rule.dateTo }))
    }
    return parts.join('  ·  ') || t('storage.rules.format.empty')
  }

  if (rules.length === 0) {
    return <div className={styles.empty}>{t('storage.rules.empty')}</div>
  }

  return (
    <div className={styles.rulesList}>
      {rules.map(rule => (
        <Fragment key={rule.id}>
          <div className={styles.ruleRow}>
            <div className={styles.ruleText}>{formatRule(rule)}</div>
            <span className={rule.mode === 'delete' ? `${styles.ruleBadge} ${styles.ruleBadgeDelete}` : styles.ruleBadge}>
              {rule.mode === 'delete' ? t('storage.rules.mode.delete') : t('storage.rules.mode.ruleOnly')}
            </span>
            <div className={styles.ruleMeta}>{formatDateOnly(rule.createdAt)}</div>
            <button
              className={`${styles.button} ${styles.ghostButton}`}
              onClick={() => { if (removalNeedsConfirm(rule)) setConfirmingId(rule.id); else onRemove(rule.id) }}
            >
              {t('common.remove')}
            </button>
          </div>
          {confirmingId === rule.id && (
            <div className={styles.removeConfirm}>
              <span>{t('storage.rules.removeConfirm')}</span>
              <div className={styles.removeConfirmActions}>
                <button className={styles.button} onClick={() => setConfirmingId(null)}>{t('common.cancel')}</button>
                <button
                  className={styles.button}
                  onClick={() => { setConfirmingId(null); onRemove(rule.id) }}
                >
                  {t('storage.rules.removeConfirmAction')}
                </button>
              </div>
            </div>
          )}
        </Fragment>
      ))}
    </div>
  )
}
