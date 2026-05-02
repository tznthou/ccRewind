import { useProjects } from '../../hooks/useProjects'
import { useAppState, useAppDispatch } from '../../context/AppContext'
import { useI18n } from '../../i18n/useI18n'
import { useListboxKeyNav } from '../../hooks/useListboxKeyNav'
import type { Project } from '../../../shared/types'
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
  const { t } = useI18n()

  const { listboxProps, getOptionProps, isActive, setActiveIndex } = useListboxKeyNav<Project>({
    items: projects,
    getItemId: (p) => p.id,
    onActivate: (p) => dispatch({ type: 'SELECT_PROJECT', projectId: p.id }),
    dispatchOnArrow: true,
  })

  if (loading) {
    return <div className={styles.statusText}>{t('sidebar.projectList.loading')}</div>
  }

  if (error) {
    return <div className={styles.errorText}>{t('common.error', { message: error })}</div>
  }

  if (projects.length === 0) {
    return (
      <div className={styles.statusText}>
        {t('sidebar.projectList.empty')}
      </div>
    )
  }

  return (
    <ul
      className={styles.projectList}
      aria-label={t('sidebar.projectList.aria.label')}
      {...listboxProps}
    >
      {projects.map((project, i) => (
        <li
          key={project.id}
          className={`${styles.projectItem} ${project.id === selectedProjectId ? styles.selected : ''} ${isActive(i) ? styles.optionActive : ''}`}
          aria-selected={project.id === selectedProjectId}
          {...getOptionProps(project)}
          onClick={() => {
            setActiveIndex(i)
            dispatch({ type: 'SELECT_PROJECT', projectId: project.id })
          }}
        >
          <span className={styles.projectName} title={project.displayName}>{shortenPath(project.displayName)}</span>
          <span className={styles.badge}>{project.sessionCount}</span>
        </li>
      ))}
    </ul>
  )
}
