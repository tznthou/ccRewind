import { useState, useMemo, useEffect, type ReactNode } from 'react'
import { useAppState, useAppDispatch } from '../../context/AppContext'
import { formatTime } from '../../utils/formatTime'
import type { SearchResult, GroupedSearchResult } from '../../../shared/types'
import styles from './SearchResults.module.css'

/** FTS5 snippet 使用 Unicode sentinel \uE000/\uE001 標記匹配位置，轉為 React <mark> 元素 */
function renderSnippet(snippet: string): ReactNode {
  const parts = snippet.split(/(\uE000.*?\uE001)/g)
  return parts.map((part, i) => {
    if (part.startsWith('\uE000') && part.endsWith('\uE001')) {
      return <mark key={i}>{part.slice(1, -1)}</mark>
    }
    return part
  })
}

/** 按 sessionId 分組，保持 rank 排序 */
function groupSearchResults(results: SearchResult[]): GroupedSearchResult[] {
  const groups: GroupedSearchResult[] = []
  const seen = new Map<string, number>() // sessionId → index in groups

  for (const r of results) {
    const idx = seen.get(r.sessionId)
    if (idx !== undefined) {
      groups[idx].matches.push({ messageId: r.messageId, snippet: r.snippet, timestamp: r.timestamp })
    } else {
      seen.set(r.sessionId, groups.length)
      groups.push({
        sessionId: r.sessionId,
        sessionTitle: r.sessionTitle,
        projectId: r.projectId,
        projectName: r.projectName,
        matches: [{ messageId: r.messageId, snippet: r.snippet, timestamp: r.timestamp }],
      })
    }
  }

  return groups
}

export default function SearchResults() {
  const { searchResults, searchQuery, searchHasMore, searchProjectId } = useAppState()
  const dispatch = useAppDispatch()
  const [loading, setLoading] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const groups = useMemo(() => groupSearchResults(searchResults), [searchResults])

  useEffect(() => { setCollapsedGroups(new Set()) }, [searchQuery])

  const toggleGroup = (sessionId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }

  const handleLoadMore = async () => {
    setLoading(true)
    try {
      const page = await window.api.search(searchQuery, searchProjectId, searchResults.length)
      dispatch({ type: 'APPEND_SEARCH_RESULTS', results: page.results, hasMore: page.hasMore })
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  if (searchResults.length === 0) {
    return (
      <div className={styles.empty}>
        找不到「{searchQuery}」的結果
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.count}>{searchResults.length} 筆結果（{groups.length} 個 session）</div>
      {groups.map((g) => {
        const collapsed = collapsedGroups.has(g.sessionId)
        return (
          <div key={g.sessionId} className={styles.group}>
            <button className={styles.groupHeader} onClick={() => toggleGroup(g.sessionId)}>
              <span className={styles.expandIcon}>{collapsed ? '▸' : '▾'}</span>
              <span className={styles.sessionTitle}>{g.sessionTitle ?? g.sessionId.slice(0, 8)}</span>
              <span className={styles.matchCount}>{g.matches.length}</span>
            </button>
            {!collapsed && (
              <div className={styles.groupBody}>
                <div className={styles.projectName}>{g.projectName}</div>
                {g.matches.map((m) => (
                  <button
                    key={m.messageId}
                    className={styles.item}
                    onClick={() => dispatch({ type: 'NAVIGATE_TO_RESULT', sessionId: g.sessionId, messageId: m.messageId })}
                  >
                    <div className={styles.snippet}>{renderSnippet(m.snippet)}</div>
                    {m.timestamp && <span className={styles.time}>{formatTime(m.timestamp)}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
      {searchHasMore && (
        <button className={styles.loadMore} onClick={handleLoadMore} disabled={loading}>
          {loading ? '載入中...' : '載入更多'}
        </button>
      )}
    </div>
  )
}
