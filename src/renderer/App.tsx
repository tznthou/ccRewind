import { AppProvider, useAppState, useAppDispatch } from './context/AppContext'
import { ThemeProvider } from './context/ThemeContext'
import Sidebar from './components/Sidebar/Sidebar'
import ChatView from './components/ChatView/ChatView'
import DashboardPage from './components/Dashboard/DashboardPage'
import FileHistoryDrawer from './components/Archaeology/FileHistoryDrawer'
import ThemeSwitcher from './components/ThemeSwitcher/ThemeSwitcher'
import styles from './App.module.css'

function AppContent() {
  const { selectedSessionId, viewMode, fileHistoryPath } = useAppState()
  const dispatch = useAppDispatch()

  return (
    <div className={styles.layout}>
      <div className={styles.titleBar}>
        <button
          className={`${styles.viewToggle} ${viewMode === 'dashboard' ? styles.viewToggleActive : ''}`}
          onClick={() => dispatch({ type: 'SET_VIEW_MODE', mode: viewMode === 'dashboard' ? 'sessions' : 'dashboard' })}
          title="Dashboard"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
          </svg>
        </button>
        <ThemeSwitcher />
      </div>
      {viewMode === 'dashboard' ? (
        <main className={`${styles.main} ${styles.mainFull}`}>
          <DashboardPage />
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
                <span>選擇一個 Session 開始瀏覽</span>
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
    <ThemeProvider>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </ThemeProvider>
  )
}
