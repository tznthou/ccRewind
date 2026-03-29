import BetterSqlite3 from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type { Project, SessionMeta, Message, SearchPage } from '../shared/types'

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

/** Migration 定義 */
interface Migration {
  version: number
  description: string
  up: (db: BetterSqlite3.Database) => void
}

/** 重建 message_content / message_archive 表，修正 FK 指向 messages */
function rebuildSideTables(db: BetterSqlite3.Database): void {
  db.exec(`
    ALTER TABLE message_content RENAME TO message_content_old;
    CREATE TABLE message_content (
      message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      content_json TEXT
    );
    INSERT INTO message_content SELECT * FROM message_content_old;
    DROP TABLE message_content_old;

    ALTER TABLE message_archive RENAME TO message_archive_old;
    CREATE TABLE message_archive (
      message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      raw_json TEXT
    );
    INSERT INTO message_archive SELECT * FROM message_archive_old;
    DROP TABLE message_archive_old;
  `)
}

/** 所有 migrations，依 version 遞增排列 */
const migrations: Migration[] = [
  {
    version: 1,
    description: 'split messages: content_json → message_content, raw_json → message_archive',
    up: (db) => {
      // 檢查是否為舊 schema（messages 表有 content_json 欄位）
      // 新建的 DB 已在 initSchema 用 slim schema，不需搬移
      const cols = db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>
      const hasContentJson = cols.some(c => c.name === 'content_json')
      if (!hasContentJson) return // 新 DB，不需 migration

      // 1. 建立新表（IF NOT EXISTS 因為 initSchema 可能已建過空表）
      db.exec(`
        CREATE TABLE IF NOT EXISTS message_content (
          message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
          content_json TEXT
        );

        CREATE TABLE IF NOT EXISTS message_archive (
          message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
          raw_json TEXT
        );
      `)

      // 2. 批量搬移資料（OR IGNORE 防止 initSchema 先建表後殘留資料導致 UNIQUE 衝突）
      db.exec(`
        INSERT OR IGNORE INTO message_content (message_id, content_json)
          SELECT id, content_json FROM messages WHERE content_json IS NOT NULL;

        INSERT OR IGNORE INTO message_archive (message_id, raw_json)
          SELECT id, raw_json FROM messages WHERE raw_json IS NOT NULL;
      `)

      // 3. Rename + recreate slim messages table
      // 注意：ALTER TABLE RENAME 會自動更新所有 FK references 指向新名稱
      // 所以 message_content/message_archive 的 FK 會被改成指向 messages_old
      // 必須在 DROP messages_old 後重建這兩張表
      db.exec(`
        ALTER TABLE messages RENAME TO messages_old;

        CREATE TABLE messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL REFERENCES sessions(id),
          type TEXT NOT NULL,
          role TEXT,
          content_text TEXT,
          has_tool_use INTEGER DEFAULT 0,
          has_tool_result INTEGER DEFAULT 0,
          tool_names TEXT,
          timestamp TEXT,
          sequence INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        INSERT INTO messages (id, session_id, type, role, content_text, has_tool_use, has_tool_result, tool_names, timestamp, sequence, created_at)
          SELECT id, session_id, type, role, content_text, has_tool_use, has_tool_result, tool_names, timestamp, sequence, created_at
          FROM messages_old;

        DROP TABLE messages_old;

        CREATE INDEX idx_messages_session ON messages(session_id, sequence);
      `)

      // 4. 重建 message_content / message_archive（FK 被 RENAME 改壞了）
      rebuildSideTables(db)

      // 5. 重建 FTS5 triggers（舊 trigger 隨 messages_old 一起消失了）
      db.exec(`
        DROP TRIGGER IF EXISTS messages_ai;
        DROP TRIGGER IF EXISTS messages_ad;

        CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
          INSERT INTO messages_fts(rowid, content_text) VALUES (new.id, new.content_text);
        END;

        CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content_text) VALUES ('delete', old.id, old.content_text);
        END;
      `)
    },
  },
  {
    version: 2,
    description: 'add archived column to sessions',
    up: (db) => {
      const cols = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>
      if (cols.some(c => c.name === 'archived')) return // 新 DB 已有
      db.exec('ALTER TABLE sessions ADD COLUMN archived INTEGER DEFAULT 0')
    },
  },
  // v3 被開發期間的臨時 migration 佔用（已 apply 到生產 DB），故跳至 v4
  {
    version: 4,
    description: 'fix FK references broken by v1 rename (message_content/archive → messages)',
    up: (db) => {
      // v1 的 ALTER TABLE messages RENAME TO messages_old 會讓
      // message_content/archive 的 FK 自動被 SQLite 改成指向 messages_old
      const schema = (db.prepare("SELECT sql FROM sqlite_master WHERE name='message_content'").get() as { sql: string })?.sql ?? ''
      if (!schema.includes('messages_old')) return // FK 已正確

      rebuildSideTables(db)
    },
  },
]

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
    this.runMigrations()
  }

  close(): void {
    this.db.close()
  }

  /** ⚠️ 測試專用：接受任意 SQL，禁止接到 IPC handler */
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
        archived INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        type TEXT NOT NULL,
        role TEXT,
        content_text TEXT,
        has_tool_use INTEGER DEFAULT 0,
        has_tool_result INTEGER DEFAULT 0,
        tool_names TEXT,
        timestamp TEXT,
        sequence INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS message_content (
        message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
        content_json TEXT
      );

      CREATE TABLE IF NOT EXISTS message_archive (
        message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
        raw_json TEXT
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

    // schema_version 表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now')),
        description TEXT
      );
    `)
    const hasBaseline = this.db.prepare('SELECT version FROM schema_version WHERE version = 0').get()
    if (!hasBaseline) {
      this.db.prepare("INSERT INTO schema_version (version, description) VALUES (0, 'baseline')").run()
    }
  }

  /** 依序執行尚未套用的 migrations */
  private runMigrations(): void {
    const current = this.getSchemaVersion()
    let migrated = false
    for (const m of migrations) {
      if (m.version <= current) continue
      const migrate = this.db.transaction(() => {
        m.up(this.db)
        this.db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(m.version, m.description)
      })
      migrate()
      migrated = true
    }
    if (migrated) {
      this.db.exec('VACUUM')
    }
  }

  /** 取得目前 schema 版本 */
  getSchemaVersion(): number {
    const row = this.db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null }
    return row?.v ?? 0
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
      'SELECT id, project_id, title, message_count, started_at, ended_at, archived FROM sessions WHERE project_id = ? ORDER BY started_at DESC',
    ).all(projectId) as Array<{
      id: string
      project_id: string
      title: string | null
      message_count: number
      started_at: string | null
      ended_at: string | null
      archived: number
    }>

    return rows.map(r => ({
      id: r.id,
      projectId: r.project_id,
      title: r.title,
      messageCount: r.message_count,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      archived: r.archived === 1,
    }))
  }

  /** 將 DB 中不在 keepIds 集合的 session 標記為 archived（JSONL 已從磁碟消失） */
  archiveStaleSessionsExcept(keepIds: Set<string>): void {
    const allRows = this.db.prepare('SELECT id FROM sessions WHERE archived = 0').all() as Array<{ id: string }>
    const archiveStmt = this.db.prepare('UPDATE sessions SET archived = 1 WHERE id = ?')
    const doArchive = this.db.transaction(() => {
      for (const row of allRows) {
        if (!keepIds.has(row.id)) {
          archiveStmt.run(row.id)
        }
      }
    })
    doArchive()
  }

  /** 一次取得所有 session 的 file_mtime + archived 狀態（增量索引批次比對用） */
  getAllSessionMtimes(): Map<string, { mtime: string; archived: boolean }> {
    const rows = this.db.prepare('SELECT id, file_mtime, archived FROM sessions').all() as Array<{ id: string; file_mtime: string; archived: number }>
    const map = new Map<string, { mtime: string; archived: boolean }>()
    for (const r of rows) {
      map.set(r.id, { mtime: r.file_mtime, archived: r.archived === 1 })
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
      this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(params.sessionId)
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(params.sessionId)
      this.upsertProject(params.projectId, params.projectDisplayName)
      this.db.prepare(`
        INSERT INTO sessions (id, project_id, title, message_count, file_path, file_size, file_mtime, started_at, ended_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        params.sessionId, params.projectId, params.title, params.messageCount,
        params.filePath, params.fileSize, params.fileMtime,
        params.startedAt, params.endedAt,
      )
      const insertMsg = this.db.prepare(`
        INSERT INTO messages (session_id, type, role, content_text, has_tool_use, has_tool_result, tool_names, timestamp, sequence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const insertContent = this.db.prepare(
        'INSERT INTO message_content (message_id, content_json) VALUES (?, ?)',
      )
      const insertArchive = this.db.prepare(
        'INSERT INTO message_archive (message_id, raw_json) VALUES (?, ?)',
      )
      for (const m of params.messages) {
        const result = insertMsg.run(
          params.sessionId, m.type, m.role, m.contentText,
          m.hasToolUse ? 1 : 0, m.hasToolResult ? 1 : 0,
          m.toolNames.length > 0 ? m.toolNames.join(',') : null,
          m.timestamp, m.sequence,
        )
        const msgId = result.lastInsertRowid
        if (m.contentJson != null) {
          insertContent.run(msgId, m.contentJson)
        }
        if (m.rawJson != null) {
          insertArchive.run(msgId, m.rawJson)
        }
      }
    })

    doIndex()
  }

  // ── Messages ──

  getMessages(sessionId: string): Message[] {
    const rows = this.db.prepare(`
      SELECT m.id, m.session_id, m.type, m.role, m.content_text,
             mc.content_json, m.has_tool_use, m.has_tool_result,
             m.tool_names, m.timestamp, m.sequence
      FROM messages m
      LEFT JOIN message_content mc ON mc.message_id = m.id
      WHERE m.session_id = ?
      ORDER BY m.sequence
    `).all(sessionId) as Array<{
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

  static readonly SEARCH_PAGE_SIZE = 30

  search(query: string, projectId?: string | null, offset = 0, limit = Database.SEARCH_PAGE_SIZE): SearchPage {
    limit = Math.min(limit, 100)
    try {
      let sql = `
        SELECT
          m.id AS message_id,
          m.session_id,
          s.title AS session_title,
          s.project_id,
          p.display_name AS project_name,
          snippet(messages_fts, 0, x'EE8080', x'EE8081', '...', 64) AS snippet,
          m.timestamp
        FROM messages_fts
        JOIN messages m ON m.id = messages_fts.rowid
        JOIN sessions s ON s.id = m.session_id
        JOIN projects p ON p.id = s.project_id
        WHERE messages_fts MATCH ?
          AND m.type NOT IN ('last-prompt', 'queue-operation')
      `
      const params: (string | number | null)[] = [query]

      if (projectId) {
        sql += ' AND s.project_id = ?'
        params.push(projectId)
      }

      sql += ' ORDER BY rank LIMIT ? OFFSET ?'
      params.push(limit + 1, offset) // 多取 1 筆判斷 hasMore

      const rows = this.db.prepare(sql).all(...params) as Array<{
        message_id: number
        session_id: string
        session_title: string | null
        project_id: string
        project_name: string
        snippet: string
        timestamp: string | null
      }>

      const hasMore = rows.length > limit
      if (hasMore) rows.pop()
      const results = rows.map(r => ({
        sessionId: r.session_id,
        sessionTitle: r.session_title,
        projectId: r.project_id,
        projectName: r.project_name,
        messageId: r.message_id,
        snippet: r.snippet,
        timestamp: r.timestamp,
      }))

      return { results, offset, hasMore }
    } catch {
      // FTS5 查詢失敗（語法錯誤、未關閉的引號等）→ 回傳空頁
      return { results: [], offset, hasMore: false }
    }
  }
}
