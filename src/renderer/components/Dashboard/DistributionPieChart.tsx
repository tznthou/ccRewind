import { useId, useMemo } from 'react'
import { PieChart, Pie, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import type { DistributionItem } from '../../../shared/types'
import { useTheme } from '../../context/ThemeContext'
import { useI18n } from '../../i18n/useI18n'
import { CHART_SLICE_GAP, CHART_TOOLTIP_STYLE, CHART_TOOLTIP_ITEM_STYLE } from '../TokenBudget/chartConstants'
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

/** 黑板在每片旁邊寫名稱（黑板上光靠顏色認不出是哪片，裁決 21）；小於這個佔比的不寫，名稱才不會擠在一起（圖例與 tooltip 照樣有） */
const LABEL_MIN_SHARE = 0.04

export default function DistributionPieChart({ data, emptyText, unitLabel, ariaLabel, colors = DEFAULT_COLORS }: Props) {
  const { t } = useI18n()
  const { theme } = useTheme()
  const direct = theme === 'board'
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
        <ResponsiveContainer width="100%" height={direct ? 300 : 230}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy={direct ? '46%' : '45%'}
              innerRadius={45}
              outerRadius={75}
              paddingAngle={2}
              dataKey="value"
              stroke={CHART_SLICE_GAP}
              label={direct
                ? (p) => ((p.percent ?? 0) < LABEL_MIN_SHARE ? null : (
                    <text x={p.x} y={p.y} textAnchor={p.textAnchor} dominantBaseline="central" fill="var(--color-text)" fontSize={12}>
                      {p.name}
                    </text>
                  ))
                : false}
              labelLine={direct
                ? (p) => ((p.percent ?? 0) < LABEL_MIN_SHARE || !p.points ? <g /> : (
                    <path
                      d={`M${p.points[0].x},${p.points[0].y}L${p.points[1].x},${p.points[1].y}`}
                      fill="none"
                      stroke="var(--color-text-muted)"
                    />
                  ))
                : false}
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
