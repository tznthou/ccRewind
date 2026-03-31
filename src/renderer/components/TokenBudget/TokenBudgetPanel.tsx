import { useCallback, useState } from 'react'
import type { SessionTokenStats } from '../../../shared/types'
import TokenSummaryCard from './TokenSummaryCard'
import ContextGrowthChart from './ContextGrowthChart'
import styles from './TokenBudget.module.css'

interface Props {
  sessionId: string
}

function TokenBudgetInner({ sessionId }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [stats, setStats] = useState<SessionTokenStats | null>(null)
  const [loading, setLoading] = useState(false)

  const handleToggle = useCallback(() => {
    setExpanded(prev => {
      const next = !prev
      if (next && !stats) {
        setLoading(true)
        window.api.getSessionTokenStats(sessionId).then(setStats).finally(() => setLoading(false))
      }
      return next
    })
  }, [sessionId, stats])

  return (
    <div className={styles.panel}>
      <button
        className={styles.toggleButton}
        onClick={handleToggle}
      >
        {expanded ? 'Hide' : 'Show'} Token Budget
      </button>

      {expanded && (
        <div className={styles.panelContent}>
          {loading && <div className={styles.loading}>Loading token stats...</div>}
          {!loading && stats && stats.turns.length === 0 && (
            <div className={styles.empty}>No token data available for this session</div>
          )}
          {!loading && stats && stats.turns.length > 0 && (
            <>
              <TokenSummaryCard stats={stats} />
              <ContextGrowthChart turns={stats.turns} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function TokenBudgetPanel({ sessionId }: Props) {
  return <TokenBudgetInner key={sessionId} sessionId={sessionId} />
}
