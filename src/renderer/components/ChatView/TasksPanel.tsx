import { useState, useEffect, useRef, useMemo } from 'react'
import type { SessionTask } from '../../../shared/types'
import { resolveBlockedBy } from './blockedBy'
import { useI18n } from '../../i18n/useI18n'
import styles from './ChatView.module.css'

interface Props {
  sessionId: string
}

export default function TasksPanel({ sessionId }: Props) {
  const { t } = useI18n()
  const [tasks, setTasks] = useState<SessionTask[]>([])
  // 點 blockedBy chip 後短暫高亮目標 task；null = 無高亮。animation 跑完自行清除。
  const [flashId, setFlashId] = useState<string | null>(null)
  // 存每個 task li 的 DOM 節點，供 click-to-jump 取用——用 ref Map 而非 taskId 當 DOM id，
  // 避開 querySelector 對特殊字元 id 的 sanitize 問題（taskId 在寬容 parser 下可能含任意字元）。
  const itemRefs = useRef<Map<string, HTMLLIElement>>(new Map())
  // 建一次 taskId→subject 索引供 blockedBy chip 反查，避免逐列重建 Map 造成 O(n²) render。
  const subjectById = useMemo(
    () => new Map(tasks.map(task => [task.taskId, task.subject])),
    [tasks],
  )

  // subagent session（id 含 '/'）的 task panel 不顯示——sub-agent 工具集無 TaskCreate/Update
  const isSubagent = sessionId.includes('/')

  useEffect(() => {
    // isSubagent 時 component 立刻 return null，state 殘留無影響——避免兩個 setState 觸發 lint
    if (isSubagent) return
    let cancelled = false
    // 切換 session 時 reset，避免 stale flash
    /* eslint-disable react-hooks/set-state-in-effect */
    setTasks([])
    setFlashId(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    window.api.getSessionTasks(sessionId)
      .then(data => { if (!cancelled) setTasks(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [sessionId, isSubagent])

  if (isSubagent) return null
  if (tasks.length === 0) return null

  function jumpToTask(id: string) {
    const el = itemRefs.current.get(id)
    if (!el) return
    // 對齊既有 message 跳轉慣例（ChatView.tsx）：捲動後移焦點，
    // 讓鍵盤／螢幕報讀使用者跟著到目標，而非停在已捲離畫面的來源 chip。
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.focus({ preventScroll: true })
    setFlashId(id)
  }

  return (
    <div className={styles.tasksPanel}>
      <span className={styles.tasksLabel}>{t('chatView.tasks.label')}</span>
      <ul className={styles.taskList}>
        {tasks.map(task => {
          // status 在 parser 層保留原值（未來 enum 演進），UI 對未知值用 fallback class + 原字串顯示
          let statusLabel: string
          let statusClass: string
          switch (task.status) {
            case 'completed':
              statusLabel = t('chatView.tasks.status.completed')
              statusClass = styles.taskStatusCompleted
              break
            case 'in_progress':
              statusLabel = t('chatView.tasks.status.inProgress')
              statusClass = styles.taskStatusInProgress
              break
            case 'pending':
              statusLabel = t('chatView.tasks.status.pending')
              statusClass = styles.taskStatusPending
              break
            default:
              statusLabel = task.status
              statusClass = styles.taskStatusUnknown
          }
          return (
            <li
              key={task.taskId}
              ref={el => { if (el) itemRefs.current.set(task.taskId, el); else itemRefs.current.delete(task.taskId) }}
              tabIndex={-1}
              className={`${styles.taskItem} ${flashId === task.taskId ? styles.taskItemFlash : ''}`}
              onAnimationEnd={() => { if (flashId === task.taskId) setFlashId(null) }}
            >
              <span className={`${styles.taskStatusBadge} ${statusClass}`} title={statusLabel}>
                {statusLabel}
              </span>
              <span className={styles.taskId}>#{task.taskId}</span>
              <span className={styles.taskSubject}>{task.subject}</span>
              {task.blockedBy.length > 0 && (
                <span className={styles.taskBlockedBy}>
                  {t('chatView.tasks.blockedBy')}
                  {resolveBlockedBy(subjectById, task.blockedBy).map(ref => (
                    // subject 反查得到 → 可跳轉的 button；查不到（清單外）→ 降級為純 #id span 不可點
                    ref.subject !== null ? (
                      <button
                        key={ref.id}
                        type="button"
                        className={`${styles.taskBlockedByChip} ${styles.taskBlockedByChipClickable}`}
                        onClick={() => jumpToTask(ref.id)}
                        title={t('chatView.tasks.jumpTo')}
                        aria-label={`${t('chatView.tasks.jumpTo')}: #${ref.id} ${ref.subject}`}
                      >
                        #{ref.id} {ref.subject}
                      </button>
                    ) : (
                      <span key={ref.id} className={styles.taskBlockedByChip}>#{ref.id}</span>
                    )
                  ))}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
