import { useMemo } from 'react'
import { highlightText } from '../../utils/highlightText'
import styles from './ToolBlock.module.css'

interface ToolBlockProps {
  toolName: string
  content: string
  type: 'tool_use' | 'tool_result'
  searchQuery?: string
}

export default function ToolBlock({ toolName, content, type, searchQuery }: ToolBlockProps) {
  const label = type === 'tool_use' ? `Tool: ${toolName}` : `Result: ${toolName}`
  const rendered = useMemo(() => highlightText(content, searchQuery ?? ''), [content, searchQuery])

  return (
    <details className={styles.toolBlock}>
      <summary className={styles.summary}>
        <span className={styles.icon} aria-hidden="true">{type === 'tool_use' ? '🔧' : '📋'}</span>
        <span className={styles.label}>{label}</span>
      </summary>
      <pre className={styles.content}>{rendered}</pre>
    </details>
  )
}
