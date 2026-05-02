import { useState } from 'react'
import { useAppState, useAppDispatch } from '../../context/AppContext'
import { useI18n } from '../../i18n/useI18n'
import { useListboxKeyNav } from '../../hooks/useListboxKeyNav'
import { formatTime } from '../../utils/formatTime'
import { renderSnippet } from '../../utils/renderSnippet'
import SearchSyntaxHints from './SearchSyntaxHints'
import type { SessionSearchResult } from '../../../shared/types'
import styles from './SearchResults.module.css'

export default function SessionSearchResults() {
  const { sessionSearchResults, searchQuery, searchHasMore, searchProjectId, searchOptions } = useAppState()
  const dispatch = useAppDispatch()
  const { t } = useI18n()
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

  const { listboxProps, getOptionProps, isActive, setActiveIndex } = useListboxKeyNav<SessionSearchResult>({
    items: sessionSearchResults,
    getItemId: (r) => r.sessionId,
    onActivate: (r) => dispatch({ type: 'NAVIGATE_TO_SESSION', projectId: r.projectId, sessionId: r.sessionId }),
    dispatchOnArrow: false,
  })

  if (sessionSearchResults.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>
          {t('sidebar.sessionSearchResults.empty', { query: searchQuery })}
        </div>
        <SearchSyntaxHints variant="sessions" />
      </div>
    )
  }

  return (
    <div
      className={styles.container}
      aria-label={t('sidebar.section.searchResults')}
      data-search-results-listbox="true"
      {...listboxProps}
    >
      <div className={styles.count}>{t('sidebar.sessionSearchResults.count', { count: sessionSearchResults.length })}</div>
      {sessionSearchResults.map((r: SessionSearchResult, i) => {
        const active = isActive(i)
        return (
          <button
            key={r.sessionId}
            className={`${styles.group} ${active ? styles.itemActive : ''}`}
            {...getOptionProps(r)}
            onClick={() => {
              setActiveIndex(i)
              dispatch({ type: 'NAVIGATE_TO_SESSION', projectId: r.projectId, sessionId: r.sessionId })
            }}
          >
            <div className={styles.groupHeader}>
              <span className={styles.sessionTitle}>{r.sessionTitle ?? r.sessionId.slice(0, 8)}</span>
              {r.startedAt && <span className={styles.sessionDate}>{formatTime(r.startedAt)}</span>}
              {r.outcomeStatus && <span className={styles.tagBadge}>{r.outcomeStatus}</span>}
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
        )
      })}
      {searchHasMore && (
        <button className={styles.loadMore} onClick={handleLoadMore} disabled={loading}>
          {loading ? t('common.loading') : t('common.loadMore')}
        </button>
      )}
    </div>
  )
}
