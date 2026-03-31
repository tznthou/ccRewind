import { useState, useEffect } from 'react'
import type { FileHistoryEntry } from '../../../shared/types'
import { useAppDispatch } from '../../context/AppContext'
import { lastSegment } from '../../utils/pathDisplay'
import styles from './Archaeology.module.css'

interface Props {
  filePath: string
  onClose: () => void
}

export default function FileHistoryDrawer({ filePath, onClose }: Props) {
  const [entries, setEntries] = useState<FileHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const dispatch = useAppDispatch()

  useEffect(() => {
    setLoading(true)
    window.api.getFileHistory(filePath)
      .then(setEntries)
      .finally(() => setLoading(false))
  }, [filePath])

  const handleNavigate = (sessionId: string) => {
    dispatch({ type: 'SET_VIEW_MODE', mode: 'sessions' })
    dispatch({ type: 'SELECT_SESSION', sessionId })
    onClose()
  }

  return (
    <>
      <div className={styles.drawerOverlay} onClick={onClose} />
      <div className={styles.drawer}>
        <div className={styles.drawerHeader}>
          <div>
            <div className={styles.drawerTitle}>File History</div>
            <div className={styles.drawerPath}>{filePath}</div>
          </div>
          <button className={styles.closeButton} onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className={styles.drawerBody}>
          {loading ? (
            <div className={styles.empty}>Loading...</div>
          ) : entries.length === 0 ? (
            <div className={styles.empty}>No history found</div>
          ) : (
            <div className={styles.timeline}>
              {entries.map((entry, i) => (
                <div
                  key={`${entry.sessionId}-${entry.operation}-${i}`}
                  className={styles.timelineEntry}
                  data-op={entry.operation}
                  onClick={() => handleNavigate(entry.sessionId)}
                >
                  <div className={styles.entryDate}>
                    {entry.startedAt ? new Date(entry.startedAt).toLocaleDateString('zh-TW', {
                      year: 'numeric', month: '2-digit', day: '2-digit',
                      hour: '2-digit', minute: '2-digit',
                    }) : 'Unknown date'}
                  </div>
                  <div className={styles.entryTitle}>
                    {entry.sessionTitle || entry.sessionId.slice(0, 8)}
                  </div>
                  <div className={styles.entryMeta}>
                    <span className={styles.opBadge} data-op={entry.operation}>{entry.operation}</span>
                    {entry.count > 1 && <span>{entry.count}x</span>}
                    <span>{lastSegment(entry.projectName)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
