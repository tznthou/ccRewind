import type BetterSqlite3 from 'better-sqlite3'

/** Migration 定義 */
export interface Migration {
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

/**
 * 由 messages 表既存的 bridge-session 訊息回填 sessions.has_remote_control。
 *
 * v23 引入該欄位時採「清空 file_mtime 觸發 re-index」的做法，但已封存 session 的原始
 * JSONL 多半已被 Claude Code 的 30 天清理刪除，re-index 讀不到檔案，欄位只能停在
 * DEFAULT 0。DB 內的 bridge-session 訊息本身沒有遺失，故直接由它回填。
 *
 * migration 與測試共用同一份 SQL，避免兩邊各抄一份後語意悄悄分岔。
 */
export const BACKFILL_HAS_REMOTE_CONTROL_SQL = `
  UPDATE sessions SET has_remote_control = 1
  WHERE has_remote_control = 0
    AND id IN (SELECT DISTINCT session_id FROM messages WHERE type = 'bridge-session')
`

/** 所有 migrations，依 version 遞增排列 */
export const migrations: Migration[] = [
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
    description: 'clear legacy message_archive rows for known types (keep unknown-type raw_json as debug fallback)',
    up: (db) => {
      // v17 白名單快照：對齊撰寫當下 parser.ts 的 KNOWN_MESSAGE_TYPES。
      // 不動態 import parser 常數——migration 是歷史紀錄，未來 parser 新增 type 時，
      // 那些新 type 會在新 DB 裡直接被寫為「unknown」並保留 raw_json，不需要再清。
      const KNOWN_AT_V17 = [
        'user', 'assistant', 'system',
        'queue-operation', 'last-prompt',
        'progress', 'attachment', 'file-history-snapshot', 'permission-mode',
        'custom-title', 'ai-title', 'agent-name', 'pr-link',
      ]
      const placeholders = KNOWN_AT_V17.map(() => '?').join(',')
      db.prepare(
        `DELETE FROM message_archive
         WHERE message_id IN (SELECT id FROM messages WHERE type IN (${placeholders}))`,
      ).run(...KNOWN_AT_V17)
    },
  },
  {
    version: 18,
    description: 'add session_tasks table for ~/.claude/tasks/ TODO history scanning',
    up: (db) => {
      // 不掛 FK：task 生命週期由 indexer 統一管理。
      // 既有 subagent_sessions 用 CASCADE 是因 subagent 跟 session 強綁定；
      // tasks/ 是 sibling source（獨立目錄），需要解耦避免 indexSession 的 delete/reinsert 誤掃 task。
      db.exec(`
        CREATE TABLE IF NOT EXISTS session_tasks (
          session_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          subject TEXT NOT NULL,
          description TEXT,
          active_form TEXT,
          status TEXT NOT NULL,
          blocks_json TEXT NOT NULL DEFAULT '[]',
          blocked_by_json TEXT NOT NULL DEFAULT '[]',
          file_path TEXT NOT NULL,
          file_size INTEGER,
          file_mtime TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (session_id, task_id)
        );
        CREATE INDEX IF NOT EXISTS idx_session_tasks_session ON session_tasks(session_id);
      `)
    },
  },
  {
    version: 19,
    description: 'add tool_error_count column to messages for degradation detection POC',
    up: (db) => {
      // is_error 在 JSONL 每個 tool_result block 全量輸出 boolean（true 8.6% / false 91.4%）。
      // parser 用 b.is_error === true 嚴格判斷 + counter 寫入此 column。
      // DEFAULT 0：升級時舊資料未 reindex 值為 0，等使用者觸發 Resync 才填真值。
      // 不建立 index：分析查詢會跟 session_id GROUP BY，現有 idx_messages_session 已覆蓋。
      // Rollback path（若決定撤回）：better-sqlite3 ≥ 11.8 用 SQLite ≥ 3.45 支援
      //   ALTER TABLE messages DROP COLUMN tool_error_count;
      db.exec(`
        ALTER TABLE messages ADD COLUMN tool_error_count INTEGER NOT NULL DEFAULT 0;
      `)
    },
  },
  {
    version: 20,
    description: 'add session_stars table for user-managed star/bookmark',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS session_stars (
          session_id TEXT PRIMARY KEY,
          starred_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `)
    },
  },
  {
    version: 21,
    description: 'add image/attribution/system_subtype/api_error columns to messages; force reindex',
    up: (db) => {
      db.exec(`
        ALTER TABLE messages ADD COLUMN has_image INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE messages ADD COLUMN attribution_skill TEXT;
        ALTER TABLE messages ADD COLUMN attribution_plugin TEXT;
        ALTER TABLE messages ADD COLUMN attribution_mcp_server TEXT;
        ALTER TABLE messages ADD COLUMN attribution_mcp_tool TEXT;
        ALTER TABLE messages ADD COLUMN attribution_agent TEXT;
        ALTER TABLE messages ADD COLUMN system_subtype TEXT;
        ALTER TABLE messages ADD COLUMN api_error_status INTEGER;
      `)
      db.exec(`
        UPDATE sessions SET file_mtime = NULL;
        UPDATE subagent_sessions SET file_mtime = NULL;
      `)
    },
  },
  {
    version: 22,
    description: 'add parent_uuid/is_compact_summary/is_sidechain/is_abandoned_branch to messages, version to message_archive; force reindex',
    up: (db) => {
      db.exec(`
        ALTER TABLE messages ADD COLUMN parent_uuid TEXT;
        ALTER TABLE messages ADD COLUMN is_compact_summary INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE messages ADD COLUMN is_sidechain INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE messages ADD COLUMN is_abandoned_branch INTEGER NOT NULL DEFAULT 0;
        CREATE INDEX idx_messages_parent_uuid ON messages(parent_uuid);
        ALTER TABLE message_archive ADD COLUMN version TEXT;
      `)
      db.exec(`
        UPDATE sessions SET file_mtime = NULL;
        UPDATE subagent_sessions SET file_mtime = NULL;
      `)
    },
  },
  {
    version: 23,
    description: 'add frame_url to messages, has_remote_control to sessions; whitelist mode/agent-setting/bridge-session/frame-link; force reindex',
    up: (db) => {
      db.exec(`
        ALTER TABLE messages ADD COLUMN frame_url TEXT;
        ALTER TABLE sessions ADD COLUMN has_remote_control INTEGER NOT NULL DEFAULT 0;
      `)
      db.exec(`
        UPDATE sessions SET file_mtime = NULL;
        UPDATE subagent_sessions SET file_mtime = NULL;
      `)
    },
  },
  {
    version: 24,
    description: 'backfill has_remote_control from existing bridge-session messages (archived sessions cannot be re-indexed)',
    up: (db) => {
      db.prepare(BACKFILL_HAS_REMOTE_CONTROL_SQL).run()
    },
  },
  {
    version: 25,
    description: 'add bridge_session_id to sessions; force reindex to capture it while source files still exist',
    up: (db) => {
      db.exec(`
        ALTER TABLE sessions ADD COLUMN bridge_session_id TEXT;
      `)
      // 這個欄位**無法回填**：DB 既有的 bridge-session 訊息 content 全為 NULL，
      // 當初沒把 bridgeSessionId 抽出來存，資料只存在於原始 JSONL。
      // 而 Claude Code 預設 30 天清理 JSONL——實測全庫僅 4 個 session 的原檔還在，
      // 其餘標了 has_remote_control 的 session 將永遠沒有連結。force reindex 是唯一
      // 能救回那 4 個、並讓日後每個新 session 都留住這個值的手段。
      db.exec(`
        UPDATE sessions SET file_mtime = NULL;
        UPDATE subagent_sessions SET file_mtime = NULL;
      `)
    },
  },
]
