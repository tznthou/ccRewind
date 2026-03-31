import { useState } from 'react'
import type { Insight, InsightSeverity } from './insightEngine'
import styles from './TokenBudget.module.css'

const MAX_VISIBLE = 3

const SEVERITY_CLASS: Record<InsightSeverity, string> = {
  critical: styles.insightCritical,
  warning: styles.insightWarning,
  info: styles.insightInfo,
  good: styles.insightGood,
}

interface Props {
  insights: Insight[]
}

export default function InsightsPanel({ insights }: Props) {
  const [expanded, setExpanded] = useState(false)

  if (insights.length === 0) return null

  const visible = expanded ? insights : insights.slice(0, MAX_VISIBLE)
  const hasMore = insights.length > MAX_VISIBLE

  return (
    <div className={styles.insightsPanel}>
      <div className={styles.insightsHeader}>Insights</div>
      <ul className={styles.insightsList}>
        {visible.map(insight => (
          <li
            key={insight.id}
            className={`${styles.insightItem} ${SEVERITY_CLASS[insight.severity]}`}
          >
            <span className={styles.insightIcon}>{insight.icon}</span>
            <div className={styles.insightBody}>
              <span className={styles.insightTitle}>{insight.title}</span>
              {insight.detail && (
                <span className={styles.insightDetail}>{insight.detail}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {hasMore && !expanded && (
        <button
          className={styles.insightsExpand}
          onClick={() => setExpanded(true)}
        >
          Show {insights.length - MAX_VISIBLE} more...
        </button>
      )}
    </div>
  )
}
