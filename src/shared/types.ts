/** 專案 */
export interface Project {
  id: string
  displayName: string
  sessionCount: number
  lastActivityAt: string | null
}

/** Outcome 觀察信號（可回溯的原始 signal） */
export interface OutcomeSignals {
  gitCommitInvoked: boolean
  testCommandRan: boolean
  /** session 最後幾輪是否仍在 Edit/Write */
  endedWithEdits: boolean
  /** session 輪數少且無 tool_use */
  isQuickQA: boolean
}

/** Outcome 推斷狀態 */
export type OutcomeStatus = 'committed' | 'tested' | 'in-progress' | 'quick-qa' | null

/** Session 自動摘要（heuristic v2） */
export interface SessionSummary {
  /** 結構化意圖文字（跳過 greeting，找第一句實質內容） */
  intentText: string
  /** 動作概要（"Edit×8, 5 個檔案"） */
  activityText: string
  /** outcome 推斷狀態 */
  outcomeStatus: OutcomeStatus
  /** outcome 原始信號（可回溯） */
  outcomeSignals: OutcomeSignals
  /** 組合式摘要文字（intent → activity → outcome） */
  summaryText: string
  tags: string
  filesTouched: string
  toolsUsed: string
  /** 摘要引擎版本（規則迭代時安全 backfill） */
  summaryVersion: number
  /** session 持續秒數 */
  durationSeconds: number | null
}

/** session_files 表的操作類型：mutation（改動）vs discovery（搜尋/瀏覽） */
export type FileOperation = 'read' | 'edit' | 'write' | 'discovery'

/** session_files 表的單筆記錄 */
export interface SessionFile {
  sessionId: string
  filePath: string
  operation: FileOperation
  count: number
  firstSeenSeq: number
  lastSeenSeq: number
}

/** Session 摘要 */
export interface SessionMeta {
  id: string
  projectId: string
  title: string | null
  messageCount: number
  startedAt: string | null
  endedAt: string | null
  archived: boolean
  summaryText: string | null
  /** 結構化意圖文字（Phase 3） */
  intentText: string | null
  /** outcome 推斷狀態（Phase 3） */
  outcomeStatus: OutcomeStatus
  /** session 持續秒數（Phase 3） */
  durationSeconds: number | null
  /** 摘要引擎版本（Phase 3） */
  summaryVersion: number | null
  tags: string | null
  filesTouched: string | null
  toolsUsed: string | null
  /** Token 彙總（Phase 2.5） */
  totalInputTokens: number | null
  totalOutputTokens: number | null
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
  /** Token usage（僅 assistant 訊息有值） */
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
  model: string | null
}

/** Session Token 統計（Context Budget 視覺化用） */
export interface SessionTokenStats {
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheCreationTokens: number
  cacheHitRate: number
  models: string[]
  primaryModel: string | null
  turns: Array<{
    sequence: number
    timestamp: string | null
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    contextTotal: number
    hasToolUse: boolean
    toolNames: string[]
    model: string | null
  }>
}

/** 訊息上下文（搜尋結果預覽用） */
export interface MessageContext {
  target: Message | null
  before: Message[]
  after: Message[]
}

/** 搜尋範圍 */
export type SearchScope = 'messages' | 'sessions'

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

/** 搜尋分頁回應 */
export interface SearchPage {
  results: SearchResult[]
  offset: number
  hasMore: boolean
}

/** Session 層級搜尋結果 */
export interface SessionSearchResult {
  sessionId: string
  sessionTitle: string | null
  projectId: string
  projectName: string
  tags: string | null
  filesTouched: string | null
  snippet: string
}

/** Session 搜尋分頁回應 */
export interface SessionSearchPage {
  results: SessionSearchResult[]
  offset: number
  hasMore: boolean
}

/** 按 session 分組的搜尋結果 */
export interface GroupedSearchResult {
  sessionId: string
  sessionTitle: string | null
  projectId: string
  projectName: string
  matches: Array<{ messageId: number; snippet: string; timestamp: string | null }>
}

/** Renderer 透過 contextBridge 取得的 API */
export interface ElectronAPI {
  getProjects: () => Promise<Project[]>
  getSessions: (projectId: string) => Promise<SessionMeta[]>
  loadSession: (sessionId: string) => Promise<Message[]>
  search: (query: string, projectId?: string | null, offset?: number) => Promise<SearchPage>
  /** 搜尋 session 標題 / 標籤 / 檔案 */
  searchSessions: (query: string, projectId?: string | null, offset?: number) => Promise<SessionSearchPage>
  /** 取得訊息上下文（搜尋預覽用） */
  getMessageContext: (messageId: number, range?: number) => Promise<MessageContext>
  /** 取得 session token 統計（Context Budget 用） */
  getSessionTokenStats: (sessionId: string) => Promise<SessionTokenStats>
  /** 匯出 session 為 Markdown 檔案 */
  exportMarkdown: (sessionId: string) => Promise<'saved' | 'cancelled'>
  /** 訂閱 indexer 進度，回傳取消訂閱函式 */
  onIndexerStatus: (callback: (status: IndexerStatus) => void) => () => void
  /** 檢查更新（回傳最新狀態） */
  checkForUpdates: () => Promise<UpdateState>
  /** 取得目前更新狀態（不發請求） */
  getUpdateState: () => Promise<UpdateState>
  /** 開啟 GitHub Release 頁面 */
  openReleasePage: () => Promise<void>
  /** 略過此版本的更新提示 */
  dismissUpdate: (version: string) => Promise<void>
}

/** 更新檢查狀態 */
export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'dismissed' | 'latest' | 'error'
  currentVersion: string
  latestVersion: string | null
  releaseUrl: string | null
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
  /** Token usage（僅 assistant 訊息有值） */
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
  model: string | null
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
