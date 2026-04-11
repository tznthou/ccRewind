import { useState, useEffect } from 'react'
import type { SubagentSession } from '../../../shared/types'
import { useAppDispatch } from '../../context/AppContext'
import styles from './ChatView.module.css'

interface Props {
  sessionId: string
}

export default function SubagentPanel({ sessionId }: Props) {
  const dispatch = useAppDispatch()

  const slashIndex = sessionId.indexOf('/')
  const isSubagent = slashIndex > 0
  const parentId = isSubagent ? sessionId.substring(0, slashIndex) : null

  // Query parent's subagent list:
  // main session → shows children chips
  // subagent → finds self to get agentType
  const [subagents, setSubagents] = useState<SubagentSession[]>([])

  useEffect(() => {
    const queryId = parentId ?? sessionId
    setSubagents([])
    let cancelled = false
    window.api.getSubagentSessions(queryId)
      .then(data => { if (!cancelled) setSubagents(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [sessionId, parentId])

  // Subagent breadcrumb mode — always render (no loading gate)
  if (isSubagent) {
    const self = subagents.find(s => s.id === sessionId)
    return (
      <div className={styles.subagentBreadcrumb}>
        <button
          className={styles.subagentBack}
          onClick={() => dispatch({ type: 'SELECT_SESSION', sessionId: parentId! })}
        >
          &larr; Back to parent
        </button>
        {self?.agentType && (
          <span className={styles.subagentTypeBadge}>{self.agentType}</span>
        )}
      </div>
    )
  }

  // Main session — show children chips (hide if none)
  if (subagents.length === 0) return null

  return (
    <div className={styles.subagentChips}>
      <span className={styles.subagentLabel}>Subagents</span>
      {subagents.map(sub => (
        <button
          key={sub.id}
          className={styles.subagentChip}
          onClick={() => dispatch({ type: 'SELECT_SESSION', sessionId: sub.id })}
          title={[
            sub.agentType,
            `${sub.messageCount} msgs`,
            sub.startedAt && new Date(sub.startedAt).toLocaleString('zh-TW'),
          ].filter(Boolean).join(' \u00b7 ')}
        >
          {sub.agentType || 'agent'}
          <span className={styles.subagentCount}>{sub.messageCount}</span>
        </button>
      ))}
    </div>
  )
}
