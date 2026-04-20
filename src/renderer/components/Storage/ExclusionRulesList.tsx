import type { ExclusionRule, ProjectBreakdown } from '../../../shared/types'
import { lastSegment } from '../../utils/pathDisplay'
import { formatDateOnly } from '../../utils/formatTime'
import styles from './Storage.module.css'

interface Props {
  rules: ExclusionRule[]
  projects: ProjectBreakdown[]
  onRemove: (id: number) => void
}

function formatRule(rule: ExclusionRule, projects: ProjectBreakdown[]): string {
  const parts: string[] = []
  if (rule.projectId != null) {
    const p = projects.find(x => x.projectId === rule.projectId)
    parts.push(`專案: ${p ? lastSegment(p.displayName) : rule.projectId}`)
  }
  if (rule.dateFrom != null && rule.dateTo != null) {
    parts.push(`日期: ${rule.dateFrom} → ${rule.dateTo}`)
  } else if (rule.dateFrom != null) {
    parts.push(`日期: ≥ ${rule.dateFrom}`)
  } else if (rule.dateTo != null) {
    parts.push(`日期: ≤ ${rule.dateTo}`)
  }
  return parts.join('  ·  ') || '(空規則)'
}

export default function ExclusionRulesList({ rules, projects, onRemove }: Props) {
  if (rules.length === 0) {
    return <div className={styles.empty}>尚無排除規則</div>
  }

  return (
    <div className={styles.rulesList}>
      {rules.map(rule => (
        <div key={rule.id} className={styles.ruleRow}>
          <div className={styles.ruleText}>{formatRule(rule, projects)}</div>
          <div className={styles.ruleMeta}>{formatDateOnly(rule.createdAt)}</div>
          <button
            className={`${styles.button} ${styles.ghostButton}`}
            onClick={() => onRemove(rule.id)}
          >
            移除
          </button>
        </div>
      ))}
    </div>
  )
}
