import { useState, useEffect } from 'react'
import type { SessionTask } from '../../../shared/types'
import { useI18n } from '../../i18n/useI18n'
import styles from './ChatView.module.css'

interface Props {
  sessionId: string
}

export default function TasksPanel({ sessionId }: Props) {
  const { t } = useI18n()
  const [tasks, setTasks] = useState<SessionTask[]>([])

  // subagent session（id 含 '/'）的 task panel 不顯示——sub-agent 工具集無 TaskCreate/Update
  const isSubagent = sessionId.includes('/')

  useEffect(() => {
    // isSubagent 時 component 立刻 return null，state 殘留無影響——避免兩個 setState 觸發 lint
    if (isSubagent) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 切換 session 時 reset，避免 stale flash
    setTasks([])
    window.api.getSessionTasks(sessionId)
      .then(data => { if (!cancelled) setTasks(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [sessionId, isSubagent])

  if (isSubagent) return null
  if (tasks.length === 0) return null

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
            <li key={task.taskId} className={styles.taskItem}>
              <span className={`${styles.taskStatusBadge} ${statusClass}`} title={statusLabel}>
                {statusLabel}
              </span>
              <span className={styles.taskId}>#{task.taskId}</span>
              <span className={styles.taskSubject}>{task.subject}</span>
              {task.blockedBy.length > 0 && (
                <span className={styles.taskBlockedBy}>
                  {t('chatView.tasks.blockedBy')}
                  {task.blockedBy.map(id => (
                    <span key={id} className={styles.taskBlockedByChip}>#{id}</span>
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
