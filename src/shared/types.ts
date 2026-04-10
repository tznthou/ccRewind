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
  /** active time（排除 >5 分鐘閒置）秒數 */
  activeDurationSeconds: number | null
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
  /** active time（排除 >5 分鐘閒置）秒數 */
  activeDurationSeconds: number | null
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
export type SearchSortBy = 'rank' | 'date'

/** 搜尋選項（日期過濾 + 排序） */
export interface SearchOptions {
  dateFrom?: string   // ISO date, e.g. '2026-04-01'
  dateTo?: string
  sortBy?: SearchSortBy  // 預設 'rank'
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
  sessionStartedAt: string | null
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
  startedAt: string | null
  outcomeStatus: OutcomeStatus
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
  sessionStartedAt: string | null
  matches: Array<{ messageId: number; snippet: string; timestamp: string | null }>
}

// ── Phase 3.5: Dashboard Stats ──

/** 每日使用統計 */
export interface DailyUsage {
  date: string
  sessionCount: number
  totalTokens: number
}

/** 專案統計 */
export interface ProjectStats {
  projectId: string
  displayName: string
  sessionCount: number
  totalTokens: number
  lastActivity: string | null
}

/** 分佈項目（tool / tag） */
export interface DistributionItem {
  name: string
  count: number
}

/** 工作模式統計 */
export interface WorkPatterns {
  hourly: Array<{ hour: number; count: number }>
  avgDurationSeconds: number | null
}

// ── Phase 4: Dashboard 進階功能 ──

/** 每日效率趨勢 */
export interface DailyEfficiency {
  date: string
  /** 當日平均 tokens/turn */
  avgTokensPerTurn: number
  sessionCount: number
  totalTurns: number
}

/** 浪費偵測條目 */
export interface WasteSession {
  sessionId: string
  intentText: string | null
  totalTokens: number
  durationSeconds: number | null
  outcomeStatus: OutcomeStatus
  fileCount: number
  startedAt: string | null
  projectName: string
}

/** 專案健康概覽 */
export interface ProjectHealth {
  projectId: string
  displayName: string
  outcomeDistribution: {
    committed: number
    tested: number
    inProgress: number
    quickQa: number
    unknown: number
  }
  /** 近 7 天 session 數 */
  recentCount: number
  /** 前 7 天 session 數（趨勢比較用） */
  previousCount: number
  avgTokensPerTurn: number | null
}

/** 相關 Session（Jaccard 相似度） */
export interface RelatedSession {
  sessionId: string
  sessionTitle: string | null
  projectName: string
  intentText: string | null
  outcomeStatus: OutcomeStatus
  jaccard: number
  sharedFiles: string[]
  startedAt: string | null
}

/** 檔案歷史條目 */
export interface FileHistoryEntry {
  sessionId: string
  sessionTitle: string | null
  projectId: string
  projectName: string
  operation: FileOperation
  count: number
  startedAt: string | null
}

/** Renderer 透過 contextBridge 取得的 API */
export interface ElectronAPI {
  getProjects: () => Promise<Project[]>
  getSessions: (projectId: string) => Promise<SessionMeta[]>
  loadSession: (sessionId: string) => Promise<Message[]>
  search: (query: string, projectId?: string | null, offset?: number, options?: SearchOptions) => Promise<SearchPage>
  /** 搜尋 session 標題 / 標籤 / 檔案 / 意圖 */
  searchSessions: (query: string, projectId?: string | null, offset?: number, options?: SearchOptions) => Promise<SessionSearchPage>
  /** 取得訊息上下文（搜尋預覽用） */
  getMessageContext: (messageId: number, range?: number) => Promise<MessageContext>
  /** 取得 session token 統計（Context Budget 用） */
  getSessionTokenStats: (sessionId: string) => Promise<SessionTokenStats>
  /** 匯出 session 為 Markdown 檔案 */
  exportMarkdown: (sessionId: string) => Promise<'saved' | 'cancelled'>
  /** 檔案歷史（跨 session） */
  getFileHistory: (filePath: string) => Promise<FileHistoryEntry[]>
  /** Session 操作的檔案清單 */
  getSessionFiles: (sessionId: string) => Promise<SessionFile[]>
  /** 使用趨勢統計 */
  getUsageStats: (projectId?: string | null, days?: number) => Promise<DailyUsage[]>
  /** 專案統計排名 */
  getProjectStats: () => Promise<ProjectStats[]>
  /** 工具分佈 */
  getToolDistribution: (projectId?: string | null) => Promise<DistributionItem[]>
  /** 標籤分佈 */
  getTagDistribution: (projectId?: string | null) => Promise<DistributionItem[]>
  /** 工作模式 */
  getWorkPatterns: (projectId?: string | null) => Promise<WorkPatterns>
  /** 效率趨勢（tokens/turn 每日） */
  getEfficiencyTrend: (projectId?: string | null, days?: number) => Promise<DailyEfficiency[]>
  /** 浪費偵測（高 token 低產出 session） */
  getWasteSessions: (projectId?: string | null, limit?: number) => Promise<WasteSession[]>
  /** 專案健康（outcome 分佈 + 趨勢） */
  getProjectHealth: () => Promise<ProjectHealth[]>
  /** 相關 Session（Jaccard 相似度） */
  getRelatedSessions: (sessionId: string, limit?: number) => Promise<RelatedSession[]>
  /** 取得 session 的 subagent sessions */
  getSubagentSessions: (parentSessionId: string) => Promise<SubagentSession[]>
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

/** 掃描到的 subagent 檔案資訊 */
export interface ScannedSubagent {
  filePath: string
  fileSize: number
  fileMtime: string
  /** 從檔名萃取的 subagent id（不含 .jsonl） */
  subagentId: string
  /** 所屬的 parent session id */
  parentSessionId: string
  /** 從 *.meta.json 讀取的 agent type（如存在） */
  agentType: string | null
}

/** 掃描到的專案資訊 */
export interface ScannedProject {
  projectId: string
  displayName: string
  sessions: ScannedSession[]
}

/** Subagent session（DB 表對應型別） */
export interface SubagentSession {
  id: string
  parentSessionId: string
  agentType: string | null
  filePath: string
  fileSize: number | null
  fileMtime: string | null
  messageCount: number
  startedAt: string | null
  endedAt: string | null
  createdAt: string
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
  /** API request 識別符，同一 requestId 的多個 entries 共享相同 token usage */
  requestId: string | null
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
