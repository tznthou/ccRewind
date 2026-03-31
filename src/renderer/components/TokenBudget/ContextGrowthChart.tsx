import { useMemo, useState } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import type { SessionTokenStats } from '../../../shared/types'
import { formatTokens } from '../../utils/formatTokens'
import styles from './TokenBudget.module.css'

interface Props {
  turns: SessionTokenStats['turns']
}

const CONTEXT_LIMITS = [
  { label: '200K', value: 200_000 },
  { label: '1M', value: 1_000_000 },
] as const

export default function ContextGrowthChart({ turns }: Props) {
  const [limitIdx, setLimitIdx] = useState(0)
  const limit = CONTEXT_LIMITS[limitIdx]

  const data = useMemo(() => turns.map(t => ({
    turn: t.sequence,
    newInput: t.inputTokens - t.cacheReadTokens - t.cacheCreationTokens,
    cacheCreation: t.cacheCreationTokens,
    cacheRead: t.cacheReadTokens,
    toolNames: t.toolNames,
  })), [turns])

  const disableAnimation = turns.length > 100

  return (
    <div className={styles.chartContainer}>
      <div className={styles.chartHeader}>
        <span className={styles.chartTitle}>Context Growth</span>
        <div className={styles.limitToggle}>
          {CONTEXT_LIMITS.map((l, i) => (
            <button
              key={l.label}
              className={`${styles.limitButton} ${i === limitIdx ? styles.limitActive : ''}`}
              onClick={() => setLimitIdx(i)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.5} />
          <XAxis
            dataKey="turn"
            tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={formatTokens}
            tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip
            formatter={(value) => formatTokens(Number(value))}
            labelFormatter={(label) => `Turn ${label}`}
            contentStyle={{
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              fontSize: 12,
            }}
          />
          <ReferenceLine
            y={limit.value}
            stroke="var(--color-error)"
            strokeDasharray="6 4"
            label={{ value: limit.label, position: 'right', fill: 'var(--color-error)', fontSize: 11 }}
          />
          <Area
            type="monotone"
            dataKey="newInput"
            stackId="ctx"
            stroke="#0c4a6e"
            fill="#0c4a6e"
            name="New Input"
            isAnimationActive={!disableAnimation}
          />
          <Area
            type="monotone"
            dataKey="cacheCreation"
            stackId="ctx"
            stroke="#0891b2"
            fill="#0891b2"
            name="Cache Creation"
            isAnimationActive={!disableAnimation}
          />
          <Area
            type="monotone"
            dataKey="cacheRead"
            stackId="ctx"
            stroke="#67e8f9"
            fill="#67e8f9"
            fillOpacity={0.6}
            name="Cache Read"
            isAnimationActive={!disableAnimation}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
