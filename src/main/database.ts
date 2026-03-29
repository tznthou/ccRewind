import BetterSqlite3 from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type { Project, SessionMeta, Message, SearchResult } from '../shared/types'

/** 寫入 messages 時使用的參數型別 */
export interface MessageInput {
  type: string
  role: string | null
  contentText: string | null
  contentJson: string | null
  hasToolUse: boolean
  hasToolResult: boolean
  toolNames: string[]
  timestamp: string | null
  sequence: number
  rawJson: string | null
}

/** indexSession 的參數型別 */
export interface IndexSessionParams {
  sessionId: string
  projectId: string
  projectDisplayName: string
  title: string | null
  messageCount: number
  filePath: string
  fileSize: number
  fileMtime: string
  startedAt: string | null
  endedAt: string | null
  messages: MessageInput[]
}

export class Database {
  private db: BetterSqlite3.Database

  constructor(dbPath: string) {
    // :memory: 不需要建目錄
    if (dbPath !== ':memory:') {
      mkdirSync(path.dirname(dbPath), { recursive: true })
    }
    this.db = new BetterSqlite3(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.initSchema()
  }

  close(): void {
    this.db.close()
  }

  /** 測試用：直接執行 SQL 查詢 */
  rawAll<T>(sql: string): T[] {
    return this.db.prepare(sql).all() as T[]
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        session_count INTEGER DEFAULT 0,
        last_activity_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        title TEXT,
        message_count INTEGER DEFAULT 0,
        file_path TEXT NOT NULL,
        file_size INTEGER,
        file_mtime TEXT,
        started_at TEXT,
        ended_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        type TEXT NOT NULL,
        role TEXT,
        content_text TEXT,
        content_json TEXT,
        has_tool_use INTEGER DEFAULT 0,
        has_tool_result INTEGER DEFAULT 0,
        tool_names TEXT,
        timestamp TEXT,
        sequence INTEGER NOT NULL,
        raw_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id, started_at DESC);
    `)

    // FTS5 虛擬表不支援 IF NOT EXISTS，先查 sqlite_master
    const ftsExists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'",
    ).get()

    if (!ftsExists) {
      this.db.exec(`
        CREATE VIRTUAL TABLE messages_fts USING fts5(
          content_text,
          content='messages',
          content_rowid='id',
          tokenize='unicode61'
        );

        CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
          INSERT INTO messages_fts(rowid, content_text) VALUES (new.id, new.content_text);
        END;

        CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content_text) VALUES ('delete', old.id, old.content_text);
        END;
      `)
    }
  }

  // ── Projects ──

  upsertProject(id: string, displayName: string): void {
    this.db.prepare(`
      INSERT INTO projects (id, display_name)
      VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name
    `).run(id, displayName)
  }

  updateProjectStats(projectId: string): void {
    this.db.prepare(`
      UPDATE projects SET
        session_count = (SELECT COUNT(*) FROM sessions WHERE project_id = ?),
        last_activity_at = (SELECT MAX(ended_at) FROM sessions WHERE project_id = ?)
      WHERE id = ?
    `).run(projectId, projectId, projectId)
  }

  getProjects(): Project[] {
    const rows = this.db.prepare(
      'SELECT id, display_name, session_count, last_activity_at FROM projects ORDER BY last_activity_at DESC',
    ).all() as Array<{
      id: string
      display_name: string
      session_count: number
      last_activity_at: string | null
    }>

    return rows.map(r => ({
      id: r.id,
      displayName: r.display_name,
      sessionCount: r.session_count,
      lastActivityAt: r.last_activity_at,
    }))
  }

  // ── Sessions ──

  getSessionMtime(sessionId: string): string | null {
    const row = this.db.prepare(
      'SELECT file_mtime FROM sessions WHERE id = ?',
    ).get(sessionId) as { file_mtime: string } | undefined

    return row?.file_mtime ?? null
  }

  getSessions(projectId: string): SessionMeta[] {
    const rows = this.db.prepare(
      'SELECT id, project_id, title, message_count, started_at, ended_at FROM sessions WHERE project_id = ? ORDER BY started_at DESC',
    ).all(projectId) as Array<{
      id: string
      project_id: string
      title: string | null
      message_count: number
      started_at: string | null
      ended_at: string | null
    }>

    return rows.map(r => ({
      id: r.id,
      projectId: r.project_id,
      title: r.title,
      messageCount: r.message_count,
      startedAt: r.started_at,
      endedAt: r.ended_at,
    }))
  }

  /** 移除 DB 中不在 keepIds 集合的 session（清理已刪除的 JSONL） */
  removeStaleSessionsExcept(keepIds: Set<string>): void {
    const allRows = this.db.prepare('SELECT id FROM sessions').all() as Array<{ id: string }>
    const delMessages = this.db.prepare('DELETE FROM messages WHERE session_id = ?')
    const delSession = this.db.prepare('DELETE FROM sessions WHERE id = ?')
    const doRemove = this.db.transaction(() => {
      for (const row of allRows) {
        if (!keepIds.has(row.id)) {
          delMessages.run(row.id)
          delSession.run(row.id)
        }
      }
    })
    doRemove()
  }

  /** 一次取得所有 session 的 file_mtime（增量索引批次比對用） */
  getAllSessionMtimes(): Map<string, string> {
    const rows = this.db.prepare('SELECT id, file_mtime FROM sessions').all() as Array<{ id: string; file_mtime: string }>
    const map = new Map<string, string>()
    for (const r of rows) {
      map.set(r.id, r.file_mtime)
    }
    return map
  }

  /** 取得匯出所需的 session metadata（含專案名稱） */
  getSessionForExport(sessionId: string): {
    title: string | null
    projectName: string
    startedAt: string | null
    endedAt: string | null
  } | null {
    const row = this.db.prepare(
      'SELECT s.title, p.display_name AS project_name, s.started_at, s.ended_at FROM sessions s JOIN projects p ON p.id = s.project_id WHERE s.id = ?',
    ).get(sessionId) as {
      title: string | null
      project_name: string
      started_at: string | null
      ended_at: string | null
    } | undefined

    if (!row) return null
    return {
      title: row.title,
      projectName: row.project_name,
      startedAt: row.started_at,
      endedAt: row.ended_at,
    }
  }

  // ── Atomic session indexing ──

  indexSession(params: IndexSessionParams): void {
    const doIndex = this.db.transaction(() => {
      // 1. 先刪除舊 messages（觸發 FTS5 delete trigger）
      this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(params.sessionId)
      // 2. 刪除舊 session
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(params.sessionId)
      // 3. Upsert project（重用 upsertProject 避免 SQL 重複）
      this.upsertProject(params.projectId, params.projectDisplayName)
      // 4. Insert session
      this.db.prepare(`
        INSERT INTO sessions (id, project_id, title, message_count, file_path, file_size, file_mtime, started_at, ended_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        params.sessionId, params.projectId, params.title, params.messageCount,
        params.filePath, params.fileSize, params.fileMtime,
        params.startedAt, params.endedAt,
      )
      // 5. Bulk insert messages
      const insertMsg = this.db.prepare(`
        INSERT INTO messages (session_id, type, role, content_text, content_json, has_tool_use, has_tool_result, tool_names, timestamp, sequence, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const m of params.messages) {
        insertMsg.run(
          params.sessionId, m.type, m.role, m.contentText, m.contentJson,
          m.hasToolUse ? 1 : 0, m.hasToolResult ? 1 : 0,
          m.toolNames.length > 0 ? m.toolNames.join(',') : null,
          m.timestamp, m.sequence, m.rawJson,
        )
      }
    })

    doIndex()
  }

  // ── Messages ──

  getMessages(sessionId: string): Message[] {
    const rows = this.db.prepare(
      'SELECT id, session_id, type, role, content_text, content_json, has_tool_use, has_tool_result, tool_names, timestamp, sequence FROM messages WHERE session_id = ? ORDER BY sequence',
    ).all(sessionId) as Array<{
      id: number
      session_id: string
      type: string
      role: string | null
      content_text: string | null
      content_json: string | null
      has_tool_use: number
      has_tool_result: number
      tool_names: string | null
      timestamp: string | null
      sequence: number
    }>

    return rows.map(r => ({
      id: r.id,
      sessionId: r.session_id,
      type: r.type as Message['type'],
      role: r.role as Message['role'],
      contentText: r.content_text,
      contentJson: r.content_json,
      hasToolUse: r.has_tool_use === 1,
      hasToolResult: r.has_tool_result === 1,
      toolNames: r.tool_names ? r.tool_names.split(',') : null,
      timestamp: r.timestamp,
      sequence: r.sequence,
    }))
  }

  // ── FTS5 Search ──

  search(query: string, projectId?: string | null): SearchResult[] {
    try {
      let sql = `
        SELECT
          m.id AS message_id,
          m.session_id,
          s.title AS session_title,
          s.project_id,
          p.display_name AS project_name,
          snippet(messages_fts, 0, '<mark>', '</mark>', '...', 32) AS snippet,
          m.timestamp
        FROM messages_fts
        JOIN messages m ON m.id = messages_fts.rowid
        JOIN sessions s ON s.id = m.session_id
        JOIN projects p ON p.id = s.project_id
        WHERE messages_fts MATCH ?
          AND m.type NOT IN ('last-prompt', 'queue-operation')
      `
      const params: (string | null)[] = [query]

      if (projectId) {
        sql += ' AND s.project_id = ?'
        params.push(projectId)
      }

      sql += ' ORDER BY rank LIMIT 100'

      const rows = this.db.prepare(sql).all(...params) as Array<{
        message_id: number
        session_id: string
        session_title: string | null
        project_id: string
        project_name: string
        snippet: string
        timestamp: string | null
      }>

      return rows.map(r => ({
        sessionId: r.session_id,
        sessionTitle: r.session_title,
        projectId: r.project_id,
        projectName: r.project_name,
        messageId: r.message_id,
        snippet: r.snippet,
        timestamp: r.timestamp,
      }))
    } catch {
      // FTS5 查詢失敗（語法錯誤、未關閉的引號等）→ 回傳空陣列
      // DB 連線等嚴重錯誤會在其他操作（indexSession, getMessages）時拋出
      return []
    }
  }
}
