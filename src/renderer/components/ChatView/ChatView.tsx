import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppState, useAppDispatch } from '../../context/AppContext'
import { useSession } from '../../hooks/useSession'
import type { SessionFile } from '../../../shared/types'
import { basename } from '../../utils/pathDisplay'
import MessageBubble from './MessageBubble'
import TokenBudgetPanel from '../TokenBudget/TokenBudgetPanel'
import RelatedSessionsPanel from '../Archaeology/RelatedSessionsPanel'
import SubagentPanel from './SubagentPanel'
import { useTokenHeat } from './TokenHeatGutter'
import styles from './ChatView.module.css'

interface ChatViewProps {
  sessionId: string
}

export default function ChatView({ sessionId }: ChatViewProps) {
  const { messages, loading, error } = useSession(sessionId)
  const { targetMessageId, searchQuery } = useAppState()
  const heatMap = useTokenHeat(messages)
  const dispatch = useAppDispatch()
  const containerRef = useRef<HTMLDivElement>(null)

  // 換 session 時若無搜尋目標就 scroll to top；用 ref 追蹤前一個 sessionId 避免 targetMessageId 變化時誤觸（會蓋掉 search scroll）
  const prevSessionIdRef = useRef<string | null>(null)
  useEffect(() => {
    const sessionChanged = prevSessionIdRef.current !== sessionId
    prevSessionIdRef.current = sessionId
    if (sessionChanged && !targetMessageId) {
      containerRef.current?.parentElement?.scrollTo(0, 0)
    }
  }, [sessionId, targetMessageId])

  // 搜尋跳轉：targetMessageId 設定後（含同 session 重複點擊），loading 結束時跳轉
  useEffect(() => {
    if (!targetMessageId || loading) return
    dispatch({ type: 'CLEAR_TARGET_MESSAGE' })

    const el = containerRef.current?.querySelector(`[data-message-id="${targetMessageId}"]`)
    if (!(el instanceof HTMLElement)) return

    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.focus({ preventScroll: true })
    el.classList.add(styles.highlightTarget)
    const onEnd = () => {
      el.classList.remove(styles.highlightTarget)
      el.removeEventListener('animationend', onEnd)
    }
    el.addEventListener('animationend', onEnd)

    // 等 markdown render 後嘗試 scroll 到第一個關鍵字 mark；若所在 <details> 摺疊則先展開
    let innerRafId = 0
    const outerRafId = requestAnimationFrame(() => {
      const mark = el.querySelector<HTMLElement>('mark[data-search-match="true"]')
      if (!mark) return
      const details = mark.closest('details')
      if (details && !details.open) details.open = true
      innerRafId = requestAnimationFrame(() => mark.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    })

    return () => {
      cancelAnimationFrame(outerRafId)
      cancelAnimationFrame(innerRafId)
      el.classList.remove(styles.highlightTarget)
      el.removeEventListener('animationend', onEnd)
    }
  }, [targetMessageId, loading, dispatch])

  const [exporting, setExporting] = useState(false)
  const [sessionFiles, setSessionFiles] = useState<SessionFile[]>([])
  const [showFiles, setShowFiles] = useState(false)

  useEffect(() => {
    setShowFiles(false)
    setSessionFiles([])
    let cancelled = false
    window.api.getSessionFiles(sessionId).then(files => {
      if (!cancelled) setSessionFiles(files)
    })
    return () => { cancelled = true }
  }, [sessionId])

  const handleExport = useCallback(async () => {
    setExporting(true)
    try {
      await window.api.exportMarkdown(sessionId)
    } finally {
      setExporting(false)
    }
  }, [sessionId])

  return (
    <div ref={containerRef} className={styles.chatView}>
      <SubagentPanel sessionId={sessionId} />
      {loading ? (
        <div className={styles.status}>載入對話中...</div>
      ) : error ? (
        <div className={styles.error}>錯誤：{error}</div>
      ) : messages.length === 0 ? (
        <div className={styles.status}>此 Session 沒有訊息</div>
      ) : (
        <>
          <div className={styles.toolbar}>
            <TokenBudgetPanel sessionId={sessionId} />
            <div className={styles.toolbarActions}>
              {sessionFiles.length > 0 && (
                <button
                  className={styles.filesToggle}
                  onClick={() => setShowFiles(v => !v)}
                >
                  {sessionFiles.length} files {showFiles ? '\u25B4' : '\u25BE'}
                </button>
              )}
              <button
                className={styles.exportButton}
                onClick={handleExport}
                disabled={exporting || messages.length === 0}
              >
                {exporting ? 'Exporting...' : 'Export Markdown'}
              </button>
            </div>
          </div>
          {showFiles && sessionFiles.length > 0 && (
            <div className={styles.filesChips}>
              {sessionFiles.map(f => (
                <button
                  key={`${f.filePath}-${f.operation}`}
                  className={styles.fileChip}
                  data-op={f.operation}
                  onClick={() => dispatch({ type: 'OPEN_FILE_HISTORY', filePath: f.filePath })}
                  title={`${f.filePath} (${f.operation} ×${f.count})`}
                >
                  {basename(f.filePath)}
                </button>
              ))}
            </div>
          )}
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} searchQuery={searchQuery} heat={heatMap.get(msg.id)} />
          ))}
          <RelatedSessionsPanel sessionId={sessionId} />
        </>
      )}
    </div>
  )
}
