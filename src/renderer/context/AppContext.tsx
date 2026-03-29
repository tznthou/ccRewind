import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from 'react'
import type { SearchResult } from '../../shared/types'

interface AppState {
  selectedProjectId: string | null
  selectedSessionId: string | null
  searchQuery: string
  searchResults: SearchResult[]
  searchHasMore: boolean
  searchProjectId: string | null
  targetMessageId: number | null
}

type AppAction =
  | { type: 'SELECT_PROJECT'; projectId: string }
  | { type: 'SELECT_SESSION'; sessionId: string }
  | { type: 'CLEAR_SESSION' }
  | { type: 'SET_SEARCH'; query: string; results: SearchResult[]; hasMore: boolean; projectId: string | null }
  | { type: 'APPEND_SEARCH_RESULTS'; results: SearchResult[]; hasMore: boolean }
  | { type: 'CLEAR_SEARCH' }
  | { type: 'NAVIGATE_TO_RESULT'; sessionId: string; messageId: number }
  | { type: 'CLEAR_TARGET_MESSAGE' }

const initialState: AppState = {
  selectedProjectId: null,
  selectedSessionId: null,
  searchQuery: '',
  searchResults: [],
  searchHasMore: false,
  searchProjectId: null,
  targetMessageId: null,
}

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SELECT_PROJECT':
      // 切換專案時清除 session 選取 + 搜尋
      return { ...initialState, selectedProjectId: action.projectId }
    case 'SELECT_SESSION':
      return { ...state, selectedSessionId: action.sessionId, targetMessageId: null }
    case 'CLEAR_SESSION':
      return { ...state, selectedSessionId: null, targetMessageId: null }
    case 'SET_SEARCH':
      return { ...state, searchQuery: action.query, searchResults: action.results, searchHasMore: action.hasMore, searchProjectId: action.projectId, targetMessageId: null }
    case 'APPEND_SEARCH_RESULTS':
      return { ...state, searchResults: [...state.searchResults, ...action.results], searchHasMore: action.hasMore }
    case 'CLEAR_SEARCH':
      return { ...state, searchQuery: '', searchResults: [], searchHasMore: false, searchProjectId: null, targetMessageId: null }
    case 'NAVIGATE_TO_RESULT':
      return { ...state, selectedSessionId: action.sessionId, targetMessageId: action.messageId }
    case 'CLEAR_TARGET_MESSAGE':
      return { ...state, targetMessageId: null }
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
