import { AppProvider, useAppState, useAppDispatch } from './context/AppContext'
import { ThemeProvider } from './context/ThemeContext'
import { FontScaleProvider } from './context/FontScaleContext'
import { I18nProvider, useI18n } from './i18n/useI18n'
import LanguageSwitcher from './i18n/LanguageSwitcher'
import Sidebar from './components/Sidebar/Sidebar'
import ChatView from './components/ChatView/ChatView'
import DashboardPage from './components/Dashboard/DashboardPage'
import StoragePage from './components/Storage/StoragePage'
import FileHistoryDrawer from './components/Archaeology/FileHistoryDrawer'
import ThemeSwitcher from './components/ThemeSwitcher/ThemeSwitcher'
import FontScaleSwitcher from './components/FontScaleSwitcher/FontScaleSwitcher'
import styles from './App.module.css'

function AppContent() {
  const { selectedSessionId, viewMode, fileHistoryPath } = useAppState()
  const dispatch = useAppDispatch()
  const { t } = useI18n()

  return (
    <div className={styles.layout}>
      <div className={styles.titleBar}>
        <button
          className={`${styles.viewToggle} ${viewMode === 'dashboard' ? styles.viewToggleActive : ''}`}
          onClick={() => dispatch({ type: 'SET_VIEW_MODE', mode: viewMode === 'dashboard' ? 'sessions' : 'dashboard' })}
          title={t('app.tooltip.dashboard')}
          aria-label={t('app.tooltip.dashboard')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
          </svg>
        </button>
        <button
          className={`${styles.viewToggle} ${viewMode === 'storage' ? styles.viewToggleActive : ''}`}
          onClick={() => dispatch({ type: 'SET_VIEW_MODE', mode: viewMode === 'storage' ? 'sessions' : 'storage' })}
          title={t('app.tooltip.storage')}
          aria-label={t('app.tooltip.storage')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M3 5v14a9 3 0 0 0 18 0V5" />
            <path d="M3 12a9 3 0 0 0 18 0" />
          </svg>
        </button>
        <ThemeSwitcher />
        <FontScaleSwitcher />
        <LanguageSwitcher />
      </div>
      {viewMode === 'dashboard' ? (
        <main className={`${styles.main} ${styles.mainFull}`}>
          <DashboardPage />
        </main>
      ) : viewMode === 'storage' ? (
        <main className={`${styles.main} ${styles.mainFull}`}>
          <StoragePage />
        </main>
      ) : (
        <>
          <aside className={styles.sidebar}>
            <Sidebar />
          </aside>
          <main className={styles.main}>
            {selectedSessionId ? (
              <ChatView sessionId={selectedSessionId} />
            ) : (
              <div className={styles.placeholder}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <span>{t('app.placeholder.selectSession')}</span>
              </div>
            )}
          </main>
        </>
      )}
      {fileHistoryPath && (
        <FileHistoryDrawer
          filePath={fileHistoryPath}
          onClose={() => dispatch({ type: 'CLOSE_FILE_HISTORY' })}
        />
      )}
    </div>
  )
}

export default function App() {
  return (
    <I18nProvider>
      <ThemeProvider>
        <FontScaleProvider>
          <AppProvider>
            <AppContent />
          </AppProvider>
        </FontScaleProvider>
      </ThemeProvider>
    </I18nProvider>
  )
}
