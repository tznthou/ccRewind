import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useSessions } from '../../hooks/useSessions'
import { useAppState, useAppDispatch } from '../../context/AppContext'
import { useTheme, type ThemeId } from '../../context/ThemeContext'
import { useI18n } from '../../i18n/useI18n'
import { formatDateTime, formatDuration } from '../../utils/formatTime'
import { formatTokens } from '../../utils/formatTokens'
import styles from './Sidebar.module.css'

type SortKey = 'time' | 'tokens'

const SESSION_ITEM_HEIGHT: Record<ThemeId, number> = {
  archive: 80,
  timeline: 80,
  terminal: 80,
}

export default function SessionList() {
  const { selectedProjectId, selectedSessionId } = useAppState()
  const dispatch = useAppDispatch()
  const { theme } = useTheme()
  const { t } = useI18n()
  const { sessions, loading, error } = useSessions(selectedProjectId)
  const parentRef = useRef<HTMLDivElement>(null)
  const itemHeight = SESSION_ITEM_HEIGHT[theme]
  const [sortKey, setSortKey] = useState<SortKey>('time')

  const sortedSessions = useMemo(() => {
    if (sortKey === 'tokens') {
      return [...sessions].sort((a, b) =>
        ((b.totalInputTokens ?? 0) + (b.totalOutputTokens ?? 0))
        - ((a.totalInputTokens ?? 0) + (a.totalOutputTokens ?? 0)),
      )
    }
    return sessions // already sorted by time from hook
  }, [sessions, sortKey])

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual 的 useVirtualizer 跟 React Compiler memoization 不相容（third-party API design 限制）
  const virtualizer = useVirtualizer({
    count: sortedSessions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemHeight,
    overscan: 5,
  })

  if (!selectedProjectId) {
    return <div className={styles.statusText}>{t('sidebar.sessionList.empty.noProject')}</div>
  }

  if (loading) {
    return <div className={styles.statusText}>{t('sidebar.sessionList.loading')}</div>
  }

  if (error) {
    return <div className={styles.errorText}>{t('common.error', { message: error })}</div>
  }

  if (sessions.length === 0) {
    return <div className={styles.statusText}>{t('sidebar.sessionList.empty.noSessions')}</div>
  }

  return (
    <>
      <div className={styles.sortToggle}>
        <button
          className={`${styles.sortButton} ${sortKey === 'time' ? styles.sortActive : ''}`}
          onClick={() => setSortKey('time')}
        >
          Time
        </button>
        <button
          className={`${styles.sortButton} ${sortKey === 'tokens' ? styles.sortActive : ''}`}
          onClick={() => setSortKey('tokens')}
        >
          Tokens
        </button>
      </div>
    <div ref={parentRef} className={styles.sessionListContainer} role="listbox" aria-label={t('sidebar.sessionList.aria.label')}>
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const session = sortedSessions[virtualItem.index]
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
                {session.intentText || session.title || session.id.slice(0, 8)}
              </div>
              <div className={styles.sessionMeta}>
                <span>
                  {formatDateTime(session.startedAt)}
                  {(session.activeDurationSeconds != null && session.activeDurationSeconds > 0
                    ? <span className={styles.durationBadge}> · {formatDuration(session.activeDurationSeconds)}{session.durationSeconds != null && session.durationSeconds > session.activeDurationSeconds ? ` (${formatDuration(session.durationSeconds)})` : ''}</span>
                    : session.durationSeconds != null && session.durationSeconds > 0
                      ? <span className={styles.durationBadge}> · {formatDuration(session.durationSeconds)}</span>
                      : null
                  )}
                </span>
                <span>
                  {session.archived ? `${t('sidebar.sessionList.archived')} · ` : ''}{t('sidebar.sessionList.messageCount', { count: session.messageCount })}
                  {session.totalInputTokens != null && session.totalInputTokens > 0 && (
                    <span className={styles.tokenBadge}> · {formatTokens((session.totalInputTokens ?? 0) + (session.totalOutputTokens ?? 0))}</span>
                  )}
                </span>
              </div>
              {(session.tags || session.filesTouched || session.outcomeStatus) && (
                <div className={styles.sessionTags}>
                  {session.outcomeStatus && (
                    <span className={`${styles.tag} ${styles.outcomeTag}`} data-outcome={session.outcomeStatus}>
                      {session.outcomeStatus}
                    </span>
                  )}
                  {session.tags?.split(',').filter(t => t !== 'committed' && t !== 'tested').slice(0, 3).map(tag => (
                    <span key={tag} className={styles.tag}>{tag}</span>
                  ))}
                  {session.filesTouched && (() => {
                    const count = session.filesTouched!.split(',').length
                    return (
                      <span className={styles.fileCount}>
                        {count}{count >= 30 ? '+' : ''} files
                      </span>
                    )
                  })()}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
    </>
  )
}
