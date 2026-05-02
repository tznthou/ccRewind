import { useAppState } from '../../context/AppContext'
import { useI18n } from '../../i18n/useI18n'
import ProjectList from './ProjectList'
import SessionList from './SessionList'
import SearchBar from './SearchBar'
import SearchResults from './SearchResults'
import SessionSearchResults from './SessionSearchResults'
import IndexerStatus from './IndexerStatus'
import UpdateBanner from '../UpdateBanner/UpdateBanner'
import logoUrl from '../../assets/logo@2x.webp'
import styles from './Sidebar.module.css'

export default function Sidebar() {
  const { searchQuery, searchScope } = useAppState()
  const { t } = useI18n()

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <img src={logoUrl} alt="" width={24} height={24} className={styles.logo} />
          <h1 className={styles.title}>ccRewind</h1>
        </div>
        <p className={styles.subtitle}>{t('sidebar.subtitle')}</p>
      </header>

      <UpdateBanner />

      <SearchBar />

      <section aria-labelledby="project-heading" className={styles.section}>
        <h2 id="project-heading" className={styles.sectionLabel}>{t('sidebar.section.projects')}</h2>
        <div className={styles.projectScroll}>
          <ProjectList />
        </div>
      </section>

      <section aria-labelledby="session-heading" className={styles.sessionSection}>
        <h2 id="session-heading" className={styles.sectionLabel}>
          {searchQuery ? t('sidebar.section.searchResults') : t('sidebar.section.sessions')}
        </h2>
        {searchQuery
          ? searchScope === 'sessions'
            ? <SessionSearchResults />
            : <SearchResults />
          : <SessionList />}
      </section>

      <IndexerStatus />
    </div>
  )
}
