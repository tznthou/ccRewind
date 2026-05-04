import type { SessionTokenStats } from '../../../shared/types'
import { formatTokens } from '../../utils/formatTokens'
import { useI18n } from '../../i18n/useI18n'
import styles from './TokenBudget.module.css'

interface Props {
  stats: SessionTokenStats
}

export default function TokenSummaryCard({ stats }: Props) {
  const { t } = useI18n()
  const hitRate = (stats.cacheHitRate * 100).toFixed(1)

  return (
    <div className={styles.summaryGrid}>
      <div className={styles.summaryItem}>
        <span className={styles.summaryLabel}>{t('tokenBudget.summary.totalInput')}</span>
        <span className={styles.summaryValue}>{formatTokens(stats.totalInputTokens)}</span>
      </div>
      <div className={styles.summaryItem}>
        <span className={styles.summaryLabel}>{t('tokenBudget.summary.totalOutput')}</span>
        <span className={styles.summaryValue}>{formatTokens(stats.totalOutputTokens)}</span>
      </div>
      <div className={styles.summaryItem}>
        <span className={styles.summaryLabel}>{t('tokenBudget.summary.cacheHitRate')}</span>
        <span className={styles.summaryValue}>{hitRate}%</span>
      </div>
      <div className={styles.summaryItem}>
        <span className={styles.summaryLabel}>{t('tokenBudget.summary.model')}</span>
        <span className={styles.summaryValue} title={stats.models.join(', ')}>
          {stats.primaryModel ?? t('tokenBudget.summary.modelUnknown')}
          {stats.models.length > 1 && <span className={styles.modelExtra}> +{stats.models.length - 1}</span>}
        </span>
      </div>
    </div>
  )
}
