import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppState, useAppDispatch } from '../../context/AppContext'
import { useSession } from '../../hooks/useSession'
import MessageBubble from './MessageBubble'
import TokenBudgetPanel from '../TokenBudget/TokenBudgetPanel'
import { useTokenHeat } from './TokenHeatGutter'
import styles from './ChatView.module.css'

interface ChatViewProps {
  sessionId: string
}

export default function ChatView({ sessionId }: ChatViewProps) {
  const { messages, loading, error } = useSession(sessionId)
  const { targetMessageId, searchQuery } = useAppState()
  const heatMap = useTokenHeat(messages)
  const dispatch = useAppDispatch()
  const containerRef = useRef<HTMLDivElement>(null)

  // 一般換 session 時 scroll to top
  useEffect(() => {
    if (!targetMessageId) {
      containerRef.current?.parentElement?.scrollTo(0, 0)
    }
  }, [messages, targetMessageId])

  // 搜尋跳轉：targetMessageId 設定後（含同 session 重複點擊），loading 結束時跳轉
  useEffect(() => {
    if (!targetMessageId || loading) return
    dispatch({ type: 'CLEAR_TARGET_MESSAGE' })

    const el = containerRef.current?.querySelector(`[data-message-id="${targetMessageId}"]`)
    if (!(el instanceof HTMLElement)) return

    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.focus({ preventScroll: true })
    el.classList.add(styles.highlightTarget)
    const onEnd = () => {
      el.classList.remove(styles.highlightTarget)
      el.removeEventListener('animationend', onEnd)
    }
    el.addEventListener('animationend', onEnd)

    return () => {
      el.classList.remove(styles.highlightTarget)
      el.removeEventListener('animationend', onEnd)
    }
  }, [targetMessageId, loading, dispatch])

  const [exporting, setExporting] = useState(false)

  const handleExport = useCallback(async () => {
    setExporting(true)
    try {
      await window.api.exportMarkdown(sessionId)
    } finally {
      setExporting(false)
    }
  }, [sessionId])

  if (loading) {
    return <div className={styles.status}>載入對話中...</div>
  }

  if (error) {
    return <div className={styles.error}>錯誤：{error}</div>
  }

  if (messages.length === 0) {
    return <div className={styles.status}>此 Session 沒有訊息</div>
  }

  return (
    <div ref={containerRef} className={styles.chatView}>
      <div className={styles.toolbar}>
        <TokenBudgetPanel sessionId={sessionId} />
        <button
          className={styles.exportButton}
          onClick={handleExport}
          disabled={exporting || messages.length === 0}
        >
          {exporting ? 'Exporting...' : 'Export Markdown'}
        </button>
      </div>
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} searchQuery={searchQuery} heat={heatMap.get(msg.id)} />
      ))}
    </div>
  )
}
