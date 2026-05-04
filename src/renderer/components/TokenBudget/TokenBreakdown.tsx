import { useMemo } from 'react'
import { PieChart, Pie, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import type { SessionTokenStats } from '../../../shared/types'
import { formatTokens } from '../../utils/formatTokens'
import { useI18n } from '../../i18n/useI18n'
import { TOKEN_COLORS, CHART_TOOLTIP_STYLE } from './chartConstants'
import styles from './TokenBudget.module.css'

interface Props {
  stats: SessionTokenStats
}

export default function TokenBreakdown({ stats }: Props) {
  const { t } = useI18n()
  const data = useMemo(() => {
    const newInput = stats.totalInputTokens - stats.totalCacheReadTokens - stats.totalCacheCreationTokens
    return [
      { name: t('tokenBudget.series.cacheRead'), value: stats.totalCacheReadTokens, fill: TOKEN_COLORS.cacheRead },
      { name: t('tokenBudget.series.cacheCreation'), value: stats.totalCacheCreationTokens, fill: TOKEN_COLORS.cacheCreation },
      { name: t('tokenBudget.series.newInput'), value: Math.max(0, newInput), fill: TOKEN_COLORS.newInput },
      { name: t('tokenBudget.series.output'), value: stats.totalOutputTokens, fill: TOKEN_COLORS.output },
    ].filter(d => d.value > 0)
  }, [stats, t])

  if (data.length === 0) return null

  return (
    <div className={styles.chartContainer}>
      <div className={styles.chartHeader}>
        <span className={styles.chartTitle}>{t('tokenBudget.breakdown.title')}</span>
      </div>
      <ResponsiveContainer width="100%" height={230}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="45%"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
            dataKey="value"
          />

          <Tooltip
            formatter={(value) => formatTokens(Number(value))}
            contentStyle={CHART_TOOLTIP_STYLE}
          />
          <Legend
            formatter={(value) => <span className={styles.legendText}>{value}</span>}
            iconSize={10}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
