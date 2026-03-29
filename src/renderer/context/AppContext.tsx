import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from 'react'

interface AppState {
  selectedProjectId: string | null
  selectedSessionId: string | null
}

type AppAction =
  | { type: 'SELECT_PROJECT'; projectId: string }
  | { type: 'SELECT_SESSION'; sessionId: string }
  | { type: 'CLEAR_SESSION' }

const initialState: AppState = {
  selectedProjectId: null,
  selectedSessionId: null,
}

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SELECT_PROJECT':
      // 切換專案時清除 session 選取
      return { selectedProjectId: action.projectId, selectedSessionId: null }
    case 'SELECT_SESSION':
      return { ...state, selectedSessionId: action.sessionId }
    case 'CLEAR_SESSION':
      return { ...state, selectedSessionId: null }
  }
}

const AppStateContext = createContext<AppState | null>(null)
const AppDispatchContext = createContext<Dispatch<AppAction> | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState)
  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        {children}
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  )
}

export function useAppState(): AppState {
  const ctx = useContext(AppStateContext)
  if (!ctx) throw new Error('useAppState must be used within AppProvider')
  return ctx
}

export function useAppDispatch(): Dispatch<AppAction> {
  const ctx = useContext(AppDispatchContext)
  if (!ctx) throw new Error('useAppDispatch must be used within AppProvider')
  return ctx
}
