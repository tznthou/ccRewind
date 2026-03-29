import { useAppState } from '../../context/AppContext'
import ProjectList from './ProjectList'
import SessionList from './SessionList'
import SearchBar from './SearchBar'
import SearchResults from './SearchResults'
import IndexerStatus from './IndexerStatus'
import UpdateBanner from '../UpdateBanner/UpdateBanner'
import logoUrl from '../../assets/logo@2x.webp'
import styles from './Sidebar.module.css'

export default function Sidebar() {
  const { searchQuery } = useAppState()

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <img src={logoUrl} alt="" width={24} height={24} className={styles.logo} />
          <h1 className={styles.title}>ccRewind</h1>
        </div>
        <p className={styles.subtitle}>Claude Code 對話回放工具</p>
      </header>

      <UpdateBanner />

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
