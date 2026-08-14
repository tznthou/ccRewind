import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useSessions } from '../../hooks/useSessions'
import { useAppState, useAppDispatch } from '../../context/AppContext'
import { useTheme, type ThemeId } from '../../context/ThemeContext'
import { useI18n } from '../../i18n/useI18n'
import { useListboxKeyNav } from '../../hooks/useListboxKeyNav'
import type { SessionMeta } from '../../../shared/types'
import { buildRemoteControlUrl } from '../../../shared/remoteControl'
import { formatDateTime, formatDuration } from '../../utils/formatTime'
import { formatTokens } from '../../utils/formatTokens'
import styles from './Sidebar.module.css'

type SortKey = 'time' | 'tokens'

// 三行內容（標題 / meta / tags）在 meta 折成兩行時需要 91px：
// padding 8 + 標題 20 + gap 2 + meta 34 + gap 2 + tags 17 + padding 8。
// 原本的 80px 不夠，而 .sessionItem 是固定高的 flex 容器，放不下時會把最後一行
// （.sessionTags，帶 overflow: hidden）壓縮到剩 6px，於是標籤只露出半截。
// meta 會不會折行取決於訊息數與 token 數的位數，session 越長越容易觸發。
const SESSION_ITEM_HEIGHT: Record<ThemeId, number> = {
  archive: 92,
  timeline: 92,
  terminal: 92,
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
  const [showStarredOnly, setShowStarredOnly] = useState(false)
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    setStarredIds(new Set(sessions.filter(s => s.starred).map(s => s.id)))
  }, [sessions])

  const toggleStar = useCallback((sessionId: string) => {
    const wasStarred = starredIds.has(sessionId)
    setStarredIds(prev => {
      const next = new Set(prev)
      if (wasStarred) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
    window.api.setSessionStarred(sessionId, !wasStarred).catch(() => {
      setStarredIds(prev => {
        const reverted = new Set(prev)
        if (wasStarred) reverted.add(sessionId)
        else reverted.delete(sessionId)
        return reverted
      })
    })
  }, [starredIds])

  const filteredSessions = useMemo(() => {
    if (!showStarredOnly) return sessions
    return sessions.filter(s => starredIds.has(s.id))
  }, [sessions, showStarredOnly, starredIds])

  const sortedSessions = useMemo(() => {
    if (sortKey === 'tokens') {
      return [...filteredSessions].sort((a, b) =>
        ((b.totalInputTokens ?? 0) + (b.totalOutputTokens ?? 0))
        - ((a.totalInputTokens ?? 0) + (a.totalOutputTokens ?? 0)),
      )
    }
    return filteredSessions
  }, [filteredSessions, sortKey])

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual 的 useVirtualizer 跟 React Compiler memoization 不相容（third-party API design 限制）
  const virtualizer = useVirtualizer({
    count: sortedSessions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemHeight,
    overscan: 5,
  })

  const { listboxProps, getOptionProps, isActive, setActiveIndex } = useListboxKeyNav<SessionMeta>({
    items: sortedSessions,
    getItemId: (s) => s.id,
    onActivate: (s) => dispatch({ type: 'SELECT_SESSION', sessionId: s.id }),
    dispatchOnArrow: true,
    onActiveChange: (i) => virtualizer.scrollToIndex(i, { align: 'auto' }),
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
          {t('sidebar.sessionList.sort.time')}
        </button>
        <button
          className={`${styles.sortButton} ${sortKey === 'tokens' ? styles.sortActive : ''}`}
          onClick={() => setSortKey('tokens')}
        >
          {t('sidebar.sessionList.sort.tokens')}
        </button>
        <button
          className={`${styles.sortButton} ${showStarredOnly ? styles.sortActive : ''}`}
          onClick={() => setShowStarredOnly(prev => !prev)}
          aria-pressed={showStarredOnly}
          aria-label={t('sidebar.sessionList.starFilter')}
        >
          ★
        </button>
      </div>
      {showStarredOnly && sortedSessions.length === 0 ? (
        <div className={styles.statusText}>{t('sidebar.sessionList.empty.noStarred')}</div>
      ) : (
      <div
      ref={parentRef}
      className={styles.sessionListContainer}
      aria-label={t('sidebar.sessionList.aria.label')}
      {...listboxProps}
    >
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
          const active = isActive(virtualItem.index)
          const isStarred = starredIds.has(session.id)
          return (
            <div
              key={session.id}
              className={`${styles.sessionItem} ${isSelected ? styles.selected : ''} ${active ? styles.optionActive : ''}`}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: virtualItem.size,
                transform: `translateY(${virtualItem.start}px)`,
              }}
              aria-selected={isSelected}
              {...getOptionProps(session)}
              onClick={() => {
                setActiveIndex(virtualItem.index)
                dispatch({ type: 'SELECT_SESSION', sessionId: session.id })
              }}
            >
              <div className={styles.sessionTitleRow}>
                <div className={styles.sessionTitle}>
                  {session.intentText || session.title || session.id.slice(0, 8)}
                </div>
                <button
                  className={`${styles.starButton} ${isStarred ? styles.starActive : ''}`}
                  aria-pressed={isStarred}
                  aria-label={isStarred ? t('sidebar.sessionList.unstar') : t('sidebar.sessionList.star')}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleStar(session.id)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation()
                    }
                  }}
                  tabIndex={-1}
                >
                  {isStarred ? '★' : '☆'}
                </button>
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
                  {session.hasRemoteControl && (() => {
                    // 多數歷史 session 沒有 bridgeSessionId（原檔已被 30 天清理，且無回填來源），
                    // 這時仍要顯示標記、只是不可點——badge 的意義是「曾經遠端連線過」，不是「有連結」。
                    const remoteUrl = buildRemoteControlUrl(session.bridgeSessionId)
                    if (!remoteUrl) {
                      return (
                        <span className={styles.remoteBadge} title={t('sidebar.sessionList.remoteControl.hint')}>
                          {t('sidebar.sessionList.remoteControl')}
                        </span>
                      )
                    }
                    return (
                      <a
                        className={`${styles.remoteBadge} ${styles.remoteBadgeLink}`}
                        href={remoteUrl}
                        title={t('sidebar.sessionList.remoteControl.open')}
                        aria-label={t('sidebar.sessionList.remoteControl.open')}
                        // 不讓點擊冒泡到列本身，否則開連結的同時也切換了選取的 session
                        onClick={e => e.stopPropagation()}
                        // 列表是 listbox，焦點由 aria-activedescendant 管理，內部元素不進 tab 序
                        tabIndex={-1}
                      >
                        {t('sidebar.sessionList.remoteControl')}
                      </a>
                    )
                  })()}
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
                        {t('sidebar.sessionList.fileCount', { count: `${count}${count >= 30 ? '+' : ''}` })}
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
      )}
    </>
  )
}
