import { useState, useEffect } from 'react'
import type { RelatedSession } from '../../../shared/types'
import { useAppDispatch } from '../../context/AppContext'
import { useI18n } from '../../i18n/useI18n'
import { getDateLocale } from '../../i18n/messages'
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
  const { t, locale } = useI18n()

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionId 變更時的 reset pattern，改寫成 derived state 風險高，留待後續 refactor
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
      <div className={styles.relatedHeader}>{t('related.title')}</div>
      <div className={styles.relatedList}>
        {displayed.map(r => (
          <div
            key={r.sessionId}
            className={styles.relatedCard}
            onClick={() => dispatch({ type: 'NAVIGATE_TO_SESSION', projectId: r.projectId, sessionId: r.sessionId })}
          >
            <div className={styles.relatedCardBody}>
              <div className={styles.relatedCardTitle}>
                {r.intentText || r.sessionTitle || r.sessionId.slice(0, 8)}
              </div>
              <div className={styles.relatedCardMeta}>
                {lastSegment(r.projectName)}
                {r.startedAt && ` · ${new Date(r.startedAt).toLocaleDateString(getDateLocale(locale))}`}
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
          {t('related.showMore', { count: related.length - 3 })}
        </button>
      )}
    </div>
  )
}
