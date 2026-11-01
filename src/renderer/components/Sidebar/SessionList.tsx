import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useSessions } from '../../hooks/useSessions'
import { useAppState, useAppDispatch } from '../../context/AppContext'
import { useI18n } from '../../i18n/useI18n'
import { useListboxKeyNav } from '../../hooks/useListboxKeyNav'
import type { SessionMeta } from '../../../shared/types'
import { buildRemoteControlUrl } from '../../../shared/remoteControl'
import { openExternalUrl } from '../../utils/openExternal'
import { formatDateTime, formatDuration } from '../../utils/formatTime'
import { formatTokens } from '../../utils/formatTokens'
import styles from './Sidebar.module.css'

type SortKey = 'time' | 'tokens'

// 列高不固定：每一列量自己的實際高度（measureElement）。三行內容（標題 / meta / tags）裡 meta 會折兩行或三行，
// 取決於訊息數與 token 數的位數、字級與主題的字型（終端機的 Fira Code 最寬）：舊字級下同一字級各列就差到
// 86–126px（2026-11-01 量 30 列）。以前寫死 92px，放不下時 .sessionItem 這個 flex 容器會把帶 overflow: hidden 的
// 標籤列壓扁、標題被推出上緣；而且光改 estimateSize 不會重排（virtual-core 的 measurement memo 不依賴它）。
// 字級或主題一變，畫出來的列由 ResizeObserver 重新量；沒畫出來的捲到時才量。
// 估計值只用在還沒量過的列：新字級「一般」下 meta 折兩行約 96px。
const ESTIMATED_ITEM_HEIGHT = 96

export default function SessionList() {
  const { selectedProjectId, selectedSessionId } = useAppState()
  const dispatch = useAppDispatch()
  const { t } = useI18n()
  const { sessions, loading, error } = useSessions(selectedProjectId)
  const parentRef = useRef<HTMLDivElement>(null)
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

  // 用 session id 當 key：切排序（時間 ↔ Tokens）或換專案時，量過的高度跟著 session 走；
  // 沿用預設的 index，別的 session 會吃到同一位置上一場量到的高度。
  // 必須是穩定 reference：virtual-core 把 getItemKey 列在 getMeasurementOptions 的 memo 依賴裡（同 ChatView）。
  const getItemKey = useCallback(
    (index: number) => sortedSessions[index]?.id ?? index,
    [sortedSessions],
  )

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual 的 useVirtualizer 跟 React Compiler memoization 不相容（third-party API design 限制）
  const virtualizer = useVirtualizer({
    count: sortedSessions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ITEM_HEIGHT,
    overscan: 5,
    getItemKey,
  })

  const { activeIndex, listboxProps, getOptionProps, isActive, setActiveIndex } = useListboxKeyNav<SessionMeta>({
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
      onKeyDown={(e) => {
        // 遠端連結的鍵盤入口。listbox option 內不能放可聚焦元素（會破壞
        // aria-activedescendant 的焦點模型），所以那顆 badge 對鍵盤是不可及的；
        // 用捷徑補上等效操作，而不是把 tabIndex 打開。
        if ((e.key === 'o' || e.key === 'O') && !e.metaKey && !e.ctrlKey && !e.altKey) {
          const url = buildRemoteControlUrl(sortedSessions[activeIndex]?.bridgeSessionId)
          if (url) {
            e.preventDefault()
            openExternalUrl(url)
            return
          }
        }
        listboxProps.onKeyDown(e)
      }}
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
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              className={`${styles.sessionItem} ${isSelected ? styles.selected : ''} ${active ? styles.optionActive : ''}`}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
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
