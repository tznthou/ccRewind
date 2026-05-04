import { useMemo } from 'react'
import { PieChart, Pie, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import type { DistributionItem } from '../../../shared/types'
import { CHART_TOOLTIP_STYLE } from '../TokenBudget/chartConstants'
import styles from './Dashboard.module.css'

interface Props {
  data: DistributionItem[]
  emptyText: string
  unitLabel: string
  ariaLabel: string
  colors?: string[]
}

const DEFAULT_COLORS = ['#3b82f6', '#0891b2', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#64748b']

export default function DistributionPieChart({ data, emptyText, unitLabel, ariaLabel, colors = DEFAULT_COLORS }: Props) {
  const chartData = useMemo(() =>
    data.slice(0, 8).map((d, i) => ({
      name: d.name,
      value: d.count,
      fill: colors[i % colors.length],
    })),
  [data, colors])

  if (chartData.length === 0) {
    return <div className={styles.empty}>{emptyText}</div>
  }

  return (
    <div role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height={230}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="45%"
            innerRadius={45}
            outerRadius={75}
            paddingAngle={2}
            dataKey="value"
          />
          <Tooltip
            formatter={(value) => [Number(value).toLocaleString(), unitLabel]}
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
