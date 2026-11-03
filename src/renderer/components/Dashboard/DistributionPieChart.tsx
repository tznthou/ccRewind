import { useId, useMemo } from 'react'
import { PieChart, Pie, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import type { DistributionItem } from '../../../shared/types'
import { useI18n } from '../../i18n/useI18n'
import { CHART_TOOLTIP_STYLE, CHART_TOOLTIP_ITEM_STYLE } from '../TokenBudget/chartConstants'
import { formatDistributionTooltip } from './distributionTooltip'
import styles from './Dashboard.module.css'

interface Props {
  data: DistributionItem[]
  emptyText: string
  unitLabel: string
  ariaLabel: string
  colors?: string[]
}

const DEFAULT_COLORS = [
  'var(--chart-cat-1)',
  'var(--chart-cat-2)',
  'var(--chart-cat-3)',
  'var(--chart-cat-4)',
  'var(--chart-cat-5)',
  'var(--chart-cat-6)',
  'var(--chart-cat-7)',
  'var(--chart-cat-8)',
]

export default function DistributionPieChart({ data, emptyText, unitLabel, ariaLabel, colors = DEFAULT_COLORS }: Props) {
  const { t } = useI18n()
  const descId = useId()
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
    <div>
      <div role="img" aria-label={ariaLabel} aria-describedby={descId}>
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
              formatter={(value, name) => formatDistributionTooltip(value, name, unitLabel)}
              contentStyle={CHART_TOOLTIP_STYLE}
              itemStyle={CHART_TOOLTIP_ITEM_STYLE}
            />
            <Legend
              formatter={(value) => <span className={styles.legendText}>{value}</span>}
              iconSize={10}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul id={descId} className={styles.visuallyHidden}>
        {chartData.map(d => (
          <li key={d.name}>
            {t('dashboard.aria.distributionItem', {
              name: d.name,
              value: d.value.toLocaleString(),
              unit: unitLabel,
            })}
          </li>
        ))}
      </ul>
    </div>
  )
}
