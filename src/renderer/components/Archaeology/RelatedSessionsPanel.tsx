import { useState, useEffect } from 'react'
import type { RelatedSession } from '../../../shared/types'
import { useAppDispatch } from '../../context/AppContext'
import { lastSegment, basename } from '../../utils/pathDisplay'
import styles from './Archaeology.module.css'

interface Props {
  sessionId: string
}

export default function RelatedSessionsPanel({ sessionId }: Props) {
  const [related, setRelated] = useState<RelatedSession[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const dispatch = useAppDispatch()

  useEffect(() => {
    setLoading(true)
    setExpanded(false)
    setRelated([])
    let cancelled = false
    window.api.getRelatedSessions(sessionId, 5)
      .then(data => { if (!cancelled) setRelated(data) })
      .catch(() => { /* IPC error — graceful degrade to hidden */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [sessionId])

  if (loading || related.length === 0) return null

  const displayed = expanded ? related : related.slice(0, 3)

  return (
    <div className={styles.relatedPanel}>
      <div className={styles.relatedHeader}>Related Sessions</div>
      <div className={styles.relatedList}>
        {displayed.map(r => (
          <div
            key={r.sessionId}
            className={styles.relatedCard}
            onClick={() => dispatch({ type: 'SELECT_SESSION', sessionId: r.sessionId })}
          >
            <div className={styles.relatedCardBody}>
              <div className={styles.relatedCardTitle}>
                {r.intentText || r.sessionTitle || r.sessionId.slice(0, 8)}
              </div>
              <div className={styles.relatedCardMeta}>
                {lastSegment(r.projectName)}
                {r.startedAt && ` · ${new Date(r.startedAt).toLocaleDateString('zh-TW')}`}
                {r.outcomeStatus && ` · ${r.outcomeStatus}`}
              </div>
              <div className={styles.sharedFiles}>
                {r.sharedFiles.map(f => basename(f)).join(', ')}
              </div>
            </div>
            <span className={styles.jaccardBadge}>{Math.round(r.jaccard * 100)}%</span>
          </div>
        ))}
      </div>
      {related.length > 3 && !expanded && (
        <button
          className={styles.relatedCard}
          style={{ justifyContent: 'center', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-accent)', fontSize: 'var(--font-size-xs)' }}
          onClick={() => setExpanded(true)}
        >
          Show {related.length - 3} more
        </button>
      )}
    </div>
  )
}
