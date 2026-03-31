import type { SessionTokenStats } from '../../../shared/types'
import { formatTokens } from '../../utils/formatTokens'
import styles from './TokenBudget.module.css'

interface Props {
  stats: SessionTokenStats
}

export default function TokenSummaryCard({ stats }: Props) {
  const hitRate = (stats.cacheHitRate * 100).toFixed(1)

  return (
    <div className={styles.summaryGrid}>
      <div className={styles.summaryItem}>
        <span className={styles.summaryLabel}>Total Input</span>
        <span className={styles.summaryValue}>{formatTokens(stats.totalInputTokens)}</span>
      </div>
      <div className={styles.summaryItem}>
        <span className={styles.summaryLabel}>Total Output</span>
        <span className={styles.summaryValue}>{formatTokens(stats.totalOutputTokens)}</span>
      </div>
      <div className={styles.summaryItem}>
        <span className={styles.summaryLabel}>Cache Hit Rate</span>
        <span className={styles.summaryValue}>{hitRate}%</span>
      </div>
      <div className={styles.summaryItem}>
        <span className={styles.summaryLabel}>Model</span>
        <span className={styles.summaryValue} title={stats.models.join(', ')}>
          {stats.primaryModel ?? 'unknown'}
          {stats.models.length > 1 && <span className={styles.modelExtra}> +{stats.models.length - 1}</span>}
        </span>
      </div>
    </div>
  )
}
