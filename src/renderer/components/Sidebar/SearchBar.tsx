import { useState, useEffect, type KeyboardEvent } from 'react'
import { useAppState, useAppDispatch } from '../../context/AppContext'
import styles from './SearchBar.module.css'

export default function SearchBar() {
  const { selectedProjectId, searchQuery } = useAppState()
  const dispatch = useAppDispatch()
  const [input, setInput] = useState(searchQuery)
  const [searching, setSearching] = useState(false)
  const [scope, setScope] = useState<'all' | 'project'>('all')

  // 外部清搜尋（如切換專案）時同步 input
  useEffect(() => { setInput(searchQuery) }, [searchQuery])

  const handleKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && input.trim()) {
      const projectId = scope === 'project' ? selectedProjectId : null
      setSearching(true)
      try {
        const page = await window.api.search(input.trim(), projectId)
        dispatch({ type: 'SET_SEARCH', query: input.trim(), results: page.results, hasMore: page.hasMore, projectId })
      } catch {
        // FTS5 查詢語法錯誤等 — 視為無結果
        dispatch({ type: 'SET_SEARCH', query: input.trim(), results: [], hasMore: false, projectId })
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
          placeholder={searching ? '搜尋中...' : '搜尋對話內容...'}
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
      </div>
    </div>
  )
}
