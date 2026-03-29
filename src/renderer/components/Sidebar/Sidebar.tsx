import ProjectList from './ProjectList'
import SessionList from './SessionList'
import IndexerStatus from './IndexerStatus'
import styles from './Sidebar.module.css'

export default function Sidebar() {
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>ccRewind</h1>
        <p className={styles.subtitle}>Claude Code 對話回放工具</p>
      </header>

      <section aria-labelledby="project-heading" className={styles.section}>
        <h2 id="project-heading" className={styles.sectionLabel}>專案</h2>
        <div className={styles.projectScroll}>
          <ProjectList />
        </div>
      </section>

      <section aria-labelledby="session-heading" className={styles.sessionSection}>
        <h2 id="session-heading" className={styles.sectionLabel}>Sessions</h2>
        <SessionList />
      </section>

      <IndexerStatus />
    </div>
  )
}
