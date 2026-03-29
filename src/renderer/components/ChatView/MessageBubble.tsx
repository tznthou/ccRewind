import { memo, type ReactNode } from 'react'
import type { Message } from '../../../shared/types'
import MarkdownRenderer from './MarkdownRenderer'
import ToolBlock from './ToolBlock'
import { formatTime } from '../../utils/formatTime'
import styles from './MessageBubble.module.css'

interface MessageBubbleProps {
  message: Message
  searchQuery?: string
}

function highlightText(text: string, query: string): ReactNode {
  if (!query) return text
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(${escaped})`, 'gi')
  const parts = text.split(regex)
  if (parts.length === 1) return text
  const lower = query.toLowerCase()
  return parts.map((part, i) =>
    part.toLowerCase() === lower ? <mark key={i}>{part}</mark> : part,
  )
}

interface ToolUseBlock {
  type: 'tool_use'
  name: string
  input: unknown
}

interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: unknown
}

type ContentBlock = ToolUseBlock | ToolResultBlock

function extractToolBlocks(contentJson: string | null): ContentBlock[] {
  if (!contentJson) return []
  try {
    const parsed = JSON.parse(contentJson)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (block: unknown): block is ContentBlock => {
        if (block == null || typeof block !== 'object') return false
        const b = block as Record<string, unknown>
        if (b.type === 'tool_use') return typeof b.name === 'string'
        if (b.type === 'tool_result') return typeof b.tool_use_id === 'string'
        return false
      },
    )
  } catch {
    return []
  }
}

export default memo(function MessageBubble({ message, searchQuery = '' }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isSystem = message.type === 'queue-operation'
  const toolBlocks = extractToolBlocks(message.contentJson)

  // last-prompt 不顯示
  if (message.type === 'last-prompt') return null

  // 無可顯示內容（如僅含 thinking blocks）→ 不渲染空氣泡
  if (!message.contentText && toolBlocks.length === 0) return null

  // queue-operation 顯示為系統提示
  if (isSystem) {
    return (
      <div className={styles.systemMessage}>
        <span className={styles.systemLabel}>系統</span>
        <span className={styles.systemText}>
          {message.contentText?.slice(0, 200) ?? '(queue operation)'}
        </span>
      </div>
    )
  }

  return (
    <div className={`${styles.bubble} ${isUser ? styles.user : styles.assistant}`} data-message-id={message.id}>
      <div className={styles.header}>
        <span className={styles.role}>{isUser ? 'User' : 'Assistant'}</span>
        <span className={styles.time}>{formatTime(message.timestamp)}</span>
      </div>

      {message.contentText && (
        <div className={styles.content}>
          {isUser ? (
            <p className={styles.plainText}>{highlightText(message.contentText, searchQuery)}</p>
          ) : (
            <MarkdownRenderer content={message.contentText} />
          )}
        </div>
      )}

      {toolBlocks.map((block, i) =>
        block.type === 'tool_use' ? (
          <ToolBlock
            key={`tool-${i}`}
            toolName={block.name}
            content={JSON.stringify(block.input, null, 2)}
            type="tool_use"
          />
        ) : (
          <ToolBlock
            key={`result-${i}`}
            toolName={block.tool_use_id.slice(0, 12)}
            content={typeof block.content === 'string' ? block.content : JSON.stringify(block.content, null, 2)}
            type="tool_result"
          />
        ),
      )}
    </div>
  )
})
