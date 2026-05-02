import { useState, useEffect, useCallback, useRef, type KeyboardEvent } from 'react'
import { useAppState, useAppDispatch } from '../../context/AppContext'
import { useI18n } from '../../i18n/useI18n'
import type { MessageKey } from '../../i18n/messages'
import type { SearchScope, SearchOptions, SearchSortBy } from '../../../shared/types'
import styles from './SearchBar.module.css'

type DateRange = 'all' | '7d' | '30d' | '90d'

const DATE_RANGE_KEYS: Record<DateRange, MessageKey> = {
  all: 'sidebar.searchBar.dateRange.all',
  '7d': 'sidebar.searchBar.dateRange.7d',
  '30d': 'sidebar.searchBar.dateRange.30d',
  '90d': 'sidebar.searchBar.dateRange.90d',
}

const DATE_RANGE_DAYS: Record<Exclude<DateRange, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
}

function buildSearchOptions(dateRange: DateRange, sortBy: SearchSortBy): SearchOptions | undefined {
  let dateFrom: string | undefined
  if (dateRange !== 'all') {
    const d = new Date()
    d.setDate(d.getDate() - DATE_RANGE_DAYS[dateRange])
    dateFrom = d.toISOString().slice(0, 10)
  }
  if (!dateFrom && sortBy === 'rank') return undefined
  return { dateFrom, sortBy }
}

export default function SearchBar() {
  const { selectedProjectId, searchQuery } = useAppState()
  const dispatch = useAppDispatch()
  const { t } = useI18n()
  const [input, setInput] = useState(searchQuery)
  const [searching, setSearching] = useState(false)
  const [scope, setScope] = useState<'all' | 'project'>('all')
  const [searchType, setSearchType] = useState<SearchScope>('messages')
  const [dateRange, setDateRange] = useState<DateRange>('all')
  const [sortBy, setSortBy] = useState<SearchSortBy>('rank')
  const searchTypeRef = useRef(searchType)
  const scopeRef = useRef(scope)
  const searchSeqRef = useRef(0)
  searchTypeRef.current = searchType
  scopeRef.current = scope

  // 外部清搜尋（如切換專案）時同步 input
  useEffect(() => { setInput(searchQuery) }, [searchQuery])

  const announceResult = useCallback((type: SearchScope, count: number, groups: number, q: string) => {
    if (count === 0) {
      dispatch({ type: 'ANNOUNCE', message: t('a11y.announcement.searchEmpty', { query: q }) })
    } else if (type === 'sessions') {
      dispatch({ type: 'ANNOUNCE', message: t('a11y.announcement.searchComplete.sessions', { count }) })
    } else {
      dispatch({ type: 'ANNOUNCE', message: t('a11y.announcement.searchComplete.messages', { count, groups }) })
    }
  }, [dispatch, t])

  const executeSearch = useCallback(async (q: string, opts: SearchOptions | undefined) => {
    if (!q) return
    const projectId = scopeRef.current === 'project' ? selectedProjectId : null
    const type = searchTypeRef.current
    // monotonic seq：filter 連按時，舊請求的 promise resolve 若晚到必須整個丟棄
    // （否則 stale results 覆蓋 visible UI 且 announce 錯誤計數給 SR）
    const seq = ++searchSeqRef.current
    setSearching(true)
    try {
      if (type === 'sessions') {
        const page = await window.api.searchSessions(q, projectId, undefined, opts)
        if (seq !== searchSeqRef.current) return
        dispatch({ type: 'SET_SESSION_SEARCH', query: q, results: page.results, hasMore: page.hasMore, projectId, options: opts })
        announceResult('sessions', page.results.length, 0, q)
      } else {
        const page = await window.api.search(q, projectId, undefined, opts)
        if (seq !== searchSeqRef.current) return
        dispatch({ type: 'SET_SEARCH', query: q, results: page.results, hasMore: page.hasMore, projectId, options: opts })
        const groupSet = new Set(page.results.map(r => r.sessionId))
        announceResult('messages', page.results.length, groupSet.size, q)
      }
    } catch {
      if (seq !== searchSeqRef.current) return
      if (type === 'sessions') {
        dispatch({ type: 'SET_SESSION_SEARCH', query: q, results: [], hasMore: false, projectId })
      } else {
        dispatch({ type: 'SET_SEARCH', query: q, results: [], hasMore: false, projectId })
      }
      announceResult(type, 0, 0, q)
    } finally {
      if (seq === searchSeqRef.current) setSearching(false)
    }
  }, [selectedProjectId, dispatch, announceResult])

  // filter 變更時，若已有搜尋 query 則自動重新搜尋
  useEffect(() => {
    if (searchQuery) {
      executeSearch(searchQuery, buildSearchOptions(dateRange, sortBy))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在 filter 變更時觸發
  }, [dateRange, sortBy])

  const handleKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && input.trim()) {
      executeSearch(input.trim(), buildSearchOptions(dateRange, sortBy))
    } else if (e.key === 'Escape') {
      setInput('')
      dispatch({ type: 'CLEAR_SEARCH' })
    } else if (e.key === 'ArrowDown') {
      // 焦點移到搜尋結果列表（若已渲染；同時間只會有一個 search results listbox）
      const listbox = document.querySelector<HTMLElement>('[data-search-results-listbox="true"]')
      if (listbox) {
        e.preventDefault()
        listbox.focus()
      }
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
          placeholder={
            searching
              ? t('sidebar.searchBar.placeholder.searching')
              : searchType === 'sessions'
                ? t('sidebar.searchBar.placeholder.sessions')
                : t('sidebar.searchBar.placeholder.messages')
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={searching}
        />
        {searchQuery && (
          <button className={styles.clearBtn} onClick={handleClear} aria-label={t('sidebar.searchBar.aria.clear')}>
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
          {t('sidebar.searchBar.scope.all')}
        </label>
        <label className={styles.scopeLabel}>
          <input
            type="radio"
            name="search-scope"
            checked={scope === 'project'}
            onChange={() => setScope('project')}
            disabled={!selectedProjectId}
          />
          {t('sidebar.searchBar.scope.current')}
        </label>
      </div>
      <div className={styles.scopeRow}>
        <label className={styles.scopeLabel}>
          <input
            type="radio"
            name="search-type"
            checked={searchType === 'messages'}
            onChange={() => setSearchType('messages')}
          />
          {t('sidebar.searchBar.type.messages')}
        </label>
        <label className={styles.scopeLabel}>
          <input
            type="radio"
            name="search-type"
            checked={searchType === 'sessions'}
            onChange={() => setSearchType('sessions')}
          />
          {t('sidebar.searchBar.type.sessions')}
        </label>
      </div>
      <div className={styles.filterRow}>
        {(Object.keys(DATE_RANGE_KEYS) as DateRange[]).map(range => (
          <button
            key={range}
            className={dateRange === range ? styles.filterBtnActive : styles.filterBtn}
            onClick={() => setDateRange(range)}
          >
            {t(DATE_RANGE_KEYS[range])}
          </button>
        ))}
        <span className={styles.separator}>|</span>
        <button
          className={sortBy === 'rank' ? styles.filterBtnActive : styles.filterBtn}
          onClick={() => setSortBy('rank')}
        >
          {t('sidebar.searchBar.sort.rank')}
        </button>
        <button
          className={sortBy === 'date' ? styles.filterBtnActive : styles.filterBtn}
          onClick={() => setSortBy('date')}
        >
          {t('sidebar.searchBar.sort.date')}
        </button>
      </div>
    </div>
  )
}
