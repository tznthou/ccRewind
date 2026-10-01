import { useMemo } from 'react'
import type { SessionTokenStats } from '../../../shared/types'
import { formatTokens } from '../../utils/formatTokens'
import { useI18n } from '../../i18n/useI18n'
import styles from './TokenBudget.module.css'

interface Props {
  turns: SessionTokenStats['turns']
}

const MAX_CELLS = 200

export default function CostHeatBar({ turns }: Props) {
  const { t } = useI18n()
  const { cells, maxOutput } = useMemo(() => {
    const max = turns.reduce((m, turn) => Math.max(m, turn.outputTokens), 0)
    const denom = max || 1

    // Bin turns when exceeding MAX_CELLS to limit DOM nodes; each bin shows its biggest output (first on ties)
    const binSize = turns.length > MAX_CELLS ? Math.ceil(turns.length / MAX_CELLS) : 1
    const bestIndexes: number[] = []
    for (let start = 0; start < turns.length; start += binSize) {
      const end = Math.min(start + binSize, turns.length)
      let best = start
      for (let i = start + 1; i < end; i++) {
        if (turns[i].outputTokens > turns[best].outputTokens) best = i
      }
      bestIndexes.push(best)
    }

    return {
      cells: bestIndexes.map(i => ({
        // 第幾次呼叫（不是 JSONL 的 sequence），照分箱前的位置算才跟圖表對得上
        turn: i + 1,
        output: turns[i].outputTokens,
        intensity: turns[i].outputTokens / denom,
        hasToolUse: turns[i].hasToolUse,
        model: turns[i].model,
      })),
      maxOutput: max,
    }
  }, [turns])

  if (cells.length === 0 || maxOutput === 0) return null

  return (
    <div className={styles.chartContainer}>
      <div className={styles.chartHeader}>
        <span className={styles.chartTitle}>{t('tokenBudget.intensity.title')}</span>
        <span className={styles.chartSubtitle}>{t('tokenBudget.intensity.max', { value: formatTokens(maxOutput) })}</span>
      </div>
      <div className={styles.heatBar}>
        {cells.map(cell => {
          const base = t('tokenBudget.intensity.cellTitle', {
            turn: cell.turn,
            tokens: formatTokens(cell.output),
          })
          const toolSuffix = cell.hasToolUse ? t('tokenBudget.intensity.toolUseSuffix') : ''
          const modelSuffix = cell.model ? t('tokenBudget.intensity.modelSuffix', { model: cell.model }) : ''
          return (
            <div
              key={cell.turn}
              className={styles.heatCell}
              style={{
                backgroundColor: `rgba(245, 158, 11, ${0.1 + cell.intensity * 0.9})`,
              }}
              title={`${base}${toolSuffix}${modelSuffix}`}
            />
          )
        })}
      </div>
    </div>
  )
}
