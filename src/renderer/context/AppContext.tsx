import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from 'react'
import type { SearchResult, SessionSearchResult, SearchScope, SearchOptions } from '../../shared/types'

export type ViewMode = 'sessions' | 'dashboard' | 'storage'

export interface LiveAnnouncement {
  message: string
  seq: number
}

export interface AppState {
  viewMode: ViewMode
  fileHistoryPath: string | null
  selectedProjectId: string | null
  selectedSessionId: string | null
  searchQuery: string
  searchScope: SearchScope
  searchResults: SearchResult[]
  sessionSearchResults: SessionSearchResult[]
  searchHasMore: boolean
  searchProjectId: string | null
  searchOptions: SearchOptions | undefined
  targetMessageId: number | null
  liveAnnouncement: LiveAnnouncement
}

export type AppAction =
  | { type: 'SET_VIEW_MODE'; mode: ViewMode }
  | { type: 'OPEN_FILE_HISTORY'; filePath: string }
  | { type: 'CLOSE_FILE_HISTORY' }
  | { type: 'SELECT_PROJECT'; projectId: string }
  | { type: 'SELECT_SESSION'; sessionId: string }
  | { type: 'CLEAR_SESSION' }
  | { type: 'SET_SEARCH'; query: string; results: SearchResult[]; hasMore: boolean; projectId: string | null; options?: SearchOptions }
  | { type: 'SET_SESSION_SEARCH'; query: string; results: SessionSearchResult[]; hasMore: boolean; projectId: string | null; options?: SearchOptions }
  | { type: 'APPEND_SEARCH_RESULTS'; results: SearchResult[]; hasMore: boolean }
  | { type: 'APPEND_SESSION_SEARCH_RESULTS'; results: SessionSearchResult[]; hasMore: boolean }
  | { type: 'CLEAR_SEARCH' }
  | { type: 'NAVIGATE_TO_SESSION'; projectId: string; sessionId: string; messageId?: number }
  | { type: 'CLEAR_TARGET_MESSAGE' }
  | { type: 'ANNOUNCE'; message: string }

export const initialState: AppState = {
  viewMode: 'sessions',
  fileHistoryPath: null,
  selectedProjectId: null,
  selectedSessionId: null,
  searchQuery: '',
  searchScope: 'messages',
  searchResults: [],
  sessionSearchResults: [],
  searchHasMore: false,
  searchProjectId: null,
  searchOptions: undefined,
  targetMessageId: null,
  liveAnnouncement: { message: '', seq: 0 },
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.mode }
    case 'OPEN_FILE_HISTORY':
      return { ...state, fileHistoryPath: action.filePath }
    case 'CLOSE_FILE_HISTORY':
      return { ...state, fileHistoryPath: null }
    case 'SELECT_PROJECT':
      // 切換專案時清除 session 選取 + 搜尋；保留 liveAnnouncement（transient feedback channel）
      return { ...initialState, selectedProjectId: action.projectId, liveAnnouncement: state.liveAnnouncement }
    case 'SELECT_SESSION':
      return { ...state, selectedSessionId: action.sessionId, targetMessageId: null }
    case 'CLEAR_SESSION':
      return { ...state, selectedSessionId: null, targetMessageId: null }
    case 'SET_SEARCH':
      return { ...state, searchQuery: action.query, searchScope: 'messages', searchResults: action.results, sessionSearchResults: [], searchHasMore: action.hasMore, searchProjectId: action.projectId, searchOptions: action.options, targetMessageId: null }
    case 'SET_SESSION_SEARCH':
      return { ...state, searchQuery: action.query, searchScope: 'sessions', sessionSearchResults: action.results, searchResults: [], searchHasMore: action.hasMore, searchProjectId: action.projectId, searchOptions: action.options, targetMessageId: null }
    case 'APPEND_SEARCH_RESULTS':
      return { ...state, searchResults: [...state.searchResults, ...action.results], searchHasMore: action.hasMore }
    case 'APPEND_SESSION_SEARCH_RESULTS':
      return { ...state, sessionSearchResults: [...state.sessionSearchResults, ...action.results], searchHasMore: action.hasMore }
    case 'CLEAR_SEARCH':
      return { ...state, searchQuery: '', searchScope: 'messages', searchResults: [], sessionSearchResults: [], searchHasMore: false, searchProjectId: null, searchOptions: undefined, targetMessageId: null }
    case 'NAVIGATE_TO_SESSION':
      return {
        ...state,
        selectedProjectId: action.projectId,
        selectedSessionId: action.sessionId,
        targetMessageId: action.messageId ?? null,
      }
    case 'CLEAR_TARGET_MESSAGE':
      return { ...state, targetMessageId: null }
    case 'ANNOUNCE':
      return { ...state, liveAnnouncement: { message: action.message, seq: state.liveAnnouncement.seq + 1 } }
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
