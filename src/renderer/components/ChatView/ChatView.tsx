import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useAppState, useAppDispatch } from '../../context/AppContext'
import { useSession } from '../../hooks/useSession'
import { useI18n } from '../../i18n/useI18n'
import type { SessionFile } from '../../../shared/types'
import { basename } from '../../utils/pathDisplay'
import MessageBubble from './MessageBubble'
import TokenBudgetPanel from '../TokenBudget/TokenBudgetPanel'
import RelatedSessionsPanel from '../Archaeology/RelatedSessionsPanel'
import SubagentPanel from './SubagentPanel'
import TasksPanel from './TasksPanel'
import { useTokenHeat } from './TokenHeatGutter'
import ErrorBoundary from '../ErrorBoundary/ErrorBoundary'
import { MessageErrorFallback } from '../ErrorBoundary/ErrorFallback'
import styles from './ChatView.module.css'

interface ChatViewProps {
  sessionId: string
}

export default function ChatView({ sessionId }: ChatViewProps) {
  const { messages, loading, error } = useSession(sessionId)
  const { targetMessageId, searchQuery } = useAppState()
  const heatMap = useTokenHeat(messages)
  const dispatch = useAppDispatch()
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 捲動容器是 ChatView 的父層（App.module.css 的 .main），ChatView 自己沒有 overflow
  const getScrollElement = useCallback(() => containerRef.current?.parentElement ?? null, [])

  // 虛擬列表前面還有 panel / toolbar / fileChips，需要告訴 virtualizer 列表起點偏移。
  // 這些前置內容是條件渲染且可摺疊，所以每次相關狀態變動都要重算。
  const [scrollMargin, setScrollMargin] = useState(0)

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual 的 useVirtualizer 跟 React Compiler memoization 不相容（third-party API design 限制）
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement,
    // 實測本機資料：訊息高度中位數與 p90 都是 96px（最小 71、最大 2714）
    estimateSize: () => 96,
    overscan: 8,
    scrollMargin,
  })

  // 換 session 時若無搜尋目標就 scroll to top；用 ref 追蹤前一個 sessionId 避免 targetMessageId 變化時誤觸（會蓋掉 search scroll）
  const prevSessionIdRef = useRef<string | null>(null)
  useEffect(() => {
    const sessionChanged = prevSessionIdRef.current !== sessionId
    prevSessionIdRef.current = sessionId
    if (sessionChanged && !targetMessageId) {
      containerRef.current?.parentElement?.scrollTo(0, 0)
    }
  }, [sessionId, targetMessageId])

  // 搜尋跳轉：targetMessageId 設定後（含同 session 重複點擊），loading 結束時跳轉。
  // 虛擬化後目標訊息不一定在 DOM 裡，必須先 scrollToIndex 把它帶進可視範圍再操作。
  useEffect(() => {
    if (!targetMessageId || loading) return
    const index = messages.findIndex(m => m.id === targetMessageId)
    if (index < 0) return
    dispatch({ type: 'CLEAR_TARGET_MESSAGE' })

    virtualizer.scrollToIndex(index, { align: 'center' })

    let cancelled = false
    let rafId = 0
    let attempts = 0
    let teardown: (() => void) | undefined

    const locate = () => {
      if (cancelled) return
      const el = containerRef.current?.querySelector(`[data-message-id="${targetMessageId}"]`)
      if (!(el instanceof HTMLElement)) {
        // 高度是量出來的不是算出來的，scrollToIndex 可能要多輪修正才把目標帶到定位
        if (attempts++ < 60) rafId = requestAnimationFrame(locate)
        return
      }

      el.focus({ preventScroll: true })
      el.classList.add(styles.highlightTarget)
      const onEnd = () => {
        el.classList.remove(styles.highlightTarget)
        el.removeEventListener('animationend', onEnd)
      }
      el.addEventListener('animationend', onEnd)

      // 再捲到第一個關鍵字 mark；若所在 <details> 摺疊則先展開
      let innerRafId = 0
      const outerRafId = requestAnimationFrame(() => {
        const mark = el.querySelector<HTMLElement>('mark[data-search-match="true"]')
        if (!mark) return
        const details = mark.closest('details')
        if (details && !details.open) details.open = true
        innerRafId = requestAnimationFrame(() => mark.scrollIntoView({ behavior: 'smooth', block: 'center' }))
      })

      // 捲動會讓 virtualizer 重新渲染、目標元素 remount，先前的 focus 會被吃掉。
      // 等捲動真正停下來再補一次 focus，並重新查詢元素（原本的 node 可能已不在）。
      const scroller = getScrollElement()
      let settleTimer = 0
      const refocus = () => {
        clearTimeout(settleTimer)
        scroller?.removeEventListener('scrollend', refocus)
        if (cancelled) return
        const current = containerRef.current?.querySelector(`[data-message-id="${targetMessageId}"]`)
        if (current instanceof HTMLElement) current.focus({ preventScroll: true })
      }
      scroller?.addEventListener('scrollend', refocus)
      // 沒有實際捲動時 scrollend 不會發生，用 timeout 兜底
      settleTimer = window.setTimeout(refocus, 800)

      teardown = () => {
        cancelAnimationFrame(outerRafId)
        cancelAnimationFrame(innerRafId)
        clearTimeout(settleTimer)
        scroller?.removeEventListener('scrollend', refocus)
        el.classList.remove(styles.highlightTarget)
        el.removeEventListener('animationend', onEnd)
      }
    }
    rafId = requestAnimationFrame(locate)

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      teardown?.()
    }
  }, [targetMessageId, loading, dispatch, messages, virtualizer, getScrollElement])

  const [exporting, setExporting] = useState(false)
  const [sessionFiles, setSessionFiles] = useState<SessionFile[]>([])
  const [showFiles, setShowFiles] = useState(false)

  useEffect(() => {
    // 切 session 時 reset 面板狀態再 fetch (reset-on-id)
    setShowFiles(false)
    setSessionFiles([])
    let cancelled = false
    window.api.getSessionFiles(sessionId).then(files => {
      if (!cancelled) setSessionFiles(files)
    })
    return () => { cancelled = true }
  }, [sessionId])

  // 前置內容（panel / toolbar / fileChips）都是條件渲染，高度不是常數，
  // 每次可能影響列表起點的狀態變動後都重新量一次
  useLayoutEffect(() => {
    const scroller = getScrollElement()
    const list = listRef.current
    if (!scroller || !list) return
    const offset = list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
    setScrollMargin(prev => (Math.abs(prev - offset) > 1 ? offset : prev))
  }, [getScrollElement, messages.length, loading, showFiles, sessionFiles.length, sessionId])

  const handleExport = useCallback(async () => {
    setExporting(true)
    try {
      await window.api.exportMarkdown(sessionId)
    } finally {
      setExporting(false)
    }
  }, [sessionId])

  const [copiedFlash, setCopiedFlash] = useState(false)
  useEffect(() => {
    if (!copiedFlash) return
    const id = setTimeout(() => setCopiedFlash(false), 1500)
    return () => clearTimeout(id)
  }, [copiedFlash])

  const handleCopySessionId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(sessionId)
      setCopiedFlash(true)
      dispatch({ type: 'ANNOUNCE', message: t('a11y.announcement.sessionIdCopied') })
    } catch {
      // Electron clipboard 偶爾失敗 (deny permission / focus issue); 沉默不打擾 SR, console 有 error 即可
    }
  }, [sessionId, dispatch, t])

  return (
    <div ref={containerRef} className={styles.chatView}>
      <SubagentPanel sessionId={sessionId} />
      <TasksPanel sessionId={sessionId} />
      {loading ? (
        <div className={styles.status}>{t('chatView.loading')}</div>
      ) : error ? (
        <div className={styles.error}>{t('common.error', { message: error })}</div>
      ) : messages.length === 0 ? (
        <div className={styles.status}>{t('chatView.empty')}</div>
      ) : (
        <>
          <div className={styles.toolbar}>
            <TokenBudgetPanel sessionId={sessionId} />
            <div className={styles.toolbarActions}>
              <button
                type="button"
                className={copiedFlash ? `${styles.sessionIdChip} ${styles.sessionIdChipCopied}` : styles.sessionIdChip}
                onClick={handleCopySessionId}
                data-tooltip={sessionId}
                aria-label={t('chatView.toolbar.copySessionId')}
              >
                {copiedFlash ? t('chatView.toolbar.copied') : `${sessionId.slice(0, 8)}...`}
              </button>
              {sessionFiles.length > 0 && (
                <button
                  className={styles.filesToggle}
                  onClick={() => setShowFiles(v => !v)}
                >
                  {t('chatView.toolbar.filesCount', { count: sessionFiles.length })} {showFiles ? '\u25B4' : '\u25BE'}
                </button>
              )}
              <button
                className={styles.exportButton}
                onClick={handleExport}
                disabled={exporting || messages.length === 0}
              >
                {exporting ? t('chatView.toolbar.exporting') : t('chatView.toolbar.export')}
              </button>
            </div>
          </div>
          {showFiles && sessionFiles.length > 0 && (
            <div className={styles.filesChips}>
              {sessionFiles.map(f => (
                <button
                  key={`${f.filePath}-${f.operation}`}
                  className={styles.fileChip}
                  data-op={f.operation}
                  onClick={() => dispatch({ type: 'OPEN_FILE_HISTORY', filePath: f.filePath })}
                  title={`${f.filePath} (${f.operation} ×${f.count})`}
                >
                  {basename(f.filePath)}
                </button>
              ))}
            </div>
          )}
          <div ref={listRef} className={styles.messageList} style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const msg = messages[virtualItem.index]
              return (
                <div
                  key={msg.id}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  className={styles.messageRow}
                  style={{ transform: `translateY(${virtualItem.start - scrollMargin}px)` }}
                >
                  <ErrorBoundary
                    label={`message:${msg.id}`}
                    fallback={error => <MessageErrorFallback error={error} />}
                  >
                    <MessageBubble message={msg} searchQuery={searchQuery} heat={heatMap.get(msg.id)} />
                  </ErrorBoundary>
                </div>
              )
            })}
          </div>
          <RelatedSessionsPanel sessionId={sessionId} />
        </>
      )}
    </div>
  )
}
