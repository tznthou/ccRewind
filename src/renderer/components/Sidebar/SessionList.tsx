import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useSessions } from '../../hooks/useSessions'
import { useAppState, useAppDispatch } from '../../context/AppContext'
import { useTheme, type ThemeId } from '../../context/ThemeContext'
import { formatDateTime } from '../../utils/formatTime'
import styles from './Sidebar.module.css'

const SESSION_ITEM_HEIGHT: Record<ThemeId, number> = {
  archive: 56,
  timeline: 56,
  terminal: 56,
}

export default function SessionList() {
  const { selectedProjectId, selectedSessionId } = useAppState()
  const dispatch = useAppDispatch()
  const { theme } = useTheme()
  const { sessions, loading, error } = useSessions(selectedProjectId)
  const parentRef = useRef<HTMLDivElement>(null)
  const itemHeight = SESSION_ITEM_HEIGHT[theme]

  const virtualizer = useVirtualizer({
    count: sessions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemHeight,
    overscan: 5,
  })

  if (!selectedProjectId) {
    return <div className={styles.statusText}>選擇一個專案</div>
  }

  if (loading) {
    return <div className={styles.statusText}>載入 Sessions...</div>
  }

  if (error) {
    return <div className={styles.errorText}>錯誤：{error}</div>
  }

  if (sessions.length === 0) {
    return <div className={styles.statusText}>此專案沒有 Session</div>
  }

  return (
    <div ref={parentRef} className={styles.sessionListContainer} role="listbox" aria-label="Session 列表">
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const session = sessions[virtualItem.index]
          const isSelected = session.id === selectedSessionId
          return (
            <div
              key={session.id}
              className={`${styles.sessionItem} ${isSelected ? styles.selected : ''}`}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: virtualItem.size,
                transform: `translateY(${virtualItem.start}px)`,
              }}
              role="option"
              aria-selected={isSelected}
              tabIndex={0}
              onClick={() => dispatch({ type: 'SELECT_SESSION', sessionId: session.id })}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dispatch({ type: 'SELECT_SESSION', sessionId: session.id }) } }}
            >
              <div className={styles.sessionTitle}>
                {session.title ?? session.id.slice(0, 8)}
              </div>
              <div className={styles.sessionMeta}>
                <span>{formatDateTime(session.startedAt)}</span>
                <span>{session.archived ? '已封存 · ' : ''}{session.messageCount} 則</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
