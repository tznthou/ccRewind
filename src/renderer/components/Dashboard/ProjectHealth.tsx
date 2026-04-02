import { useMemo } from 'react'
import type { ProjectHealth as ProjectHealthType } from '../../../shared/types'
import { formatTokens } from '../../utils/formatTokens'
import { lastSegment } from '../../utils/pathDisplay'
import styles from './Dashboard.module.css'

interface Props {
  data: ProjectHealthType[]
}

const OUTCOME_COLORS = {
  committed: '#22c55e',
  tested: '#3b82f6',
  inProgress: '#f59e0b',
  quickQa: '#06b6d4',
  unknown: 'var(--color-text-muted)',
} as const

type OutcomeKey = keyof typeof OUTCOME_COLORS

function TrendArrow({ recent, previous }: { recent: number; previous: number }) {
  if (recent > previous) return <span className={styles.healthTrendUp}>&#9650; {recent}</span>
  if (recent < previous) return <span className={styles.healthTrendDown}>&#9660; {recent}</span>
  return <span className={styles.healthTrendFlat}>&#9654; {recent}</span>
}

export default function ProjectHealthComponent({ data }: Props) {
  const items = useMemo(() => data.slice(0, 10), [data])

  if (items.length === 0) {
    return <div className={styles.empty}>No projects</div>
  }

  return (
    <div className={styles.healthList}>
      {items.map(p => {
        const dist = p.outcomeDistribution
        const total = dist.committed + dist.tested + dist.inProgress + dist.quickQa + dist.unknown

        return (
          <div key={p.projectId} className={styles.healthItem}>
            <div className={styles.rankingName} title={p.displayName}>
              {lastSegment(p.displayName)}
            </div>

            {total > 0 && (
              <div className={styles.healthBar}>
                {(Object.keys(OUTCOME_COLORS) as OutcomeKey[]).map(key => {
                  const count = dist[key]
                  if (count === 0) return null
                  return (
                    <div
                      key={key}
                      className={styles.healthBarSegment}
                      style={{ width: `${(count / total) * 100}%`, background: OUTCOME_COLORS[key] }}
                      title={`${key}: ${count}`}
                    />
                  )
                })}
              </div>
            )}

            <div className={styles.healthTrend}>
              <TrendArrow recent={p.recentCount} previous={p.previousCount} />
            </div>

            <div className={styles.healthMeta}>
              {p.avgTokensPerTurn != null ? `${formatTokens(p.avgTokensPerTurn)}/t` : '-'}
            </div>
          </div>
        )
      })}
    </div>
  )
}
