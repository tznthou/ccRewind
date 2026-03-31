import { useMemo } from 'react'
import { PieChart, Pie, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import type { DistributionItem } from '../../../shared/types'
import { CHART_TOOLTIP_STYLE } from '../TokenBudget/chartConstants'
import styles from './Dashboard.module.css'

interface Props {
  data: DistributionItem[]
}

const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#0891b2', '#64748b']

export default function TagDistribution({ data }: Props) {
  const chartData = useMemo(() =>
    data.slice(0, 8).map((d, i) => ({
      name: d.name,
      value: d.count,
      fill: COLORS[i % COLORS.length],
    })),
  [data])

  if (chartData.length === 0) {
    return <div className={styles.empty}>No tag data</div>
  }

  return (
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
          formatter={(value: number) => [value.toLocaleString(), 'sessions']}
          contentStyle={CHART_TOOLTIP_STYLE}
        />
        <Legend
          formatter={(value) => <span className={styles.legendText}>{value}</span>}
          iconSize={10}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
