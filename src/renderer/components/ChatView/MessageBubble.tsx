import { memo } from 'react'
import type { Message } from '../../../shared/types'
import MarkdownRenderer from './MarkdownRenderer'
import ToolBlock from './ToolBlock'
import { formatTime } from '../../utils/formatTime'
import { highlightText } from '../../utils/highlightText'
import { getHeatProps, type HeatInfo } from './TokenHeatGutter'
import styles from './MessageBubble.module.css'

interface MessageBubbleProps {
  message: Message
  searchQuery?: string
  heat?: HeatInfo
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

export default memo(function MessageBubble({ message, searchQuery = '', heat }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isSystem = message.type === 'queue-operation'
  const toolBlocks = extractToolBlocks(message.contentJson)
  const heatProps = !isUser ? getHeatProps(heat) : undefined

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
    <div className={`${styles.bubble} ${isUser ? styles.user : styles.assistant}`} data-message-id={message.id} data-heat={heatProps?.attr} tabIndex={-1} style={heatProps?.style}>
      <div className={styles.header}>
        <span className={styles.role}>{isUser ? 'User' : 'Assistant'}</span>
        <span className={styles.time}>{formatTime(message.timestamp)}</span>
      </div>

      {message.contentText && (
        <div className={styles.content}>
          {isUser ? (
            <p className={styles.plainText}>{highlightText(message.contentText, searchQuery)}</p>
          ) : (
            <MarkdownRenderer content={message.contentText} searchQuery={searchQuery} />
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
            searchQuery={searchQuery}
          />
        ) : (
          <ToolBlock
            key={`result-${i}`}
            toolName={block.tool_use_id.slice(0, 12)}
            content={typeof block.content === 'string' ? block.content : JSON.stringify(block.content, null, 2)}
            type="tool_result"
            searchQuery={searchQuery}
          />
        ),
      )}
    </div>
  )
})
