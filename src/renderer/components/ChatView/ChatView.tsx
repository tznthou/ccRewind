import { useEffect, useRef } from 'react'
import { useSession } from '../../hooks/useSession'
import MessageBubble from './MessageBubble'
import styles from './ChatView.module.css'

interface ChatViewProps {
  sessionId: string
}

export default function ChatView({ sessionId }: ChatViewProps) {
  const { messages, loading, error } = useSession(sessionId)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // scroll container 是外層 <main>，即 .chatView 的 parentElement
    containerRef.current?.parentElement?.scrollTo(0, 0)
  }, [messages])

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
        <MessageBubble key={msg.id} message={msg} />
      ))}
    </div>
  )
}
