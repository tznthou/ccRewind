import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useAppState, useAppDispatch } from '../../context/AppContext'
import { useI18n } from '../../i18n/useI18n'
import { useListboxKeyNav } from '../../hooks/useListboxKeyNav'
import { formatTime } from '../../utils/formatTime'
import { renderSnippet } from '../../utils/renderSnippet'
import SearchSyntaxHints from './SearchSyntaxHints'
import type { SearchResult, GroupedSearchResult, Message } from '../../../shared/types'
import styles from './SearchResults.module.css'

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
        sessionStartedAt: r.sessionStartedAt,
        matches: [{ messageId: r.messageId, snippet: r.snippet, timestamp: r.timestamp }],
      })
    }
  }

  return groups
}

/** 單則訊息的精簡預覽 */
function MessagePreview({ role, text }: { role: string | null; text: string | null }) {
  if (!text) return null
  const label = role === 'user' ? '👤' : '🤖'
  const truncated = text.length > 80 ? text.slice(0, 80) + '…' : text
  return (
    <div className={styles.contextMsg}>
      <span className={styles.contextRole}>{label}</span>
      <span className={styles.contextText}>{truncated}</span>
    </div>
  )
}

/** 鍵盤導覽用的扁平化 item（從 visible groups 收集；collapsed group 內的 matches 排除） */
interface FlatItem {
  messageId: number
  sessionId: string
  projectId: string
}

export default function SearchResults() {
  const { searchResults, searchQuery, searchHasMore, searchProjectId, searchOptions } = useAppState()
  const dispatch = useAppDispatch()
  const { t } = useI18n()
  const [loading, setLoading] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const contextCacheRef = useRef(new Map<number, { before: Message[]; after: Message[] }>())
  const [expandedContext, setExpandedContext] = useState<number | null>(null)

  const toggleContext = useCallback(async (messageId: number) => {
    if (expandedContext === messageId) {
      setExpandedContext(null)
      return
    }
    if (!contextCacheRef.current.has(messageId)) {
      try {
        const ctx = await window.api.getMessageContext(messageId, 2)
        contextCacheRef.current.set(messageId, { before: ctx.before, after: ctx.after })
      } catch {
        return
      }
    }
    setExpandedContext(messageId)
  }, [expandedContext])

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
      const page = await window.api.search(searchQuery, searchProjectId, searchResults.length, searchOptions)
      dispatch({ type: 'APPEND_SEARCH_RESULTS', results: page.results, hasMore: page.hasMore })
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  // 鍵盤導覽：扁平化 visible navigate items（collapsed group 內的 matches 排除）
  const flatItems = useMemo<FlatItem[]>(() =>
    groups.flatMap(g =>
      collapsedGroups.has(g.sessionId)
        ? []
        : g.matches.map(m => ({ messageId: m.messageId, sessionId: g.sessionId, projectId: g.projectId })),
    ),
  [groups, collapsedGroups])

  // messageId → flatItems index 對照表（讓 nested loop 內 inline 拿 active state）
  const itemIndexMap = useMemo(() => {
    const map = new Map<number, number>()
    flatItems.forEach((item, i) => map.set(item.messageId, i))
    return map
  }, [flatItems])

  const { listboxProps, getOptionProps, isActive, setActiveIndex } = useListboxKeyNav<FlatItem>({
    items: flatItems,
    getItemId: (item) => String(item.messageId),
    onActivate: (item) => dispatch({
      type: 'NAVIGATE_TO_SESSION',
      projectId: item.projectId,
      sessionId: item.sessionId,
      messageId: item.messageId,
    }),
    dispatchOnArrow: false, // 搜尋結果 navigate 跨 context 重，Enter 才 commit
  })

  if (searchResults.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>
          {t('sidebar.searchResults.empty', { query: searchQuery })}
        </div>
        <SearchSyntaxHints variant="messages" />
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
      <div className={styles.count}>{t('sidebar.searchResults.count', { count: searchResults.length, groups: groups.length })}</div>
      {groups.map((g) => {
        const collapsed = collapsedGroups.has(g.sessionId)
        return (
          <div key={g.sessionId} className={styles.group}>
            <button className={styles.groupHeader} onClick={() => toggleGroup(g.sessionId)}>
              <span className={styles.expandIcon}>{collapsed ? '▸' : '▾'}</span>
              <span className={styles.sessionTitle}>{g.sessionTitle ?? g.sessionId.slice(0, 8)}</span>
              {g.sessionStartedAt && <span className={styles.sessionDate}>{formatTime(g.sessionStartedAt)}</span>}
              <span className={styles.matchCount}>{g.matches.length}</span>
            </button>
            {!collapsed && (
              <div className={styles.groupBody}>
                <div className={styles.projectName}>{g.projectName}</div>
                {g.matches.map((m) => {
                  const flatIdx = itemIndexMap.get(m.messageId)
                  const active = flatIdx !== undefined && isActive(flatIdx)
                  const flatItem: FlatItem = { messageId: m.messageId, sessionId: g.sessionId, projectId: g.projectId }
                  return (
                    <div key={m.messageId}>
                      <div className={styles.itemRow}>
                        <button
                          className={styles.contextToggle}
                          onClick={() => toggleContext(m.messageId)}
                          aria-label={t('sidebar.searchResults.aria.toggleContext')}
                          title={t('sidebar.searchResults.title.toggleContext')}
                        >
                          {expandedContext === m.messageId ? '▾' : '▸'}
                        </button>
                        <button
                          className={`${styles.item} ${active ? styles.itemActive : ''}`}
                          {...getOptionProps(flatItem)}
                          onClick={() => {
                            if (flatIdx !== undefined) setActiveIndex(flatIdx)
                            dispatch({ type: 'NAVIGATE_TO_SESSION', projectId: g.projectId, sessionId: g.sessionId, messageId: m.messageId })
                          }}
                        >
                          <div className={styles.snippet}>{renderSnippet(m.snippet)}</div>
                          {m.timestamp && <span className={styles.time}>{formatTime(m.timestamp)}</span>}
                        </button>
                      </div>
                      {expandedContext === m.messageId && contextCacheRef.current.has(m.messageId) && (
                        <div className={styles.contextPreview}>
                          {contextCacheRef.current.get(m.messageId)!.before.map(msg => (
                            <MessagePreview key={msg.id} role={msg.role} text={msg.contentText} />
                          ))}
                          <div className={styles.contextTarget}>
                            {renderSnippet(m.snippet)}
                          </div>
                          {contextCacheRef.current.get(m.messageId)!.after.map(msg => (
                            <MessagePreview key={msg.id} role={msg.role} text={msg.contentText} />
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
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
