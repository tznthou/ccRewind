import BetterSqlite3 from 'better-sqlite3'
import { mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import type { Project, SessionMeta, Message, MessageContext, SearchPage, SearchOptions, SessionSearchPage, SessionTokenStats, SessionFile, FileOperation, OutcomeStatus, DailyUsage, ProjectStats, DistributionItem, WorkPatterns, DailyEfficiency, WasteSession, ProjectHealth, RelatedSession, FileHistoryEntry, SubagentSession, ExclusionRule, ExclusionRuleInput, ExclusionPreview, StorageStats, ProjectBreakdown, InactiveSession, DatabaseMaintenanceStats, CompactResult } from '../shared/types'

/** 寫入 messages 時使用的參數型別 */
export interface MessageInput {
  type: string
  uuid: string | null
  role: string | null
  contentText: string | null
  contentJson: string | null
  hasToolUse: boolean
  hasToolResult: boolean
  toolNames: string[]
  timestamp: string | null
  sequence: number
  rawJson: string | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
  model: string | null
}

/** session_files 寫入用型別 */
export interface SessionFileInput {
  filePath: string
  operation: FileOperation
  count: number
  firstSeenSeq: number
  lastSeenSeq: number
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
  summaryText?: string | null
  intentText?: string | null
  outcomeStatus?: OutcomeStatus
  outcomeSignals?: string | null
  durationSeconds?: number | null
  activeDurationSeconds?: number | null
  summaryVersion?: number | null
  tags?: string | null
  filesTouched?: string | null
  toolsUsed?: string | null
  sessionFiles?: SessionFileInput[]
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
  {
    version: 5,
    description: 'add session summary columns (summary_text, tags, files_touched, tools_used)',
    up: (db) => {
      const cols = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
      if (cols.some(c => c.name === 'summary_text')) return
      db.exec(`
        ALTER TABLE sessions ADD COLUMN summary_text TEXT;
        ALTER TABLE sessions ADD COLUMN tags TEXT;
        ALTER TABLE sessions ADD COLUMN files_touched TEXT;
        ALTER TABLE sessions ADD COLUMN tools_used TEXT;
      `)
      // 清空 file_mtime 強制所有既有 session 在下次 indexer run 時 re-index
      db.exec("UPDATE sessions SET file_mtime = NULL")
    },
  },
  {
    version: 6,
    description: 'add sessions_fts for session-level search (title, tags, files_touched, summary_text)',
    up: (db) => {
      const exists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions_fts'",
      ).get()
      if (exists) return
      db.exec(`
        CREATE VIRTUAL TABLE sessions_fts USING fts5(
          title,
          tags,
          files_touched,
          summary_text,
          content='sessions',
          content_rowid='rowid',
          tokenize='unicode61'
        );
      `)
      // 回填既有 session 資料
      db.exec(`
        INSERT INTO sessions_fts(rowid, title, tags, files_touched, summary_text)
        SELECT rowid, COALESCE(title,''), COALESCE(tags,''), COALESCE(files_touched,''), COALESCE(summary_text,'')
        FROM sessions;
      `)
    },
  },
  {
    version: 7,
    description: 'add token usage columns to messages and sessions (Phase 2.5 Context Budget)',
    up: (db) => {
      const msgCols = db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>
      if (msgCols.some(c => c.name === 'input_tokens')) return
      db.exec(`
        ALTER TABLE messages ADD COLUMN input_tokens INTEGER;
        ALTER TABLE messages ADD COLUMN output_tokens INTEGER;
        ALTER TABLE messages ADD COLUMN cache_read_tokens INTEGER;
        ALTER TABLE messages ADD COLUMN cache_creation_tokens INTEGER;
        ALTER TABLE messages ADD COLUMN model TEXT;
        ALTER TABLE sessions ADD COLUMN total_input_tokens INTEGER;
        ALTER TABLE sessions ADD COLUMN total_output_tokens INTEGER;
      `)
      // 清空 file_mtime 強制 re-index，讓既有 session 填入 token 資料
      db.exec("UPDATE sessions SET file_mtime = NULL")
    },
  },
  {
    version: 8,
    description: 'Phase 3: structured summary + session_files reverse index',
    up: (db) => {
      const cols = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
      if (!cols.some(c => c.name === 'intent_text')) {
        db.exec(`
          ALTER TABLE sessions ADD COLUMN intent_text TEXT;
          ALTER TABLE sessions ADD COLUMN outcome_status TEXT;
          ALTER TABLE sessions ADD COLUMN outcome_signals TEXT;
          ALTER TABLE sessions ADD COLUMN duration_seconds INTEGER;
          ALTER TABLE sessions ADD COLUMN summary_version INTEGER;
        `)
      }
      // session_files 反向索引表
      db.exec(`
        CREATE TABLE IF NOT EXISTS session_files (
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          file_path TEXT NOT NULL,
          operation TEXT NOT NULL,
          count INTEGER DEFAULT 1,
          first_seen_seq INTEGER,
          last_seen_seq INTEGER,
          PRIMARY KEY (session_id, file_path, operation)
        );
        CREATE INDEX IF NOT EXISTS idx_session_files_path ON session_files(file_path);
        CREATE INDEX IF NOT EXISTS idx_session_files_session ON session_files(session_id);
      `)
      // 清空 file_mtime 強制全量 re-index
      db.exec("UPDATE sessions SET file_mtime = NULL")
    },
  },
  {
    version: 9,
    description: 'rebuild sessions_fts with intent_text column for search enhancement',
    up: (db) => {
      db.exec(`
        DROP TABLE IF EXISTS sessions_fts;
        CREATE VIRTUAL TABLE sessions_fts USING fts5(
          title,
          tags,
          files_touched,
          summary_text,
          intent_text,
          content='sessions',
          content_rowid='rowid',
          tokenize='unicode61'
        );
        INSERT INTO sessions_fts(rowid, title, tags, files_touched, summary_text, intent_text)
        SELECT rowid, COALESCE(title,''), COALESCE(tags,''), COALESCE(files_touched,''),
               COALESCE(summary_text,''), COALESCE(intent_text,'')
        FROM sessions;
      `)
    },
  },
  {
    version: 10,
    description: 'add uuid column to messages for cross-session dedup (resumed sessions)',
    up: (db) => {
      const cols = db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>
      if (cols.some(c => c.name === 'uuid')) return
      db.exec(`
        ALTER TABLE messages ADD COLUMN uuid TEXT;
        CREATE INDEX idx_messages_uuid ON messages(uuid);
      `)
      // 強制全量 re-index，讓既有 messages 填入 uuid
      db.exec("UPDATE sessions SET file_mtime = NULL")
    },
  },
  {
    version: 11,
    description: 'add active_duration_seconds column to sessions',
    up: (db) => {
      const cols = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
      if (cols.some(c => c.name === 'active_duration_seconds')) return
      db.exec('ALTER TABLE sessions ADD COLUMN active_duration_seconds INTEGER')
      // 強制全量 re-index，讓既有 sessions 填入 active_duration_seconds
      db.exec("UPDATE sessions SET file_mtime = NULL")
    },
  },
  {
    version: 12,
    description: 'add subagent_sessions table for subagent file scanning',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS subagent_sessions (
          id TEXT PRIMARY KEY,
          parent_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          agent_type TEXT,
          file_path TEXT NOT NULL,
          file_size INTEGER,
          file_mtime TEXT,
          message_count INTEGER DEFAULT 0,
          started_at TEXT,
          ended_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_subagent_parent ON subagent_sessions(parent_session_id);
      `)
    },
  },
  {
    version: 13,
    description: 'force re-index to fix UUID self-dedup bug (v12 re-index dropped messages with uuid)',
    up: (db) => {
      db.exec("UPDATE sessions SET file_mtime = NULL")
    },
  },
  {
    version: 14,
    description: 'force re-index for requestId token dedup (fix ~2.3x inflated token counts)',
    up: (db) => {
      db.exec("UPDATE sessions SET file_mtime = NULL")
      db.exec("UPDATE subagent_sessions SET file_mtime = NULL")
    },
  },
  {
    version: 15,
    description: 'force re-index to strip system XML from contentText',
    up: (db) => {
      db.exec("UPDATE sessions SET file_mtime = NULL")
      db.exec("UPDATE subagent_sessions SET file_mtime = NULL")
    },
  },
  {
    version: 16,
    description: 'add exclusion_rules table for storage management (composite project + date range rules)',
    up: (db) => {
      const exists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='exclusion_rules'",
      ).get()
      if (exists) return
      db.exec(`
        CREATE TABLE exclusion_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id TEXT REFERENCES projects(id),
          date_from TEXT,
          date_to TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          CHECK (project_id IS NOT NULL OR date_from IS NOT NULL OR date_to IS NOT NULL)
        );
        CREATE INDEX idx_exclusion_project ON exclusion_rules(project_id);
      `)
    },
  },
  {
    version: 17,
    description: 'clear legacy message_archive rows (parser now only stores raw_json for unknown types)',
    up: (db) => {
      db.exec('DELETE FROM message_archive')
    },
  },
]

/** DB SELECT messages 的原始行型別 */
interface MessageRow {
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
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cache_creation_tokens: number | null
  model: string | null
}

/** MessageRow → Message 轉換 */
function mapMessageRow(r: MessageRow): Message {
  return {
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
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheReadTokens: r.cache_read_tokens,
    cacheCreationTokens: r.cache_creation_tokens,
    model: r.model,
  }
}

export class Database {
  private db: BetterSqlite3.Database

  /** Subagent 排除子查詢：用於所有面向使用者的 query，只顯示主 session */
  private static readonly EXCLUDE_SUBAGENTS = 'NOT IN (SELECT id FROM subagent_sessions)'

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

      CREATE TABLE IF NOT EXISTS session_files (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        operation TEXT NOT NULL,
        count INTEGER DEFAULT 1,
        first_seen_seq INTEGER,
        last_seen_seq INTEGER,
        PRIMARY KEY (session_id, file_path, operation)
      );

      CREATE TABLE IF NOT EXISTS subagent_sessions (
        id TEXT PRIMARY KEY,
        parent_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        agent_type TEXT,
        file_path TEXT NOT NULL,
        file_size INTEGER,
        file_mtime TEXT,
        message_count INTEGER DEFAULT 0,
        started_at TEXT,
        ended_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS exclusion_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT REFERENCES projects(id),
        date_from TEXT,
        date_to TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK (project_id IS NOT NULL OR date_from IS NOT NULL OR date_to IS NOT NULL)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_session_files_path ON session_files(file_path);
      CREATE INDEX IF NOT EXISTS idx_session_files_session ON session_files(session_id);
      CREATE INDEX IF NOT EXISTS idx_subagent_parent ON subagent_sessions(parent_session_id);
      CREATE INDEX IF NOT EXISTS idx_exclusion_project ON exclusion_rules(project_id);
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
        session_count = (SELECT COUNT(*) FROM sessions WHERE project_id = ? AND id ${Database.EXCLUDE_SUBAGENTS}),
        last_activity_at = (SELECT MAX(ended_at) FROM sessions WHERE project_id = ? AND id ${Database.EXCLUDE_SUBAGENTS})
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
      `SELECT id, project_id, title, message_count, started_at, ended_at, archived,
              summary_text, intent_text, outcome_status, duration_seconds, active_duration_seconds, summary_version,
              tags, files_touched, tools_used, total_input_tokens, total_output_tokens
       FROM sessions
       WHERE project_id = ?
         AND id ${Database.EXCLUDE_SUBAGENTS}
       ORDER BY started_at DESC`,
    ).all(projectId) as Array<{
      id: string
      project_id: string
      title: string | null
      message_count: number
      started_at: string | null
      ended_at: string | null
      archived: number
      summary_text: string | null
      intent_text: string | null
      outcome_status: string | null
      duration_seconds: number | null
      active_duration_seconds: number | null
      summary_version: number | null
      tags: string | null
      files_touched: string | null
      tools_used: string | null
      total_input_tokens: number | null
      total_output_tokens: number | null
    }>

    return rows.map(r => ({
      id: r.id,
      projectId: r.project_id,
      title: r.title,
      messageCount: r.message_count,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      archived: r.archived === 1,
      summaryText: r.summary_text,
      intentText: r.intent_text,
      outcomeStatus: (r.outcome_status as OutcomeStatus) ?? null,
      durationSeconds: r.duration_seconds,
      activeDurationSeconds: r.active_duration_seconds,
      summaryVersion: r.summary_version,
      tags: r.tags,
      filesTouched: r.files_touched,
      toolsUsed: r.tools_used,
      totalInputTokens: r.total_input_tokens,
      totalOutputTokens: r.total_output_tokens,
    }))
  }

  /** 將 DB 中不在 keepIds 集合的 session 標記為 archived（JSONL 已從磁碟消失），排除 subagent sessions */
  archiveStaleSessionsExcept(keepIds: Set<string>): void {
    const allRows = this.db.prepare(`SELECT id FROM sessions WHERE archived = 0 AND id ${Database.EXCLUDE_SUBAGENTS}`).all() as Array<{ id: string }>
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

  // ── Subagent sessions ──

  /** 寫入 subagent session 記錄（upsert：重複 id 更新 mtime/count） */
  indexSubagentSession(params: {
    id: string
    parentSessionId: string
    agentType: string | null
    filePath: string
    fileSize: number | null
    fileMtime: string | null
    messageCount: number
    startedAt: string | null
    endedAt: string | null
  }): void {
    this.db.prepare(`
      INSERT INTO subagent_sessions (id, parent_session_id, agent_type, file_path, file_size, file_mtime, message_count, started_at, ended_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        agent_type = excluded.agent_type,
        file_size = excluded.file_size,
        file_mtime = excluded.file_mtime,
        message_count = excluded.message_count,
        started_at = excluded.started_at,
        ended_at = excluded.ended_at
    `).run(
      params.id, params.parentSessionId, params.agentType,
      params.filePath, params.fileSize, params.fileMtime,
      params.messageCount, params.startedAt, params.endedAt,
    )
  }

  /** 取得指定 parent session 下的所有 subagent sessions */
  getSubagentSessions(parentSessionId: string): SubagentSession[] {
    const rows = this.db.prepare(
      `SELECT id, parent_session_id, agent_type, file_path, file_size, file_mtime,
              message_count, started_at, ended_at, created_at
       FROM subagent_sessions WHERE parent_session_id = ? ORDER BY started_at`,
    ).all(parentSessionId) as Array<{
      id: string
      parent_session_id: string
      agent_type: string | null
      file_path: string
      file_size: number | null
      file_mtime: string | null
      message_count: number
      started_at: string | null
      ended_at: string | null
      created_at: string
    }>

    return rows.map(r => ({
      id: r.id,
      parentSessionId: r.parent_session_id,
      agentType: r.agent_type,
      filePath: r.file_path,
      fileSize: r.file_size,
      fileMtime: r.file_mtime,
      messageCount: r.message_count,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      createdAt: r.created_at,
    }))
  }

  /** 刪除指定 parent session 的所有 subagent sessions */
  deleteSubagentSessions(parentSessionId: string): void {
    this.db.prepare('DELETE FROM subagent_sessions WHERE parent_session_id = ?').run(parentSessionId)
  }

  /** 刪除單一 subagent session（含對應的 sessions/messages 資料） */
  deleteSubagentSession(subagentId: string): void {
    const doDelete = this.db.transaction(() => {
      this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(subagentId)
      this.db.prepare('DELETE FROM session_files WHERE session_id = ?').run(subagentId)
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(subagentId)
      this.db.prepare('DELETE FROM subagent_sessions WHERE id = ?').run(subagentId)
    })
    doDelete()
  }

  /** 取得指定 parent session 的所有 subagent ID */
  getSubagentSessionIds(parentSessionId: string): string[] {
    const rows = this.db.prepare('SELECT id FROM subagent_sessions WHERE parent_session_id = ?').all(parentSessionId) as Array<{ id: string }>
    return rows.map(r => r.id)
  }

  /** 在單一 transaction 中執行多個 DB 操作 */
  runTransaction(fn: () => void): void {
    const tx = this.db.transaction(fn)
    tx()
  }

  /** 一次取得所有 subagent sessions 的 file_mtime（增量比對用） */
  getAllSubagentMtimes(): Map<string, string> {
    const rows = this.db.prepare('SELECT id, file_mtime FROM subagent_sessions').all() as Array<{ id: string; file_mtime: string | null }>
    const map = new Map<string, string>()
    for (const r of rows) {
      if (r.file_mtime) map.set(r.id, r.file_mtime)
    }
    return map
  }

  // ── UUID dedup helper ──

  /** 查詢 DB 中已存在的 uuid（用於跨 session 去重 resumed session replay） */
  getExistingUuids(uuids: string[], excludeSessionId: string): Set<string> {
    const result = new Set<string>()
    for (let i = 0; i < uuids.length; i += 500) {
      const chunk = uuids.slice(i, i + 500)
      const placeholders = chunk.map(() => '?').join(',')
      const rows = this.db.prepare(
        `SELECT uuid FROM messages WHERE session_id != ? AND uuid IN (${placeholders})`,
      ).all(excludeSessionId, ...chunk) as Array<{ uuid: string }>
      for (const r of rows) result.add(r.uuid)
    }
    return result
  }

  // ── Atomic session indexing ──

  indexSession(params: IndexSessionParams): void {
    const doIndex = this.db.transaction(() => {
      this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(params.sessionId)
      // 清除 sessions_fts 中的舊資料（external content 模式需手動維護）
      const oldSession = this.db.prepare('SELECT rowid, title, tags, files_touched, summary_text, intent_text FROM sessions WHERE id = ?').get(params.sessionId) as
        { rowid: number; title: string | null; tags: string | null; files_touched: string | null; summary_text: string | null; intent_text: string | null } | undefined
      if (oldSession) {
        this.db.prepare(
          "INSERT INTO sessions_fts(sessions_fts, rowid, title, tags, files_touched, summary_text, intent_text) VALUES ('delete', ?, ?, ?, ?, ?, ?)",
        ).run(oldSession.rowid, oldSession.title ?? '', oldSession.tags ?? '', oldSession.files_touched ?? '', oldSession.summary_text ?? '', oldSession.intent_text ?? '')
      }
      this.db.prepare('DELETE FROM session_files WHERE session_id = ?').run(params.sessionId)
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(params.sessionId)
      this.upsertProject(params.projectId, params.projectDisplayName)
      // 計算 token 彙總
      let totalInput = 0
      let totalOutput = 0
      for (const m of params.messages) {
        if (m.inputTokens != null) totalInput += m.inputTokens
        if (m.outputTokens != null) totalOutput += m.outputTokens
      }
      const insertResult = this.db.prepare(`
        INSERT INTO sessions (id, project_id, title, message_count, file_path, file_size, file_mtime, started_at, ended_at,
          summary_text, intent_text, outcome_status, outcome_signals, duration_seconds, active_duration_seconds, summary_version,
          tags, files_touched, tools_used, total_input_tokens, total_output_tokens)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        params.sessionId, params.projectId, params.title, params.messageCount,
        params.filePath, params.fileSize, params.fileMtime,
        params.startedAt, params.endedAt,
        params.summaryText ?? null, params.intentText ?? null,
        params.outcomeStatus ?? null, params.outcomeSignals ?? null,
        params.durationSeconds ?? null, params.activeDurationSeconds ?? null, params.summaryVersion ?? null,
        params.tags ?? null,
        params.filesTouched ?? null, params.toolsUsed ?? null,
        totalInput || null, totalOutput || null,
      )
      // 新增 sessions_fts 條目（用 INSERT 回傳的 rowid 避免多餘查詢）
      this.db.prepare(
        'INSERT INTO sessions_fts(rowid, title, tags, files_touched, summary_text, intent_text) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(insertResult.lastInsertRowid, params.title ?? '', params.tags ?? '', params.filesTouched ?? '', params.summaryText ?? '', params.intentText ?? '')
      // 寫入 session_files
      if (params.sessionFiles && params.sessionFiles.length > 0) {
        const insertFile = this.db.prepare(`
          INSERT INTO session_files (session_id, file_path, operation, count, first_seen_seq, last_seen_seq)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        for (const f of params.sessionFiles) {
          insertFile.run(params.sessionId, f.filePath, f.operation, f.count, f.firstSeenSeq, f.lastSeenSeq)
        }
      }
      const insertMsg = this.db.prepare(`
        INSERT INTO messages (session_id, type, role, content_text, has_tool_use, has_tool_result, tool_names, timestamp, sequence, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, model, uuid)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          m.inputTokens, m.outputTokens, m.cacheReadTokens, m.cacheCreationTokens, m.model,
          m.uuid,
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

  // ── Messages ─���

  getMessages(sessionId: string): Message[] {
    const rows = this.db.prepare(`
      SELECT m.id, m.session_id, m.type, m.role, m.content_text,
             mc.content_json, m.has_tool_use, m.has_tool_result,
             m.tool_names, m.timestamp, m.sequence,
             m.input_tokens, m.output_tokens, m.cache_read_tokens, m.cache_creation_tokens, m.model
      FROM messages m
      LEFT JOIN message_content mc ON mc.message_id = m.id
      WHERE m.session_id = ?
      ORDER BY m.sequence
    `).all(sessionId) as Array<MessageRow>

    return rows.map(mapMessageRow)
  }

  /** 取得指定訊息及其前後 range 則訊息（搜尋結果上下文預覽） */
  getMessageContext(messageId: number, range = 2): MessageContext {
    const msgSelect = `
      SELECT m.id, m.session_id, m.type, m.role, m.content_text,
             mc.content_json, m.has_tool_use, m.has_tool_result,
             m.tool_names, m.timestamp, m.sequence,
             m.input_tokens, m.output_tokens, m.cache_read_tokens, m.cache_creation_tokens, m.model
      FROM messages m
      LEFT JOIN message_content mc ON mc.message_id = m.id
    `

    const target = this.db.prepare(`${msgSelect} WHERE m.id = ?`).get(messageId) as MessageRow | undefined

    if (!target) {
      return { target: null, before: [], after: [] }
    }

    const beforeRows = this.db.prepare(
      `${msgSelect} WHERE m.session_id = ? AND m.sequence < ? AND m.sequence >= ? ORDER BY m.sequence`,
    ).all(target.session_id, target.sequence, target.sequence - range) as MessageRow[]

    const afterRows = this.db.prepare(
      `${msgSelect} WHERE m.session_id = ? AND m.sequence > ? AND m.sequence <= ? ORDER BY m.sequence`,
    ).all(target.session_id, target.sequence, target.sequence + range) as MessageRow[]

    return {
      target: mapMessageRow(target),
      before: beforeRows.map(mapMessageRow),
      after: afterRows.map(mapMessageRow),
    }
  }

  // ── FTS5 Search ──

  static readonly SEARCH_PAGE_SIZE = 30

  private static readonly VALID_OUTCOMES = new Set(['committed', 'tested', 'in-progress', 'quick-qa'])
  private static parseOutcomeStatus(v: string | null): OutcomeStatus {
    return v && Database.VALID_OUTCOMES.has(v) ? v as OutcomeStatus : null
  }

  /** FTS5 安全引號包裹：對含分詞符號的查詢包引號，並跳脫內部引號 */
  private static fts5QuoteIfNeeded(query: string): string {
    if (/[/.\\-]/.test(query) && !query.startsWith('"')) {
      return `"${query.replace(/"/g, '""')}"`
    }
    return query
  }

  search(query: string, projectId?: string | null, offset = 0, limit = Database.SEARCH_PAGE_SIZE, options?: SearchOptions): SearchPage {
    limit = Math.min(limit, 100)
    query = Database.fts5QuoteIfNeeded(query)
    try {
      let sql = `
        SELECT
          m.id AS message_id,
          m.session_id,
          s.title AS session_title,
          s.project_id,
          p.display_name AS project_name,
          snippet(messages_fts, 0, x'EE8080', x'EE8081', '...', 128) AS snippet,
          m.timestamp,
          s.started_at AS session_started_at
        FROM messages_fts
        JOIN messages m ON m.id = messages_fts.rowid
        JOIN sessions s ON s.id = m.session_id
        JOIN projects p ON p.id = s.project_id
        WHERE messages_fts MATCH ?
          AND m.type NOT IN ('last-prompt', 'queue-operation')
          AND s.id ${Database.EXCLUDE_SUBAGENTS}
      `
      const params: (string | number | null)[] = [query]

      if (projectId) {
        sql += ' AND s.project_id = ?'
        params.push(projectId)
      }
      if (options?.dateFrom) {
        sql += ' AND date(s.started_at) >= ?'
        params.push(options.dateFrom)
      }
      if (options?.dateTo) {
        sql += ' AND date(s.started_at) <= ?'
        params.push(options.dateTo)
      }

      sql += options?.sortBy === 'date' ? ' ORDER BY m.timestamp DESC, m.id DESC' : ' ORDER BY rank, m.id DESC'
      sql += ' LIMIT ? OFFSET ?'
      params.push(limit + 1, offset) // 多取 1 筆判斷 hasMore

      const rows = this.db.prepare(sql).all(...params) as Array<{
        message_id: number
        session_id: string
        session_title: string | null
        project_id: string
        project_name: string
        snippet: string
        timestamp: string | null
        session_started_at: string | null
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
        sessionStartedAt: r.session_started_at,
      }))

      return { results, offset, hasMore }
    } catch {
      // FTS5 查詢失敗（語法錯誤、未關閉的引號等）→ 回傳空頁
      return { results: [], offset, hasMore: false }
    }
  }

  /** 搜尋 session 標題 / 標籤 / 檔案路徑 / 摘要 / 意圖 */
  searchSessions(query: string, projectId?: string | null, offset = 0, limit = Database.SEARCH_PAGE_SIZE, options?: SearchOptions): SessionSearchPage {
    limit = Math.min(limit, 100)
    query = Database.fts5QuoteIfNeeded(query)
    try {
      let sql = `
        SELECT
          s.id AS session_id,
          s.title AS session_title,
          s.project_id,
          p.display_name AS project_name,
          s.tags,
          s.files_touched,
          snippet(sessions_fts, -1, x'EE8080', x'EE8081', '...', 128) AS snippet,
          s.started_at,
          s.outcome_status
        FROM sessions_fts
        JOIN sessions s ON s.rowid = sessions_fts.rowid
        JOIN projects p ON p.id = s.project_id
        WHERE sessions_fts MATCH ?
          AND s.id ${Database.EXCLUDE_SUBAGENTS}
      `
      const params: (string | number | null)[] = [query]

      if (projectId) {
        sql += ' AND s.project_id = ?'
        params.push(projectId)
      }
      if (options?.dateFrom) {
        sql += ' AND date(s.started_at) >= ?'
        params.push(options.dateFrom)
      }
      if (options?.dateTo) {
        sql += ' AND date(s.started_at) <= ?'
        params.push(options.dateTo)
      }

      sql += options?.sortBy === 'date' ? ' ORDER BY s.started_at DESC, s.rowid DESC' : ' ORDER BY rank, s.rowid DESC'
      sql += ' LIMIT ? OFFSET ?'
      params.push(limit + 1, offset)

      const rows = this.db.prepare(sql).all(...params) as Array<{
        session_id: string
        session_title: string | null
        project_id: string
        project_name: string
        tags: string | null
        files_touched: string | null
        snippet: string
        started_at: string | null
        outcome_status: string | null
      }>

      const hasMore = rows.length > limit
      if (hasMore) rows.pop()
      const results = rows.map(r => ({
        sessionId: r.session_id,
        sessionTitle: r.session_title,
        projectId: r.project_id,
        projectName: r.project_name,
        tags: r.tags,
        filesTouched: r.files_touched,
        snippet: r.snippet,
        startedAt: r.started_at,
        outcomeStatus: Database.parseOutcomeStatus(r.outcome_status),
      }))

      return { results, offset, hasMore }
    } catch {
      return { results: [], offset, hasMore: false }
    }
  }

  // ── Token Stats ──

  getSessionTokenStats(sessionId: string): SessionTokenStats {
    const rows = this.db.prepare(`
      SELECT sequence, timestamp,
             input_tokens, output_tokens,
             cache_read_tokens, cache_creation_tokens,
             has_tool_use, tool_names, model
      FROM messages
      WHERE session_id = ? AND input_tokens IS NOT NULL
      ORDER BY sequence
    `).all(sessionId) as Array<{
      sequence: number
      timestamp: string | null
      input_tokens: number
      output_tokens: number
      cache_read_tokens: number
      cache_creation_tokens: number
      has_tool_use: number
      tool_names: string | null
      model: string | null
    }>

    let totalInput = 0
    let totalOutput = 0
    let totalCacheRead = 0
    let totalCacheCreation = 0
    const modelCounts = new Map<string, number>()

    const turns: SessionTokenStats['turns'] = rows.map(r => {
      totalInput += r.input_tokens
      totalOutput += r.output_tokens
      totalCacheRead += r.cache_read_tokens
      totalCacheCreation += r.cache_creation_tokens
      if (r.model) modelCounts.set(r.model, (modelCounts.get(r.model) ?? 0) + 1)

      return {
        sequence: r.sequence,
        timestamp: r.timestamp,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        cacheReadTokens: r.cache_read_tokens,
        cacheCreationTokens: r.cache_creation_tokens,
        contextTotal: r.input_tokens,
        hasToolUse: r.has_tool_use === 1,
        toolNames: r.tool_names ? r.tool_names.split(',') : [],
        model: r.model,
      }
    })

    const models = [...modelCounts.keys()]
    let primaryModel: string | null = null
    let maxCount = 0
    for (const [m, c] of modelCounts) {
      if (c > maxCount) { primaryModel = m; maxCount = c }
    }

    return {
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCacheReadTokens: totalCacheRead,
      totalCacheCreationTokens: totalCacheCreation,
      cacheHitRate: totalInput > 0 ? totalCacheRead / totalInput : 0,
      models,
      primaryModel,
      turns,
    }
  }

  // ── Session Files (Reverse Index) ──

  /** 反向查詢：某檔案出現在哪些 session（按時間倒序） */
  getFileHistory(filePath: string): FileHistoryEntry[] {
    const rows = this.db.prepare(`
      SELECT sf.session_id, s.title AS session_title, s.project_id, p.display_name AS project_name,
             sf.operation, sf.count, s.started_at
      FROM session_files sf
      JOIN sessions s ON s.id = sf.session_id
      JOIN projects p ON p.id = s.project_id
      WHERE sf.file_path = ?
        AND s.id ${Database.EXCLUDE_SUBAGENTS}
      ORDER BY s.started_at DESC
    `).all(filePath) as Array<{
      session_id: string
      session_title: string | null
      project_id: string
      project_name: string
      operation: FileOperation
      count: number
      started_at: string | null
    }>
    return rows.map(r => ({
      sessionId: r.session_id,
      sessionTitle: r.session_title,
      projectId: r.project_id,
      projectName: r.project_name,
      operation: r.operation,
      count: r.count,
      startedAt: r.started_at,
    }))
  }

  /** 正向查詢：某 session 操作了哪些檔案 */
  getSessionFiles(sessionId: string): SessionFile[] {
    const rows = this.db.prepare(`
      SELECT session_id, file_path, operation, count, first_seen_seq, last_seen_seq
      FROM session_files WHERE session_id = ?
      ORDER BY last_seen_seq DESC
    `).all(sessionId) as Array<{
      session_id: string
      file_path: string
      operation: string
      count: number
      first_seen_seq: number
      last_seen_seq: number
    }>
    return rows.map(r => ({
      sessionId: r.session_id,
      filePath: r.file_path,
      operation: r.operation as FileOperation,
      count: r.count,
      firstSeenSeq: r.first_seen_seq,
      lastSeenSeq: r.last_seen_seq,
    }))
  }

  // ── Phase 3.5: Dashboard Stats ──

  /** 每日使用趨勢（session 數 + token 消耗） */
  getUsageStats(projectId?: string | null, days = 30): DailyUsage[] {
    let sql = `
      SELECT date(started_at) AS date,
             COUNT(*) AS session_count,
             COALESCE(SUM(total_input_tokens), 0) + COALESCE(SUM(total_output_tokens), 0) AS total_tokens
      FROM sessions
      WHERE started_at IS NOT NULL AND archived = 0
    `
    const params: (string | number)[] = []

    if (days > 0) {
      sql += ` AND started_at >= date('now', ?)`
      params.push(`-${days} days`)
    }
    if (projectId) {
      sql += ' AND project_id = ?'
      params.push(projectId)
    }

    sql += ' GROUP BY date(started_at) ORDER BY date(started_at)'

    const rows = this.db.prepare(sql).all(...params) as Array<{
      date: string
      session_count: number
      total_tokens: number
    }>
    return rows.map(r => ({
      date: r.date,
      sessionCount: r.session_count,
      totalTokens: r.total_tokens,
    }))
  }

  /** 專案統計排名（session 數、token、最後活動） */
  getProjectStats(): ProjectStats[] {
    const rows = this.db.prepare(`
      SELECT s.project_id, p.display_name,
             COUNT(*) AS session_count,
             COALESCE(SUM(s.total_input_tokens), 0) + COALESCE(SUM(s.total_output_tokens), 0) AS total_tokens,
             MAX(s.started_at) AS last_activity
      FROM sessions s
      JOIN projects p ON p.id = s.project_id
      WHERE s.archived = 0
      GROUP BY s.project_id
      ORDER BY session_count DESC
    `).all() as Array<{
      project_id: string
      display_name: string
      session_count: number
      total_tokens: number
      last_activity: string | null
    }>

    return rows.map(r => ({
      projectId: r.project_id,
      displayName: r.display_name,
      sessionCount: r.session_count,
      totalTokens: r.total_tokens,
      lastActivity: r.last_activity,
    }))
  }

  /** 工具分佈（從 tools_used CSV 欄位聚合） */
  getToolDistribution(projectId?: string | null): DistributionItem[] {
    let sql = `SELECT tools_used FROM sessions WHERE tools_used IS NOT NULL AND archived = 0 AND id ${Database.EXCLUDE_SUBAGENTS}`
    const params: string[] = []
    if (projectId) {
      sql += ' AND project_id = ?'
      params.push(projectId)
    }

    const rows = this.db.prepare(sql).all(...params) as Array<{ tools_used: string }>
    const counts = new Map<string, number>()

    for (const row of rows) {
      // 格式：Read:5,Edit:3,Bash:2
      for (const entry of row.tools_used.split(',')) {
        const colonIdx = entry.lastIndexOf(':')
        if (colonIdx > 0) {
          const name = entry.slice(0, colonIdx)
          const count = parseInt(entry.slice(colonIdx + 1), 10)
          if (!isNaN(count)) {
            counts.set(name, (counts.get(name) ?? 0) + count)
          }
        }
      }
    }

    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  }

  /** 標籤分佈（從 tags CSV 欄位聚合） */
  getTagDistribution(projectId?: string | null): DistributionItem[] {
    let sql = `SELECT tags FROM sessions WHERE tags IS NOT NULL AND archived = 0 AND id ${Database.EXCLUDE_SUBAGENTS}`
    const params: string[] = []
    if (projectId) {
      sql += ' AND project_id = ?'
      params.push(projectId)
    }

    const rows = this.db.prepare(sql).all(...params) as Array<{ tags: string }>
    const counts = new Map<string, number>()

    for (const row of rows) {
      for (const tag of row.tags.split(',')) {
        const trimmed = tag.trim()
        if (trimmed) {
          counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1)
        }
      }
    }

    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  }

  /** 工作模式（時段分佈 + 平均 session 長度） */
  getWorkPatterns(projectId?: string | null): WorkPatterns {
    let hourSql = `
      SELECT CAST(strftime('%H', started_at) AS INTEGER) AS hour, COUNT(*) AS count
      FROM sessions
      WHERE started_at IS NOT NULL AND archived = 0 AND id ${Database.EXCLUDE_SUBAGENTS}
    `
    let durationSql = `
      SELECT AVG(COALESCE(active_duration_seconds, duration_seconds)) AS avg_duration
      FROM sessions
      WHERE (active_duration_seconds IS NOT NULL OR duration_seconds IS NOT NULL) AND archived = 0 AND id ${Database.EXCLUDE_SUBAGENTS}
    `
    const params: string[] = []

    if (projectId) {
      hourSql += ' AND project_id = ?'
      durationSql += ' AND project_id = ?'
      params.push(projectId)
    }

    hourSql += ' GROUP BY hour ORDER BY hour'

    const hourRows = this.db.prepare(hourSql).all(...params) as Array<{ hour: number; count: number }>
    const durationRow = this.db.prepare(durationSql).all(...params) as Array<{ avg_duration: number | null }>

    // 補齊 24 小時
    const hourMap = new Map(hourRows.map(r => [r.hour, r.count]))
    const hourly: WorkPatterns['hourly'] = []
    for (let h = 0; h < 24; h++) {
      hourly.push({ hour: h, count: hourMap.get(h) ?? 0 })
    }

    return {
      hourly,
      avgDurationSeconds: durationRow[0]?.avg_duration != null
        ? Math.round(durationRow[0].avg_duration)
        : null,
    }
  }

  // ── Phase 4: Dashboard 進階功能 ──

  /** 效率趨勢：每日平均 tokens/turn */
  getEfficiencyTrend(projectId?: string | null, days = 30): DailyEfficiency[] {
    let sql = `
      SELECT date(started_at) AS date,
             COUNT(*) AS session_count,
             SUM(message_count) AS total_turns,
             CASE WHEN SUM(message_count) > 0
               THEN CAST(
                 (COALESCE(SUM(total_input_tokens), 0) + COALESCE(SUM(total_output_tokens), 0))
                 AS REAL
               ) / SUM(message_count)
               ELSE 0
             END AS avg_tokens_per_turn
      FROM sessions
      WHERE started_at IS NOT NULL AND archived = 0 AND message_count > 0 AND id ${Database.EXCLUDE_SUBAGENTS}
    `
    const params: (string | number)[] = []

    if (days > 0) {
      sql += ` AND started_at >= date('now', ?)`
      params.push(`-${days} days`)
    }
    if (projectId) {
      sql += ' AND project_id = ?'
      params.push(projectId)
    }

    sql += ' GROUP BY date(started_at) ORDER BY date(started_at)'

    const rows = this.db.prepare(sql).all(...params) as Array<{
      date: string
      session_count: number
      total_turns: number
      avg_tokens_per_turn: number
    }>
    return rows.map(r => ({
      date: r.date,
      sessionCount: r.session_count,
      totalTurns: r.total_turns,
      avgTokensPerTurn: Math.round(r.avg_tokens_per_turn),
    }))
  }

  /** 浪費偵測：高 token 但無 commit/test outcome 的 session */
  getWasteSessions(projectId?: string | null, limit = 20): WasteSession[] {
    let sql = `
      SELECT s.id AS session_id, s.intent_text,
             COALESCE(s.total_input_tokens, 0) + COALESCE(s.total_output_tokens, 0) AS total_tokens,
             s.duration_seconds, s.outcome_status, s.started_at,
             p.display_name AS project_name,
             CASE WHEN s.files_touched IS NOT NULL AND s.files_touched != ''
               THEN LENGTH(s.files_touched) - LENGTH(REPLACE(s.files_touched, ',', '')) + 1
               ELSE 0
             END AS file_count
      FROM sessions s
      JOIN projects p ON p.id = s.project_id
      WHERE s.archived = 0
        AND s.id ${Database.EXCLUDE_SUBAGENTS}
        AND (s.outcome_status IS NULL OR s.outcome_status NOT IN ('committed', 'tested'))
        AND (COALESCE(s.total_input_tokens, 0) + COALESCE(s.total_output_tokens, 0)) > 0
    `
    const params: (string | number)[] = []

    if (projectId) {
      sql += ' AND s.project_id = ?'
      params.push(projectId)
    }

    sql += ' ORDER BY total_tokens DESC LIMIT ?'
    params.push(limit)

    const rows = this.db.prepare(sql).all(...params) as Array<{
      session_id: string
      intent_text: string | null
      total_tokens: number
      duration_seconds: number | null
      outcome_status: string | null
      started_at: string | null
      project_name: string
      file_count: number
    }>
    return rows.map(r => ({
      sessionId: r.session_id,
      intentText: r.intent_text,
      totalTokens: r.total_tokens,
      durationSeconds: r.duration_seconds,
      outcomeStatus: r.outcome_status as OutcomeStatus,
      fileCount: r.file_count,
      startedAt: r.started_at,
      projectName: r.project_name,
    }))
  }

  /** 專案健康：outcome 分佈 + 活動趨勢 + 效率 */
  getProjectHealth(): ProjectHealth[] {
    const rows = this.db.prepare(`
      SELECT s.project_id, p.display_name,
             SUM(CASE WHEN s.outcome_status = 'committed' THEN 1 ELSE 0 END) AS committed,
             SUM(CASE WHEN s.outcome_status = 'tested' THEN 1 ELSE 0 END) AS tested,
             SUM(CASE WHEN s.outcome_status = 'in-progress' THEN 1 ELSE 0 END) AS in_progress,
             SUM(CASE WHEN s.outcome_status = 'quick-qa' THEN 1 ELSE 0 END) AS quick_qa,
             SUM(CASE WHEN s.outcome_status IS NULL THEN 1 ELSE 0 END) AS unknown,
             SUM(CASE WHEN s.started_at >= date('now', '-7 days') THEN 1 ELSE 0 END) AS recent_count,
             SUM(CASE WHEN s.started_at >= date('now', '-14 days') AND s.started_at < date('now', '-7 days') THEN 1 ELSE 0 END) AS previous_count,
             CASE WHEN SUM(s.message_count) > 0
               THEN CAST(
                 (COALESCE(SUM(s.total_input_tokens), 0) + COALESCE(SUM(s.total_output_tokens), 0))
                 AS REAL
               ) / SUM(s.message_count)
               ELSE NULL
             END AS avg_tokens_per_turn
      FROM sessions s
      JOIN projects p ON p.id = s.project_id
      WHERE s.archived = 0
      GROUP BY s.project_id
      ORDER BY recent_count DESC, committed + tested DESC
    `).all() as Array<{
      project_id: string
      display_name: string
      committed: number
      tested: number
      in_progress: number
      quick_qa: number
      unknown: number
      recent_count: number
      previous_count: number
      avg_tokens_per_turn: number | null
    }>

    return rows.map(r => ({
      projectId: r.project_id,
      displayName: r.display_name,
      outcomeDistribution: {
        committed: r.committed,
        tested: r.tested,
        inProgress: r.in_progress,
        quickQa: r.quick_qa,
        unknown: r.unknown,
      },
      recentCount: r.recent_count,
      previousCount: r.previous_count,
      avgTokensPerTurn: r.avg_tokens_per_turn != null ? Math.round(r.avg_tokens_per_turn) : null,
    }))
  }

  /** 相關 Session 推薦（基於檔案 Jaccard 相似度） */
  getRelatedSessions(sessionId: string, limit = 5): RelatedSession[] {
    // 1. 取得目標 session 的檔案集合
    const targetFiles = this.db.prepare(
      'SELECT DISTINCT file_path FROM session_files WHERE session_id = ?',
    ).all(sessionId) as Array<{ file_path: string }>

    if (targetFiles.length === 0) return []

    const targetSet = new Set(targetFiles.map(r => r.file_path))

    // 2. 找出共享至少一個檔案的候選 session
    const placeholders = targetFiles.map(() => '?').join(',')
    const candidates = this.db.prepare(`
      SELECT DISTINCT sf.session_id, s.title, s.intent_text, s.outcome_status, s.started_at,
             p.display_name AS project_name
      FROM session_files sf
      JOIN sessions s ON s.id = sf.session_id
      JOIN projects p ON p.id = s.project_id
      WHERE sf.file_path IN (${placeholders})
        AND sf.session_id != ?
        AND s.archived = 0
        AND s.id ${Database.EXCLUDE_SUBAGENTS}
    `).all(...targetFiles.map(r => r.file_path), sessionId) as Array<{
      session_id: string
      title: string | null
      intent_text: string | null
      outcome_status: string | null
      started_at: string | null
      project_name: string
    }>

    if (candidates.length === 0) return []

    // 3. 批量取得所有候選 session 的檔案集合（一次查詢，避免 N+1）
    const candidateIds = [...new Set(candidates.map(c => c.session_id))]
    const candidateMap = new Map(candidates.map(c => [c.session_id, c]))

    const cidPlaceholders = candidateIds.map(() => '?').join(',')
    const allCandidateFiles = this.db.prepare(
      `SELECT session_id, file_path FROM session_files WHERE session_id IN (${cidPlaceholders})`,
    ).all(...candidateIds) as Array<{ session_id: string; file_path: string }>

    // 按 session 分組
    const candidateFileSets = new Map<string, Set<string>>()
    for (const row of allCandidateFiles) {
      let s = candidateFileSets.get(row.session_id)
      if (!s) { s = new Set(); candidateFileSets.set(row.session_id, s) }
      s.add(row.file_path)
    }

    const results: RelatedSession[] = []

    for (const cid of candidateIds) {
      const cSet = candidateFileSets.get(cid) ?? new Set()
      const intersection = [...targetSet].filter(f => cSet.has(f))
      const union = new Set([...targetSet, ...cSet])
      const jaccard = intersection.length / union.size

      if (jaccard > 0) {
        const meta = candidateMap.get(cid)!
        results.push({
          sessionId: cid,
          sessionTitle: meta.title,
          projectName: meta.project_name,
          intentText: meta.intent_text,
          outcomeStatus: (meta.outcome_status as OutcomeStatus) ?? null,
          jaccard: Math.round(jaccard * 1000) / 1000,
          sharedFiles: intersection,
          startedAt: meta.started_at,
        })
      }
    }

    return results
      .sort((a, b) => b.jaccard - a.jaccard)
      .slice(0, limit)
  }

  // ── 儲存管理（v1.9.0） ──

  /** 切 500 一批執行 SQL，callback 提供 placeholders 與 chunk 內容 */
  private chunkedIn(ids: readonly string[], fn: (placeholders: string, chunk: readonly string[]) => void): void {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500)
      fn(chunk.map(() => '?').join(','), chunk)
    }
  }

  /**
   * 將規則 normalize + 嚴格驗證：
   * - 空字串 / 僅空白 → null（防止 `DATE(x) >= ''` 對非 null date 恆真）
   * - 日期欄位必須符合 YYYY-MM-DD（防止無效日期讓 `DATE('bad')` 回 NULL，
   *   整個 date 條件被靜默跳過，再配上 null projectId 可能誤刪全庫）
   */
  private normalizeRule(rule: ExclusionRuleInput): ExclusionRuleInput {
    const norm = (v: string | null): string | null => {
      if (v == null) return null
      const t = v.trim()
      return t === '' ? null : t
    }
    const r = { projectId: norm(rule.projectId), dateFrom: norm(rule.dateFrom), dateTo: norm(rule.dateTo) }
    if (!r.projectId && !r.dateFrom && !r.dateTo) {
      throw new Error('Exclusion rule requires at least one non-empty criterion')
    }
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
    if (r.dateFrom != null && !DATE_RE.test(r.dateFrom)) {
      throw new Error(`dateFrom must be YYYY-MM-DD, got: ${r.dateFrom}`)
    }
    if (r.dateTo != null && !DATE_RE.test(r.dateTo)) {
      throw new Error(`dateTo must be YYYY-MM-DD, got: ${r.dateTo}`)
    }
    return r
  }

  /** 組出規則匹配的 WHERE clause 與 params（動態，不填 NULL 欄位）*/
  private buildExclusionWhere(rule: ExclusionRuleInput): { clause: string; params: string[] } {
    const clauses: string[] = [`id ${Database.EXCLUDE_SUBAGENTS}`]
    const params: string[] = []
    if (rule.projectId != null) {
      clauses.push('project_id = ?')
      params.push(rule.projectId)
    }
    if (rule.dateFrom != null) {
      clauses.push('started_at IS NOT NULL AND DATE(started_at) >= ?')
      params.push(rule.dateFrom)
    }
    if (rule.dateTo != null) {
      clauses.push('started_at IS NOT NULL AND DATE(started_at) <= ?')
      params.push(rule.dateTo)
    }
    return { clause: clauses.join(' AND '), params }
  }

  /** DB 磁碟占用：WAL 模式下需同時計 -wal 與 -shm sidecar 檔 */
  getDbBytes(): number {
    if (this.db.name === ':memory:') return 0
    let total = 0
    for (const suffix of ['', '-wal', '-shm']) {
      try { total += statSync(this.db.name + suffix).size } catch { /* sidecar may not exist */ }
    }
    return total
  }

  /**
   * DB 維護資訊：總大小、可回收空間（free pages × page_size）。
   * freelist_count 反映 DELETE 後尚未 VACUUM 的 free pages，可直接算出 compact 能釋放多少。
   */
  getDatabaseMaintenanceStats(): DatabaseMaintenanceStats {
    const freelistPages = this.db.pragma('freelist_count', { simple: true }) as number
    const pageSize = this.db.pragma('page_size', { simple: true }) as number
    return {
      dbBytes: this.getDbBytes(),
      freelistPages,
      pageSize,
      reclaimableBytes: freelistPages * pageSize,
    }
  }

  /**
   * 壓縮 DB：執行 VACUUM。回傳壓縮前後 bytes。
   * VACUUM 會鎖整個 DB，期間其他 query 會等待。1GB 資料上可能 10-30s。
   * VACUUM 不能在 transaction 內執行（SQLite 限制）。
   */
  compactDatabase(): CompactResult {
    const bytesBefore = this.getDbBytes()
    this.db.exec('VACUUM')
    const bytesAfter = this.getDbBytes()
    return { bytesBefore, bytesAfter, releasedBytes: Math.max(0, bytesBefore - bytesAfter) }
  }

  getStorageStats(): StorageStats {
    const counts = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM sessions WHERE id ${Database.EXCLUDE_SUBAGENTS}) AS session_count,
        (SELECT COUNT(*) FROM messages) AS message_count,
        (SELECT COUNT(*) FROM projects) AS project_count
    `).get() as { session_count: number; message_count: number; project_count: number }
    const range = this.db.prepare(`
      SELECT MIN(started_at) AS earliest, MAX(ended_at) AS latest
      FROM sessions WHERE id ${Database.EXCLUDE_SUBAGENTS}
    `).get() as { earliest: string | null; latest: string | null }
    return {
      dbBytes: this.getDbBytes(),
      sessionCount: counts.session_count,
      messageCount: counts.message_count,
      projectCount: counts.project_count,
      earliestTimestamp: range.earliest,
      latestTimestamp: range.latest,
    }
  }

  getProjectBreakdown(): ProjectBreakdown[] {
    const dbBytes = this.getDbBytes()
    const rows = this.db.prepare(`
      SELECT p.id, p.display_name,
        SUM(CASE WHEN s.id IS NOT NULL AND sub.id IS NULL THEN 1 ELSE 0 END) AS session_count,
        COALESCE(SUM(s.message_count), 0) AS message_count,
        MIN(CASE WHEN sub.id IS NULL THEN s.started_at END) AS earliest,
        MAX(CASE WHEN sub.id IS NULL THEN s.ended_at END) AS latest
      FROM projects p
      LEFT JOIN sessions s ON s.project_id = p.id
      LEFT JOIN subagent_sessions sub ON sub.id = s.id
      GROUP BY p.id
      ORDER BY message_count DESC
    `).all() as Array<{
      id: string
      display_name: string
      session_count: number
      message_count: number
      earliest: string | null
      latest: string | null
    }>
    const totalMsg = rows.reduce((s, r) => s + r.message_count, 0)
    return rows.map(r => ({
      projectId: r.id,
      displayName: r.display_name,
      sessionCount: r.session_count,
      messageCount: r.message_count,
      estimatedBytes: totalMsg > 0 ? Math.round((r.message_count / totalMsg) * dbBytes) : 0,
      earliestTimestamp: r.earliest,
      latestTimestamp: r.latest,
    }))
  }

  getInactiveSessions(thresholdDays: number): InactiveSession[] {
    if (!Number.isInteger(thresholdDays) || thresholdDays < 0) {
      throw new Error(`thresholdDays must be a non-negative integer, got: ${thresholdDays}`)
    }
    const rows = this.db.prepare(`
      SELECT s.id, s.project_id, p.display_name, s.title, s.ended_at, s.message_count
      FROM sessions s JOIN projects p ON p.id = s.project_id
      WHERE s.id ${Database.EXCLUDE_SUBAGENTS}
        AND s.ended_at IS NOT NULL
        AND DATE(s.ended_at) < DATE('now', ? || ' days')
      ORDER BY s.ended_at ASC
    `).all(`-${thresholdDays}`) as Array<{
      id: string
      project_id: string
      display_name: string
      title: string | null
      ended_at: string | null
      message_count: number
    }>
    return rows.map(r => ({
      sessionId: r.id,
      projectId: r.project_id,
      projectName: r.display_name,
      title: r.title,
      lastActivity: r.ended_at,
      messageCount: r.message_count,
    }))
  }

  getExclusionRules(): ExclusionRule[] {
    const rows = this.db.prepare(`
      SELECT id, project_id, date_from, date_to, created_at
      FROM exclusion_rules ORDER BY created_at DESC
    `).all() as Array<{
      id: number
      project_id: string | null
      date_from: string | null
      date_to: string | null
      created_at: string
    }>
    return rows.map(r => ({
      id: r.id,
      projectId: r.project_id,
      dateFrom: r.date_from,
      dateTo: r.date_to,
      createdAt: r.created_at,
    }))
  }

  /** 查規則匹配的主 session ID 與 project id（apply 用；preview 走純 aggregate 路徑）*/
  private findMatchingSessionIds(rule: ExclusionRuleInput): Array<{ id: string; project_id: string }> {
    const w = this.buildExclusionWhere(rule)
    return this.db.prepare(`SELECT id, project_id FROM sessions WHERE ${w.clause}`)
      .all(...w.params) as Array<{ id: string; project_id: string }>
  }

  previewExclusion(rawRule: ExclusionRuleInput): ExclusionPreview {
    const rule = this.normalizeRule(rawRule)
    const w = this.buildExclusionWhere(rule)
    const main = this.db.prepare(`
      SELECT COUNT(*) AS session_count, COALESCE(SUM(message_count), 0) AS message_count
      FROM sessions WHERE ${w.clause}
    `).get(...w.params) as { session_count: number; message_count: number }
    if (main.session_count === 0) return { sessionCount: 0, messageCount: 0, estimatedBytes: 0 }

    const subagentMsg = this.db.prepare(`
      SELECT COALESCE(SUM(s.message_count), 0) AS c
      FROM sessions s
      JOIN subagent_sessions sub ON sub.id = s.id
      WHERE sub.parent_session_id IN (SELECT id FROM sessions WHERE ${w.clause})
    `).get(...w.params) as { c: number }

    const totalMsg = (this.db.prepare('SELECT COALESCE(SUM(message_count), 0) AS c FROM sessions').get() as { c: number }).c
    const combinedMsg = main.message_count + subagentMsg.c
    const dbBytes = this.getDbBytes()
    return {
      sessionCount: main.session_count,
      messageCount: combinedMsg,
      estimatedBytes: totalMsg > 0 ? Math.round((combinedMsg / totalMsg) * dbBytes) : 0,
    }
  }

  addExclusionRule(rawRule: ExclusionRuleInput): ExclusionRule {
    const rule = this.normalizeRule(rawRule)
    const row = this.db.prepare(`
      INSERT INTO exclusion_rules (project_id, date_from, date_to) VALUES (?, ?, ?)
      RETURNING id, project_id, date_from, date_to, created_at
    `).get(rule.projectId, rule.dateFrom, rule.dateTo) as {
      id: number
      project_id: string | null
      date_from: string | null
      date_to: string | null
      created_at: string
    }
    return {
      id: row.id,
      projectId: row.project_id,
      dateFrom: row.date_from,
      dateTo: row.date_to,
      createdAt: row.created_at,
    }
  }

  removeExclusionRule(id: number): void {
    this.db.prepare('DELETE FROM exclusion_rules WHERE id = ?').run(id)
  }

  /**
   * 套用規則：找出匹配 session → 刪除（含 subagent、sessions_fts manual delete、CASCADE 連帶）→ 寫規則 → VACUUM
   * 注意：VACUUM 不能在 transaction 內執行，已在 tx 外。呼叫端勿將本方法包入另一層 transaction。
   * VACUUM 為「已 commit delete 後」的 best-effort 壓縮；失敗不 throw，避免讓 caller 以為刪除失敗（資料已永久刪除）。
   */
  applyExclusion(rawRule: ExclusionRuleInput): { rule: ExclusionRule; releasedBytes: number; vacuumed: boolean } {
    const rule = this.normalizeRule(rawRule)
    const bytesBefore = this.getDbBytes()

    let deletedCount = 0
    const result = this.db.transaction(() => {
      const sessions = this.findMatchingSessionIds(rule)
      const sessionIds = sessions.map(s => s.id)
      const subagentIds: string[] = []
      this.chunkedIn(sessionIds, (ph, chunk) => {
        const rows = this.db.prepare(`SELECT id FROM subagent_sessions WHERE parent_session_id IN (${ph})`)
          .all(...chunk) as Array<{ id: string }>
        for (const r of rows) subagentIds.push(r.id)
      })
      const allIds = [...sessionIds, ...subagentIds]
      const affectedProjects = new Set(sessions.map(s => s.project_id))

      this.deleteSessionsBatch(allIds, sessionIds)
      const createdRule = this.addExclusionRule(rule)
      for (const pid of affectedProjects) this.updateProjectStats(pid)
      deletedCount = allIds.length
      return createdRule
    })()

    let vacuumed = false
    if (deletedCount > 0) {
      try { this.db.exec('VACUUM'); vacuumed = true } catch { /* delete already committed */ }
    }
    return { rule: result, releasedBytes: Math.max(0, bytesBefore - this.getDbBytes()), vacuumed }
  }

  /** 將多個 session 從 sessions_fts 移除（external content FTS5 需手動維護）*/
  private deleteSessionsFromFts(sessionIds: readonly string[]): void {
    if (sessionIds.length === 0) return
    const ftsDelete = this.db.prepare(
      "INSERT INTO sessions_fts(sessions_fts, rowid, title, tags, files_touched, summary_text, intent_text) VALUES ('delete', ?, ?, ?, ?, ?, ?)",
    )
    this.chunkedIn(sessionIds, (ph, chunk) => {
      const rows = this.db.prepare(
        `SELECT rowid, title, tags, files_touched, summary_text, intent_text FROM sessions WHERE id IN (${ph})`,
      ).all(...chunk) as Array<{ rowid: number; title: string | null; tags: string | null; files_touched: string | null; summary_text: string | null; intent_text: string | null }>
      for (const old of rows) {
        ftsDelete.run(old.rowid, old.title ?? '', old.tags ?? '', old.files_touched ?? '', old.summary_text ?? '', old.intent_text ?? '')
      }
    })
  }

  /** 批次刪除 sessions（含 FTS sync、messages、session_files、subagent_sessions）*/
  private deleteSessionsBatch(allSessionIds: string[], parentSessionIds: string[]): void {
    if (allSessionIds.length === 0) return
    this.deleteSessionsFromFts(allSessionIds)
    this.chunkedIn(allSessionIds, (ph, chunk) => {
      this.db.prepare(`DELETE FROM messages WHERE session_id IN (${ph})`).run(...chunk)
      this.db.prepare(`DELETE FROM session_files WHERE session_id IN (${ph})`).run(...chunk)
      this.db.prepare(`DELETE FROM subagent_sessions WHERE id IN (${ph})`).run(...chunk)
    })
    this.chunkedIn(parentSessionIds, (ph, chunk) => {
      this.db.prepare(`DELETE FROM subagent_sessions WHERE parent_session_id IN (${ph})`).run(...chunk)
    })
    this.chunkedIn(allSessionIds, (ph, chunk) => {
      this.db.prepare(`DELETE FROM sessions WHERE id IN (${ph})`).run(...chunk)
    })
  }
}
