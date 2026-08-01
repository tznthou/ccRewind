import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { isDisplayableMessage } from './contentBlocks'
import ErrorBoundary from '../ErrorBoundary/ErrorBoundary'
import { MessageErrorFallback } from '../ErrorBoundary/ErrorFallback'
import styles from './ChatView.module.css'

interface ChatViewProps {
  sessionId: string
}

/**
 * 目標訊息 render 出來前最多等多久。
 *
 * 實測正常情況只要 1-2 幀：scrollToIndex 帶動的 re-render 一到位就找得到。
 * 這個上限是保險——動態高度下 virtual-core 會逐幀重算落點直到穩定（見其
 * reconcileScroll，同樣以 5000ms 為界），落點若需要多輪收斂，這裡不該比它早放棄。
 */
const MAX_LOCATE_MS = 5000
/** 捲動安定的兜底時間；沒有實際捲動時 scrollend 不會發生 */
const SCROLL_SETTLE_MS = 800

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

  // 只有會渲染出東西的訊息才進虛擬列表。不渲染的訊息（last-prompt、純 bookkeeping）
  // 若留在 count 裡，在被量到 0 之前都佔著 estimateSize，捲軸會虛胖、捲動反覆修正。
  const displayMessages = useMemo(() => messages.filter(isDisplayableMessage), [messages])

  // 虛擬列表前面還有 panel / toolbar / fileChips，需要告訴 virtualizer 列表起點偏移
  const [scrollMargin, setScrollMargin] = useState(0)

  // 必須是穩定 reference：virtual-core 把 getItemKey 放進 getMeasurementOptions 的
  // memo 依賴，inline 函式會讓整份 measurement 每次 render 重算（O(count)）
  const getItemKey = useCallback(
    (index: number) => displayMessages[index]?.id ?? index,
    [displayMessages],
  )

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual 的 useVirtualizer 跟 React Compiler memoization 不相容（third-party API design 限制）
  const virtualizer = useVirtualizer({
    count: displayMessages.length,
    getScrollElement,
    // 實測本機資料：訊息高度中位數與 p90 都是 96px（最小 71、最大 2714）
    estimateSize: () => 96,
    overscan: 8,
    scrollMargin,
    getItemKey,
  })

  // 換 session 時若無搜尋目標就 scroll to top；用 ref 追蹤前一個 sessionId 避免 targetMessageId 變化時誤觸（會蓋掉 search scroll）
  const prevSessionIdRef = useRef<string | null>(null)
  useEffect(() => {
    const sessionChanged = prevSessionIdRef.current !== sessionId
    prevSessionIdRef.current = sessionId
    if (sessionChanged && !targetMessageId) {
      getScrollElement()?.scrollTo(0, 0)
    }
  }, [sessionId, targetMessageId, getScrollElement])

  // 跳轉流程的生命週期用 token 控制，不用 effect cleanup。
  // 原因：effect 一開頭就得 dispatch CLEAR_TARGET_MESSAGE（否則同一則訊息無法重複跳轉），
  // 而 targetMessageId 正是本 effect 的 dep——dispatch 會立刻讓 effect 重跑並執行 cleanup。
  // 取消若綁在 cleanup 上，後面每個非同步步驟都會被自己取消掉（實測 highlight 從未觸發、焦點留在 body）。
  const navTokenRef = useRef(0)
  useEffect(() => {
    // 換 session 作廢進行中的跳轉
    navTokenRef.current += 1
  }, [sessionId])

  // 搜尋跳轉：targetMessageId 設定後（含同 session 重複點擊），loading 結束時跳轉。
  // 虛擬化後目標訊息不一定在 DOM 裡，必須先 scrollToIndex 把它帶進可視範圍再操作。
  useEffect(() => {
    if (!targetMessageId || loading) return
    const index = displayMessages.findIndex(m => m.id === targetMessageId)
    if (index < 0) return
    dispatch({ type: 'CLEAR_TARGET_MESSAGE' })

    const token = ++navTokenRef.current
    const alive = () => navTokenRef.current === token

    // 長列表刻意用預設的瞬間捲動：跨越數萬 px 的 smooth 捲動既慢又會讓量測反覆修正
    virtualizer.scrollToIndex(index, { align: 'center' })

    const startedAt = performance.now()
    const locate = () => {
      if (!alive()) return
      const el = containerRef.current?.querySelector(`[data-message-id="${targetMessageId}"]`)
      if (!(el instanceof HTMLElement)) {
        if (performance.now() - startedAt < MAX_LOCATE_MS) requestAnimationFrame(locate)
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
      requestAnimationFrame(() => {
        if (!alive()) return
        const mark = el.querySelector<HTMLElement>('mark[data-search-match="true"]')
        if (!mark) return
        const details = mark.closest('details')
        if (details && !details.open) details.open = true
        requestAnimationFrame(() => {
          if (alive()) mark.scrollIntoView({ behavior: 'smooth', block: 'center' })
        })
      })

      // 捲動會讓 virtualizer 重新渲染、目標元素 remount，先前的 focus 會被吃掉。
      // 等捲動停下來再補一次，並重新查詢元素（原本的 node 可能已不在）。
      const scroller = getScrollElement()
      let settleTimer = 0
      const refocus = () => {
        clearTimeout(settleTimer)
        scroller?.removeEventListener('scrollend', refocus)
        if (!alive()) return
        // 使用者可能已經把焦點移去搜尋框繼續打字，別硬搶回來
        const active = document.activeElement
        if (active && active !== document.body && !containerRef.current?.contains(active)) return
        const current = containerRef.current?.querySelector(`[data-message-id="${targetMessageId}"]`)
        if (current instanceof HTMLElement) current.focus({ preventScroll: true })
      }
      scroller?.addEventListener('scrollend', refocus)
      settleTimer = window.setTimeout(refocus, SCROLL_SETTLE_MS)
    }
    requestAnimationFrame(locate)
  }, [targetMessageId, loading, dispatch, displayMessages, virtualizer, getScrollElement])

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

  // 列表上方的 SubagentPanel / TasksPanel / TokenBudgetPanel 會非同步長出內容、也能展開收合，
  // 這些都不經過 ChatView 的 state，靠列舉 dep 追不到（實測展開 TokenBudget 會讓起點位移 609px）。
  // 改用 ResizeObserver 直接看尺寸變化。
  useLayoutEffect(() => {
    const scroller = getScrollElement()
    const container = containerRef.current
    if (!scroller || !container) return
    const measure = () => {
      const list = listRef.current
      if (!list) return
      const offset = list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
      setScrollMargin(prev => (Math.abs(prev - offset) > 1 ? offset : prev))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    observer.observe(scroller)
    return () => observer.disconnect()
    // loading / 訊息數也要進 dep：切 session 時這個 effect 會在 listRef 還沒掛載前先跑一次，
    // 那次 measure() 什麼也量不到；若新舊 session 的外框尺寸剛好相同，ResizeObserver 也不會補觸發
  }, [getScrollElement, sessionId, loading, displayMessages.length])

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
              const msg = displayMessages[virtualItem.index]
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
