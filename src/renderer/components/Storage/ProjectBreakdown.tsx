import { useMemo } from 'react'
import type { ProjectBreakdown } from '../../../shared/types'
import { useI18n } from '../../i18n/useI18n'
import { formatBytes } from '../../utils/formatBytes'
import { lastSegment } from '../../utils/pathDisplay'
import styles from './Storage.module.css'

interface Props {
  projects: ProjectBreakdown[]
  onExcludeProject: (projectId: string, displayName: string) => void
}

export default function ProjectBreakdownList({ projects, onExcludeProject }: Props) {
  const { t } = useI18n()
  const sorted = useMemo(
    () => [...projects].sort((a, b) => b.estimatedBytes - a.estimatedBytes),
    [projects],
  )
  const maxBytes = sorted[0]?.estimatedBytes ?? 0

  if (sorted.length === 0) {
    return <div className={styles.empty}>{t('storage.projects.empty')}</div>
  }

  return (
    <div className={styles.projectList}>
      {sorted.map(p => (
        <div key={p.projectId} className={styles.projectRow}>
          <div className={styles.projectName} title={p.displayName}>
            {lastSegment(p.displayName)}
          </div>
          <div className={styles.projectBarWrap}>
            <div
              className={styles.projectBar}
              style={{ width: maxBytes > 0 ? `${(p.estimatedBytes / maxBytes) * 100}%` : '0%' }}
            />
          </div>
          <div className={styles.projectMeta}>
            {formatBytes(p.estimatedBytes)} · {p.sessionCount}s
          </div>
          <button
            className={`${styles.button} ${styles.dangerButton}`}
            onClick={() => onExcludeProject(p.projectId, p.displayName)}
          >
            {t('storage.projects.exclude')}
          </button>
        </div>
      ))}
    </div>
  )
}
