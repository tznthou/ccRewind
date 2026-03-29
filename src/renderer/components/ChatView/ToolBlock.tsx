import styles from './ToolBlock.module.css'

interface ToolBlockProps {
  toolName: string
  content: string
  type: 'tool_use' | 'tool_result'
}

export default function ToolBlock({ toolName, content, type }: ToolBlockProps) {
  const label = type === 'tool_use' ? `Tool: ${toolName}` : `Result: ${toolName}`

  return (
    <details className={styles.toolBlock}>
      <summary className={styles.summary}>
        <span className={styles.icon} aria-hidden="true">{type === 'tool_use' ? '🔧' : '📋'}</span>
        <span className={styles.label}>{label}</span>
      </summary>
      <pre className={styles.content}>{content}</pre>
    </details>
  )
}
