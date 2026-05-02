import type { ExclusionRule, ProjectBreakdown } from '../../../shared/types'
import { useI18n } from '../../i18n/useI18n'
import { lastSegment } from '../../utils/pathDisplay'
import { formatDateOnly } from '../../utils/formatTime'
import styles from './Storage.module.css'

interface Props {
  rules: ExclusionRule[]
  projects: ProjectBreakdown[]
  onRemove: (id: number) => void
}

export default function ExclusionRulesList({ rules, projects, onRemove }: Props) {
  const { t } = useI18n()

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
        <div key={rule.id} className={styles.ruleRow}>
          <div className={styles.ruleText}>{formatRule(rule)}</div>
          <div className={styles.ruleMeta}>{formatDateOnly(rule.createdAt)}</div>
          <button
            className={`${styles.button} ${styles.ghostButton}`}
            onClick={() => onRemove(rule.id)}
          >
            {t('common.remove')}
          </button>
        </div>
      ))}
    </div>
  )
}
