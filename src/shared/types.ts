/** 專案 */
export interface Project {
  id: string
  displayName: string
  sessionCount: number
  lastActivityAt: string | null
}

/** Session 摘要 */
export interface SessionMeta {
  id: string
  projectId: string
  title: string | null
  messageCount: number
  startedAt: string | null
  endedAt: string | null
}

/** 訊息 */
export interface Message {
  id: number
  sessionId: string
  type: 'user' | 'assistant' | 'queue-operation' | 'last-prompt'
  role: 'user' | 'assistant' | null
  contentText: string | null
  contentJson: string | null
  hasToolUse: boolean
  hasToolResult: boolean
  toolNames: string[] | null
  timestamp: string | null
  sequence: number
}

/** 搜尋結果 */
export interface SearchResult {
  sessionId: string
  sessionTitle: string | null
  projectId: string
  projectName: string
  messageId: number
  snippet: string
  timestamp: string | null
}

/** Renderer 透過 contextBridge 取得的 API */
export interface ElectronAPI {
  getProjects: () => Promise<Project[]>
  getSessions: (projectId: string) => Promise<SessionMeta[]>
  loadSession: (sessionId: string) => Promise<Message[]>
  search: (query: string, projectId?: string | null) => Promise<SearchResult[]>
  /** 匯出 session 為 Markdown 檔案 */
  exportMarkdown: (sessionId: string) => Promise<'saved' | 'cancelled'>
  /** 訂閱 indexer 進度，回傳取消訂閱函式 */
  onIndexerStatus: (callback: (status: IndexerStatus) => void) => () => void
}

/** 索引進度 */
export interface IndexerStatus {
  phase: 'scanning' | 'parsing' | 'indexing' | 'done'
  progress: number
  total: number
  current: number
}

// ── Scanner 中間型別 ──

/** 掃描到的 session 檔案資訊 */
export interface ScannedSession {
  filePath: string
  fileSize: number
  fileMtime: string
  sessionId: string
}

/** 掃描到的專案資訊 */
export interface ScannedProject {
  projectId: string
  displayName: string
  sessions: ScannedSession[]
}

// ── Parser 中間型別 ──

/** 單行 JSONL 解析結果 */
export interface ParsedLine {
  type: string
  uuid: string | null
  parentUuid: string | null
  sessionId: string | null
  timestamp: string | null
  role: 'user' | 'assistant' | null
  contentText: string | null
  contentJson: string | null
  hasToolUse: boolean
  hasToolResult: boolean
  toolNames: string[]
  rawJson: string
}

/** 整個 session 解析結果 */
export interface ParsedSession {
  sessionId: string
  title: string | null
  messages: ParsedLine[]
  startedAt: string | null
  endedAt: string | null
  skippedLines: number
  totalLines: number
}
