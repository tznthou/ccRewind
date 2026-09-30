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

    // 第幾次呼叫（不是 JSONL 的 sequence）要在分箱前決定，分箱後才算會跟圖表對不上
    const numbered = turns.map((turn, i) => ({ ...turn, call: i + 1 }))

    // Bin turns when exceeding MAX_CELLS to limit DOM nodes
    const binSize = numbered.length > MAX_CELLS ? Math.ceil(numbered.length / MAX_CELLS) : 1
    const binned: typeof numbered = []
    for (let i = 0; i < numbered.length; i += binSize) {
      const slice = numbered.slice(i, i + binSize)
      const best = slice.reduce((a, b) => a.outputTokens >= b.outputTokens ? a : b)
      binned.push(best)
    }

    return {
      cells: binned.map(turn => ({
        call: turn.call,
        output: turn.outputTokens,
        intensity: turn.outputTokens / denom,
        hasToolUse: turn.hasToolUse,
        model: turn.model,
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
            call: cell.call,
            tokens: formatTokens(cell.output),
          })
          const toolSuffix = cell.hasToolUse ? t('tokenBudget.intensity.toolUseSuffix') : ''
          const modelSuffix = cell.model ? t('tokenBudget.intensity.modelSuffix', { model: cell.model }) : ''
          return (
            <div
              key={cell.call}
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
