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
  const [error, setError] = useState<string | null>(null)

  const handleToggle = useCallback(() => {
    setExpanded(prev => {
      const next = !prev
      if (next && !stats && !error) {
        setLoading(true)
        window.api.getSessionTokenStats(sessionId)
          .then(setStats)
          .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load token stats'))
          .finally(() => setLoading(false))
      }
      return next
    })
  }, [sessionId, stats, error])

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
          {!loading && error && (
            <div className={styles.error}>{error}</div>
          )}
          {!loading && !error && stats && stats.turns.length === 0 && (
            <div className={styles.empty}>No token data available for this session</div>
          )}
          {!loading && !error && stats && stats.turns.length > 0 && (
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
