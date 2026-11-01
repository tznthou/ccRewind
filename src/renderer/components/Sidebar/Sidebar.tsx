import { useAppState } from '../../context/AppContext'
import { useI18n } from '../../i18n/useI18n'
import ProjectList from './ProjectList'
import SessionList from './SessionList'
import SearchBar from './SearchBar'
import SearchResults from './SearchResults'
import SessionSearchResults from './SessionSearchResults'
import IndexerStatus from './IndexerStatus'
import UpdateBanner from '../UpdateBanner/UpdateBanner'
import styles from './Sidebar.module.css'

/**
 * 對話框 + 兩個倒帶三角形，顏色跟主題走（--logo-ring 圈與尾巴、--logo-mark 三角）。
 * 尾巴兩端落在圓圈的中線上（半徑 11，沿原本的角度）：端點的圓頭剛好填滿環的寬度。
 * 以前端點在半徑 10.3／10.6，圓頭從環的內緣凸出來，放大到 512px 看得到（24px 看不出，但 Dock 圖示會沿用同一份）。
 */
function Logo() {
  return (
    <svg className={styles.logo} width={24} height={24} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="17" cy="15" r="11" fill="none" stroke="var(--logo-ring)" strokeWidth="3.4" />
      <path d="M8.37 21.82 4.6 27.6 12.33 24.96" fill="none" stroke="var(--logo-ring)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16.2 9.6v10.8L8.8 15zM23.9 9.6v10.8L16.5 15z" fill="var(--logo-mark)" />
    </svg>
  )
}

export default function Sidebar() {
  const { searchQuery, searchScope } = useAppState()
  const { t } = useI18n()

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <Logo />
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
