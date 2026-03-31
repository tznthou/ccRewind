import { useMemo } from 'react'
import type { SessionTokenStats } from '../../../shared/types'
import { formatTokens } from '../../utils/formatTokens'
import styles from './TokenBudget.module.css'

interface Props {
  turns: SessionTokenStats['turns']
}

const MAX_CELLS = 200

export default function CostHeatBar({ turns }: Props) {
  const { cells, maxOutput } = useMemo(() => {
    const max = turns.reduce((m, t) => Math.max(m, t.outputTokens), 0)
    const denom = max || 1

    // Bin turns when exceeding MAX_CELLS to limit DOM nodes
    const binSize = turns.length > MAX_CELLS ? Math.ceil(turns.length / MAX_CELLS) : 1
    const binned: typeof turns = []
    for (let i = 0; i < turns.length; i += binSize) {
      const slice = turns.slice(i, i + binSize)
      const best = slice.reduce((a, b) => a.outputTokens >= b.outputTokens ? a : b)
      binned.push(best)
    }

    return {
      cells: binned.map(t => ({
        sequence: t.sequence,
        output: t.outputTokens,
        intensity: t.outputTokens / denom,
        hasToolUse: t.hasToolUse,
        model: t.model,
      })),
      maxOutput: max,
    }
  }, [turns])

  if (cells.length === 0 || maxOutput === 0) return null

  return (
    <div className={styles.chartContainer}>
      <div className={styles.chartHeader}>
        <span className={styles.chartTitle}>Output Intensity</span>
        <span className={styles.chartSubtitle}>max: {formatTokens(maxOutput)}</span>
      </div>
      <div className={styles.heatBar}>
        {cells.map(cell => (
          <div
            key={cell.sequence}
            className={styles.heatCell}
            style={{
              backgroundColor: `rgba(245, 158, 11, ${0.1 + cell.intensity * 0.9})`,
            }}
            title={`Turn ${cell.sequence}: ${formatTokens(cell.output)} output${cell.hasToolUse ? ' (tool use)' : ''}${cell.model ? ` · ${cell.model}` : ''}`}
          />
        ))}
      </div>
    </div>
  )
}
