import { useEffect, useRef } from 'react'
import { useAppState, useAppDispatch } from '../../context/AppContext'
import { useSession } from '../../hooks/useSession'
import MessageBubble from './MessageBubble'
import styles from './ChatView.module.css'

interface ChatViewProps {
  sessionId: string
}

export default function ChatView({ sessionId }: ChatViewProps) {
  const { messages, loading, error } = useSession(sessionId)
  const { targetMessageId, searchQuery } = useAppState()
  const dispatch = useAppDispatch()
  const containerRef = useRef<HTMLDivElement>(null)
  const pendingScrollRef = useRef<number | null>(null)

  // 記住 targetMessageId，在 effect 中寫 ref（避免 render phase 寫 ref）
  useEffect(() => {
    if (targetMessageId) {
      pendingScrollRef.current = targetMessageId
      dispatch({ type: 'CLEAR_TARGET_MESSAGE' })
    }
  }, [targetMessageId, dispatch])

  // 一般換 session 時 scroll to top
  useEffect(() => {
    if (!pendingScrollRef.current) {
      containerRef.current?.parentElement?.scrollTo(0, 0)
    }
  }, [messages])

  // 搜尋跳轉：loading 結束後 scroll to target + pulse
  useEffect(() => {
    const mid = pendingScrollRef.current
    if (!mid || loading) return
    pendingScrollRef.current = null

    const el = containerRef.current?.querySelector(`[data-message-id="${mid}"]`)
    if (!(el instanceof HTMLElement)) return

    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
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
  }, [loading])

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
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} searchQuery={searchQuery} />
      ))}
    </div>
  )
}
