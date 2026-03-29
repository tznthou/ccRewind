import { memo } from 'react'
import type { Message } from '../../../shared/types'
import MarkdownRenderer from './MarkdownRenderer'
import ToolBlock from './ToolBlock'
import { formatTime } from '../../utils/formatTime'
import styles from './MessageBubble.module.css'

interface MessageBubbleProps {
  message: Message
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

export default memo(function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isSystem = message.type === 'queue-operation'
  const toolBlocks = extractToolBlocks(message.contentJson)

  // last-prompt 不顯示
  if (message.type === 'last-prompt') return null

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
    <div className={`${styles.bubble} ${isUser ? styles.user : styles.assistant}`}>
      <div className={styles.header}>
        <span className={styles.role}>{isUser ? 'User' : 'Assistant'}</span>
        <span className={styles.time}>{formatTime(message.timestamp)}</span>
      </div>

      {message.contentText && (
        <div className={styles.content}>
          {isUser ? (
            <p className={styles.plainText}>{message.contentText}</p>
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
