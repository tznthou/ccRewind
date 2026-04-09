import { useState, type ReactNode } from 'react'
import { useAppState, useAppDispatch } from '../../context/AppContext'
import { formatTime } from '../../utils/formatTime'
import type { SessionSearchResult, OutcomeStatus } from '../../../shared/types'
import styles from './SearchResults.module.css'

const OUTCOME_LABELS: Record<NonNullable<OutcomeStatus>, string> = {
  committed: 'committed',
  tested: 'tested',
  'in-progress': 'in-progress',
  'quick-qa': 'quick-qa',
}

/** FTS5 snippet sentinel → React <mark> */
function renderSnippet(snippet: string): ReactNode {
  const parts = snippet.split(/(\uE000.*?\uE001)/g)
  return parts.map((part, i) => {
    if (part.startsWith('\uE000') && part.endsWith('\uE001')) {
      return <mark key={i}>{part.slice(1, -1)}</mark>
    }
    return part
  })
}

export default function SessionSearchResults() {
  const { sessionSearchResults, searchQuery, searchHasMore, searchProjectId, searchOptions } = useAppState()
  const dispatch = useAppDispatch()
  const [loading, setLoading] = useState(false)

  const handleLoadMore = async () => {
    setLoading(true)
    try {
      const page = await window.api.searchSessions(searchQuery, searchProjectId, sessionSearchResults.length, searchOptions)
      dispatch({ type: 'APPEND_SESSION_SEARCH_RESULTS', results: page.results, hasMore: page.hasMore })
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  if (sessionSearchResults.length === 0) {
    return (
      <div className={styles.empty}>
        找不到「{searchQuery}」的 session
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.count}>{sessionSearchResults.length} 個 session</div>
      {sessionSearchResults.map((r: SessionSearchResult) => (
        <button
          key={r.sessionId}
          className={styles.group}
          onClick={() => dispatch({ type: 'SELECT_SESSION', sessionId: r.sessionId })}
        >
          <div className={styles.groupHeader}>
            <span className={styles.sessionTitle}>{r.sessionTitle ?? r.sessionId.slice(0, 8)}</span>
            {r.startedAt && <span className={styles.sessionDate}>{formatTime(r.startedAt)}</span>}
            {r.outcomeStatus && <span className={styles.tagBadge}>{OUTCOME_LABELS[r.outcomeStatus]}</span>}
          </div>
          <div className={styles.groupBody}>
            <div className={styles.projectName}>{r.projectName}</div>
            {r.tags && (
              <div className={styles.tagRow}>
                {r.tags.split(',').slice(0, 5).map(tag => (
                  <span key={tag} className={styles.tagBadge}>{tag}</span>
                ))}
              </div>
            )}
            <div className={styles.snippet}>{renderSnippet(r.snippet)}</div>
          </div>
        </button>
      ))}
      {searchHasMore && (
        <button className={styles.loadMore} onClick={handleLoadMore} disabled={loading}>
          {loading ? '載入中...' : '載入更多'}
        </button>
      )}
    </div>
  )
}
