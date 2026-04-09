import { useState, useEffect, useMemo, type KeyboardEvent } from 'react'
import { useAppState, useAppDispatch } from '../../context/AppContext'
import type { SearchScope, SearchOptions, SearchSortBy } from '../../../shared/types'
import styles from './SearchBar.module.css'

type DateRange = 'all' | '7d' | '30d' | '90d'

const DATE_RANGE_LABELS: Record<DateRange, string> = {
  all: '不限',
  '7d': '7 天',
  '30d': '30 天',
  '90d': '90 天',
}

function dateRangeToFrom(range: DateRange): string | undefined {
  if (range === 'all') return undefined
  const days = parseInt(range)
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

export default function SearchBar() {
  const { selectedProjectId, searchQuery } = useAppState()
  const dispatch = useAppDispatch()
  const [input, setInput] = useState(searchQuery)
  const [searching, setSearching] = useState(false)
  const [scope, setScope] = useState<'all' | 'project'>('all')
  const [searchType, setSearchType] = useState<SearchScope>('messages')
  const [dateRange, setDateRange] = useState<DateRange>('all')
  const [sortBy, setSortBy] = useState<SearchSortBy>('rank')

  // 外部清搜尋（如切換專案）時同步 input
  useEffect(() => { setInput(searchQuery) }, [searchQuery])

  const searchOptions = useMemo((): SearchOptions | undefined => {
    const dateFrom = dateRangeToFrom(dateRange)
    if (!dateFrom && sortBy === 'rank') return undefined
    return { dateFrom, sortBy }
  }, [dateRange, sortBy])

  const handleKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && input.trim()) {
      const projectId = scope === 'project' ? selectedProjectId : null
      setSearching(true)
      try {
        if (searchType === 'sessions') {
          const page = await window.api.searchSessions(input.trim(), projectId, undefined, searchOptions)
          dispatch({ type: 'SET_SESSION_SEARCH', query: input.trim(), results: page.results, hasMore: page.hasMore, projectId, options: searchOptions })
        } else {
          const page = await window.api.search(input.trim(), projectId, undefined, searchOptions)
          dispatch({ type: 'SET_SEARCH', query: input.trim(), results: page.results, hasMore: page.hasMore, projectId, options: searchOptions })
        }
      } catch {
        if (searchType === 'sessions') {
          dispatch({ type: 'SET_SESSION_SEARCH', query: input.trim(), results: [], hasMore: false, projectId })
        } else {
          dispatch({ type: 'SET_SEARCH', query: input.trim(), results: [], hasMore: false, projectId })
        }
      } finally {
        setSearching(false)
      }
    }
    if (e.key === 'Escape') {
      setInput('')
      dispatch({ type: 'CLEAR_SEARCH' })
    }
  }

  const handleClear = () => {
    setInput('')
    dispatch({ type: 'CLEAR_SEARCH' })
  }

  return (
    <div className={styles.container}>
      <div className={styles.inputRow}>
        <input
          className={styles.input}
          type="text"
          placeholder={searching ? '搜尋中...' : searchType === 'sessions' ? '搜尋標籤、檔案、標題、意圖...' : '搜尋對話內容...'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={searching}
        />
        {searchQuery && (
          <button className={styles.clearBtn} onClick={handleClear} aria-label="清除搜尋">
            &times;
          </button>
        )}
      </div>
      <div className={styles.scopeRow}>
        <label className={styles.scopeLabel}>
          <input
            type="radio"
            name="search-scope"
            checked={scope === 'all'}
            onChange={() => setScope('all')}
          />
          全部專案
        </label>
        <label className={styles.scopeLabel}>
          <input
            type="radio"
            name="search-scope"
            checked={scope === 'project'}
            onChange={() => setScope('project')}
            disabled={!selectedProjectId}
          />
          目前專案
        </label>
        <span className={styles.separator}>|</span>
        <label className={styles.scopeLabel}>
          <input
            type="radio"
            name="search-type"
            checked={searchType === 'messages'}
            onChange={() => setSearchType('messages')}
          />
          對話
        </label>
        <label className={styles.scopeLabel}>
          <input
            type="radio"
            name="search-type"
            checked={searchType === 'sessions'}
            onChange={() => setSearchType('sessions')}
          />
          標籤/檔案
        </label>
      </div>
      <div className={styles.filterRow}>
        {(Object.keys(DATE_RANGE_LABELS) as DateRange[]).map(range => (
          <button
            key={range}
            className={dateRange === range ? styles.filterBtnActive : styles.filterBtn}
            onClick={() => setDateRange(range)}
          >
            {DATE_RANGE_LABELS[range]}
          </button>
        ))}
        <span className={styles.separator}>|</span>
        <button
          className={sortBy === 'rank' ? styles.filterBtnActive : styles.filterBtn}
          onClick={() => setSortBy('rank')}
        >
          相關性
        </button>
        <button
          className={sortBy === 'date' ? styles.filterBtnActive : styles.filterBtn}
          onClick={() => setSortBy('date')}
        >
          最新
        </button>
      </div>
    </div>
  )
}
