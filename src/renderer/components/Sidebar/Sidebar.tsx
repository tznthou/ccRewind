import { useAppState } from '../../context/AppContext'
import ProjectList from './ProjectList'
import SessionList from './SessionList'
import SearchBar from './SearchBar'
import SearchResults from './SearchResults'
import IndexerStatus from './IndexerStatus'
import styles from './Sidebar.module.css'

export default function Sidebar() {
  const { searchQuery } = useAppState()

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>ccRewind</h1>
        <p className={styles.subtitle}>Claude Code 對話回放工具</p>
      </header>

      <SearchBar />

      <section aria-labelledby="project-heading" className={styles.section}>
        <h2 id="project-heading" className={styles.sectionLabel}>專案</h2>
        <div className={styles.projectScroll}>
          <ProjectList />
        </div>
      </section>

      <section aria-labelledby="session-heading" className={styles.sessionSection}>
        <h2 id="session-heading" className={styles.sectionLabel}>
          {searchQuery ? '搜尋結果' : 'Sessions'}
        </h2>
        {searchQuery ? <SearchResults /> : <SessionList />}
      </section>

      <IndexerStatus />
    </div>
  )
}
