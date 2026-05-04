import { useMemo } from 'react'
import type { ProjectHealth as ProjectHealthType } from '../../../shared/types'
import { useI18n } from '../../i18n/useI18n'
import { formatTokens } from '../../utils/formatTokens'
import { lastSegment } from '../../utils/pathDisplay'
import {
  DISTRIBUTION_KEY_TO_OUTCOME,
  OUTCOME_COLORS,
  OUTCOME_I18N_KEY,
  OUTCOME_KEYS,
  type DistributionKey,
} from './outcomeColors'
import styles from './Dashboard.module.css'

interface Props {
  data: ProjectHealthType[]
}

const DISTRIBUTION_KEYS: readonly DistributionKey[] = [
  'committed',
  'tested',
  'inProgress',
  'quickQa',
  'unknown',
] as const

function TrendArrow({ recent, previous }: { recent: number; previous: number }) {
  const { t } = useI18n()
  if (recent > previous) {
    return (
      <span className={styles.healthTrendUp} aria-label={t('dashboard.health.trendUp', { count: recent })}>
        &#9650; {recent}
      </span>
    )
  }
  if (recent < previous) {
    return (
      <span className={styles.healthTrendDown} aria-label={t('dashboard.health.trendDown', { count: recent })}>
        &#9660; {recent}
      </span>
    )
  }
  return (
    <span className={styles.healthTrendFlat} aria-label={t('dashboard.health.trendFlat', { count: recent })}>
      &#9654; {recent}
    </span>
  )
}

export default function ProjectHealthComponent({ data }: Props) {
  const { t } = useI18n()
  const items = useMemo(() => data.slice(0, 10), [data])

  if (items.length === 0) {
    return <div className={styles.empty}>{t('dashboard.projectHealth.empty')}</div>
  }

  return (
    <div>
      <ul className={styles.outcomeLegend}>
        {OUTCOME_KEYS.map(key => (
          <li key={key} className={styles.legendItem}>
            <span
              className={styles.legendSwatch}
              style={{ background: OUTCOME_COLORS[key] }}
              aria-hidden="true"
            />
            {t(OUTCOME_I18N_KEY[key])}
          </li>
        ))}
      </ul>
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
                  {DISTRIBUTION_KEYS.map(key => {
                    const count = dist[key]
                    if (count === 0) return null
                    const outcomeKey = DISTRIBUTION_KEY_TO_OUTCOME[key]
                    return (
                      <div
                        key={key}
                        className={styles.healthBarSegment}
                        style={{ width: `${(count / total) * 100}%`, background: OUTCOME_COLORS[outcomeKey] }}
                        title={`${t(OUTCOME_I18N_KEY[outcomeKey])}: ${count}`}
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
    </div>
  )
}
