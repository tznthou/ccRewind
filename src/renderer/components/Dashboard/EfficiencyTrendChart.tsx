import { useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import type { DailyEfficiency } from '../../../shared/types'
import { formatTokens } from '../../utils/formatTokens'
import { CHART_TOOLTIP_STYLE } from '../TokenBudget/chartConstants'
import styles from './Dashboard.module.css'

interface Props {
  data: DailyEfficiency[]
}

export default function EfficiencyTrendChart({ data }: Props) {
  const chartData = useMemo(() =>
    data.map(d => ({
      ...d,
      label: d.date.slice(5), // MM-DD
    })),
  [data])

  if (data.length === 0) {
    return <div className={styles.empty}>No efficiency data</div>
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
          interval="preserveStartEnd"
        />
        <YAxis
          tickFormatter={formatTokens}
          tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
          width={52}
        />
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          formatter={(value, name) => {
            const num = Number(value)
            return name === 'avgTokensPerTurn'
              ? [formatTokens(num), 'Tokens/Turn']
              : [num, 'Sessions']
          }}
          labelFormatter={(label) => `Date: ${label}`}
        />
        <Area
          type="monotone"
          dataKey="avgTokensPerTurn"
          stroke="#10b981"
          fill="#10b981"
          fillOpacity={0.15}
          name="avgTokensPerTurn"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
