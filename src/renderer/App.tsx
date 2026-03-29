import { AppProvider, useAppState } from './context/AppContext'
import Sidebar from './components/Sidebar/Sidebar'
import ChatView from './components/ChatView/ChatView'
import styles from './App.module.css'

function AppContent() {
  const { selectedSessionId } = useAppState()

  return (
    <div className={styles.layout}>
      <div className={styles.titleBar} />
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
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  )
}
