import { useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import type { DailyUsage } from '../../../shared/types'
import { formatTokens } from '../../utils/formatTokens'
import { CHART_TOOLTIP_STYLE } from '../TokenBudget/chartConstants'
import styles from './Dashboard.module.css'

interface Props {
  data: DailyUsage[]
}

export default function UsageTrendChart({ data }: Props) {
  const chartData = useMemo(() =>
    data.map(d => ({
      ...d,
      // 短日期標籤
      label: d.date.slice(5), // MM-DD
    })),
  [data])

  if (data.length === 0) {
    return <div className={styles.empty}>No data for selected range</div>
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
          yAxisId="sessions"
          tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
          width={36}
        />
        <YAxis
          yAxisId="tokens"
          orientation="right"
          tickFormatter={formatTokens}
          tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
          width={52}
        />
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          formatter={(value: number, name: string) =>
            name === 'totalTokens' ? [formatTokens(value), 'Tokens'] : [value, 'Sessions']
          }
          labelFormatter={(label) => `Date: ${label}`}
        />
        <Area
          yAxisId="sessions"
          type="monotone"
          dataKey="sessionCount"
          stroke="#3b82f6"
          fill="#3b82f6"
          fillOpacity={0.15}
          name="sessionCount"
        />
        <Area
          yAxisId="tokens"
          type="monotone"
          dataKey="totalTokens"
          stroke="#f59e0b"
          fill="#f59e0b"
          fillOpacity={0.1}
          name="totalTokens"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
