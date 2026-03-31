import { useMemo } from 'react'
import { PieChart, Pie, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import type { SessionTokenStats } from '../../../shared/types'
import { formatTokens } from '../../utils/formatTokens'
import styles from './TokenBudget.module.css'

interface Props {
  stats: SessionTokenStats
}

const COLORS = {
  cacheRead: '#67e8f9',
  cacheCreation: '#0891b2',
  newInput: '#0c4a6e',
  output: '#f59e0b',
} as const

export default function TokenBreakdown({ stats }: Props) {
  const data = useMemo(() => {
    const newInput = stats.totalInputTokens - stats.totalCacheReadTokens - stats.totalCacheCreationTokens
    return [
      { name: 'Cache Read', value: stats.totalCacheReadTokens, fill: COLORS.cacheRead },
      { name: 'Cache Creation', value: stats.totalCacheCreationTokens, fill: COLORS.cacheCreation },
      { name: 'New Input', value: Math.max(0, newInput), fill: COLORS.newInput },
      { name: 'Output', value: stats.totalOutputTokens, fill: COLORS.output },
    ].filter(d => d.value > 0)
  }, [stats])

  if (data.length === 0) return null

  return (
    <div className={styles.chartContainer}>
      <div className={styles.chartHeader}>
        <span className={styles.chartTitle}>Token Breakdown</span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
            dataKey="value"
          />

          <Tooltip
            formatter={(value) => formatTokens(Number(value))}
            contentStyle={{
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              fontSize: 12,
            }}
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
