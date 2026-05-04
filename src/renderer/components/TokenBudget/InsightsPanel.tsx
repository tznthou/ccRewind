import { useState } from 'react'
import { useI18n } from '../../i18n/useI18n'
import type { Insight, InsightSeverity } from './insightEngine'
import { mapInsightToMessages } from './insightMessages'
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
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)

  if (insights.length === 0) return null

  const visible = expanded ? insights : insights.slice(0, MAX_VISIBLE)
  const hasMore = insights.length > MAX_VISIBLE

  return (
    <div className={styles.insightsPanel}>
      <div className={styles.insightsHeader}>{t('tokenBudget.insights.title')}</div>
      <ul className={styles.insightsList}>
        {visible.map(insight => {
          const rendered = mapInsightToMessages(insight)
          return (
            <li
              key={insight.id}
              className={`${styles.insightItem} ${SEVERITY_CLASS[insight.severity]}`}
            >
              <span className={styles.insightIcon}>{insight.icon}</span>
              <div className={styles.insightBody}>
                <span className={styles.insightTitle}>{t(rendered.titleKey, rendered.titleParams)}</span>
                {rendered.detailKey && (
                  <span className={styles.insightDetail}>{t(rendered.detailKey, rendered.detailParams)}</span>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {hasMore && !expanded && (
        <button
          className={styles.insightsExpand}
          onClick={() => setExpanded(true)}
        >
          {t('tokenBudget.insights.showMore', { count: insights.length - MAX_VISIBLE })}
        </button>
      )}
    </div>
  )
}
