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

/** 索引進度 */
export interface IndexerStatus {
  phase: 'scanning' | 'parsing' | 'indexing' | 'done'
  progress: number
  total: number
  current: number
}
