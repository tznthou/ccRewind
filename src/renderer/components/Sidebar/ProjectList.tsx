import { useProjects } from '../../hooks/useProjects'
import { useAppState, useAppDispatch } from '../../context/AppContext'
import styles from './Sidebar.module.css'

/** Shorten absolute path to ~/... for display */
function shortenPath(displayName: string): string {
  // Match both Unix /Users/xxx/... and Windows C:\Users\xxx\...
  const match = displayName.match(/^(?:[A-Z]:)?[\\/]Users[\\/][^\\/]+(.*)$/i)
  if (!match) return displayName
  return '~' + match[1].replace(/\\/g, '/')
}

export default function ProjectList() {
  const { projects, loading, error } = useProjects()
  const { selectedProjectId } = useAppState()
  const dispatch = useAppDispatch()

  if (loading) {
    return <div className={styles.statusText}>載入專案中...</div>
  }

  if (error) {
    return <div className={styles.errorText}>錯誤：{error}</div>
  }

  if (projects.length === 0) {
    return (
      <div className={styles.statusText}>
        尚未找到專案。請確認 ~/.claude/projects/ 目錄存在。
      </div>
    )
  }

  return (
    <ul className={styles.projectList} role="listbox" aria-label="專案列表">
      {projects.map((project) => (
        <li
          key={project.id}
          className={`${styles.projectItem} ${project.id === selectedProjectId ? styles.selected : ''}`}
          role="option"
          aria-selected={project.id === selectedProjectId}
          tabIndex={0}
          onClick={() => dispatch({ type: 'SELECT_PROJECT', projectId: project.id })}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dispatch({ type: 'SELECT_PROJECT', projectId: project.id }) } }}
        >
          <span className={styles.projectName} title={project.displayName}>{shortenPath(project.displayName)}</span>
          <span className={styles.badge}>{project.sessionCount}</span>
        </li>
      ))}
    </ul>
  )
}
