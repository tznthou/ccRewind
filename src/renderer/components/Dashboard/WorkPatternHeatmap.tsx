import { useMemo } from 'react'
import type { WorkPatterns } from '../../../shared/types'
import styles from './Dashboard.module.css'

interface Props {
  data: WorkPatterns | null
}

function formatDuration(seconds: number): string {
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(1)}h`
  if (seconds >= 60) return `${Math.round(seconds / 60)}m`
  return `${seconds}s`
}

export default function WorkPatternHeatmap({ data }: Props) {
  const maxCount = useMemo(() => {
    if (!data) return 0
    return Math.max(...data.hourly.map(h => h.count), 1)
  }, [data])

  if (!data) {
    return <div className={styles.empty}>No data</div>
  }

  return (
    <div>
      <div className={styles.heatmapRow}>
        {data.hourly.map(h => {
          const intensity = h.count / maxCount
          return (
            <div
              key={h.hour}
              className={styles.heatmapCell}
              style={{
                background: h.count > 0
                  ? `rgba(59, 130, 246, ${0.15 + intensity * 0.7})`
                  : 'var(--color-bg-hover)',
              }}
              title={`${h.hour}:00 — ${h.count} sessions`}
            />
          )
        })}
      </div>
      <div className={styles.heatmapLabels}>
        <span>0:00</span>
        <span>6:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>23:00</span>
      </div>
      {data.avgDurationSeconds != null && (
        <div className={styles.durationStat}>
          Avg session: <span className={styles.durationValue}>{formatDuration(data.avgDurationSeconds)}</span>
        </div>
      )}
    </div>
  )
}
