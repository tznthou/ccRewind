import { useId, useState } from 'react'
import type { ListItem, Tone } from './sessionStory'
import styles from './TokenBudget.module.css'

const TONE_CLASS: Record<Tone, string> = {
  warning: styles.insightWarning,
  info: styles.insightInfo,
}

interface Summary {
  rows: ListItem[]
  expandLabel: string
  collapseLabel: string
}

interface Props {
  title: string
  subtitle?: string | null
  items: ListItem[]
  emptyText: string
  /** 給了就先顯示彙總，按鈕展開成完整清單（清單內捲動） */
  summary?: Summary | null
  /** 建議的說明就是內容本身，字比事件的補充說明大一級 */
  prominentDetail?: boolean
}

/** 「發生了什麼」與「可以省的地方」共用的清單 */
export default function InsightsPanel({ title, subtitle, items, emptyText, summary, prominentDetail }: Props) {
  const [expanded, setExpanded] = useState(false)
  const headingId = useId()
  const listId = useId()

  const showSummary = summary != null && !expanded
  const rows = showSummary ? summary.rows : items
  const scroll = summary != null && expanded

  return (
    <section
      className={`${styles.insightsPanel} ${prominentDetail ? styles.insightsProminent : ''}`}
      aria-labelledby={headingId}
    >
      <div className={styles.insightsHeader} id={headingId}>
        {title}
        {subtitle && <small className={styles.insightsSubtitle}>{subtitle}</small>}
      </div>
      {items.length === 0
        ? <p className={styles.insightEmpty}>{emptyText}</p>
        : (
          <ul id={listId} className={`${styles.insightsList} ${scroll ? styles.insightsListScroll : ''}`}>
            {rows.map(item => (
              <li key={item.id} className={`${styles.insightItem} ${TONE_CLASS[item.tone]}`}>
                <span className={styles.insightIcon} aria-hidden="true">{item.icon}</span>
                <div className={styles.insightBody}>
                  <span className={styles.insightTitle}>{item.title}</span>
                  <span className={styles.insightDetail}>{item.detail}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      {summary != null && items.length > 0 && (
        <button
          type="button"
          className={styles.insightsExpand}
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded(prev => !prev)}
        >
          {expanded ? summary.collapseLabel : summary.expandLabel}
        </button>
      )}
    </section>
  )
}
