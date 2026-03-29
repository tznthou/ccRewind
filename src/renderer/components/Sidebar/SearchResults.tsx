import type { ReactNode } from 'react'
import { useAppState, useAppDispatch } from '../../context/AppContext'
import { formatTime } from '../../utils/formatTime'
import styles from './SearchResults.module.css'

/** 將 FTS5 snippet 中的 <mark>...</mark> 轉為 React 元素，其餘純文字 escape */
function renderSnippet(snippet: string): ReactNode {
  const parts = snippet.split(/(<mark>.*?<\/mark>)/g)
  return parts.map((part, i) => {
    const match = part.match(/^<mark>(.*)<\/mark>$/)
    if (match) return <mark key={i}>{match[1]}</mark>
    return part
  })
}

export default function SearchResults() {
  const { searchResults, searchQuery } = useAppState()
  const dispatch = useAppDispatch()

  if (searchResults.length === 0) {
    return (
      <div className={styles.empty}>
        找不到「{searchQuery}」的結果
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.count}>{searchResults.length} 筆結果</div>
      {searchResults.map((r) => (
        <button
          key={`${r.sessionId}-${r.messageId}`}
          className={styles.item}
          onClick={() => dispatch({ type: 'NAVIGATE_TO_RESULT', sessionId: r.sessionId, messageId: r.messageId })}
        >
          <div className={styles.titleRow}>
            <span className={styles.sessionTitle}>{r.sessionTitle ?? r.sessionId.slice(0, 8)}</span>
            {r.timestamp && <span className={styles.time}>{formatTime(r.timestamp)}</span>}
          </div>
          <div className={styles.projectName}>{r.projectName}</div>
          <div className={styles.snippet}>
            {renderSnippet(r.snippet)}
          </div>
        </button>
      ))}
    </div>
  )
}
