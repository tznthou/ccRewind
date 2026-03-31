import type { ProjectStats } from '../../../shared/types'
import { formatTokens } from '../../utils/formatTokens'
import { lastSegment } from '../../utils/pathDisplay'
import styles from './Dashboard.module.css'

interface Props {
  data: ProjectStats[]
}

export default function ProjectRanking({ data }: Props) {
  if (data.length === 0) {
    return <div className={styles.empty}>No projects</div>
  }

  const maxSessions = Math.max(...data.map(d => d.sessionCount))

  return (
    <div className={styles.rankingList}>
      {data.slice(0, 10).map(p => (
        <div key={p.projectId} className={styles.rankingItem}>
          <div className={styles.rankingName} title={p.displayName}>
            {lastSegment(p.displayName)}
          </div>
          <div className={styles.rankingValue}>
            {p.sessionCount}s / {formatTokens(p.totalTokens)}
          </div>
          <div style={{ width: 80, flexShrink: 0 }}>
            <div
              className={styles.rankingBar}
              style={{ width: `${(p.sessionCount / maxSessions) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
