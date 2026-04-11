# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.8.0] - 2026-04-11

### Added

- **Subagent UI** — Sessions that spawned subagents now display clickable chips (agent type + message count) above the conversation. Clicking a chip navigates into the subagent's conversation, where a breadcrumb bar (`← Back to parent` + agent type badge) provides reliable navigation back. Breadcrumb persists across loading/error/empty states to prevent navigation dead-ends.

## [1.7.4] - 2026-04-11

### Fixed

- **Token heat gutter invisible in Timeline/Terminal themes** — Heat gutter used hardcoded `rgba()` values with low opacity (0.3), failing WCAG 1.4.11 non-text contrast (3:1) on dark and light backgrounds. Fix: replaced with per-theme CSS variables (`--color-heat-positive` / `--color-heat-negative`) driven by `color-mix(in srgb)`, minimum intensity raised from 30% to 65%. Changed from `inset box-shadow 3px` to `border-left 4px` for better visual weight.
- **Timeline double-border conflict** — Timeline theme's accent `border-left` and heat gutter `box-shadow` stacked into a confusing 6px dual-color band. Fix: accent border now uses `:not([data-heat])` selector, showing only when no heat indicator is present.

### Added

- **Terminal heat glow** — Terminal theme adds `box-shadow` glow effect on heat-indicated messages for depth on transparent bubbles, matching the retro-future aesthetic.

## [1.7.3] - 2026-04-11

### Fixed

- **System XML noise in titles and messages** — Claude Code injects system XML tags (`<local-command-caveat>`, `<task-notification>`, `<ide_opened_file>`, `<system-reminder>`) into user message content. These were stored verbatim in `contentText`, polluting session titles and message display. Fix: `stripSystemXml()` strips known system tags (whitelist-only) during JSONL parsing, while preserving command metadata (`<command-name>`, `<command-args>`) as unwrapped plain text. Original data fully preserved in `raw_json` and `content_json`.
- **UNWRAP_RE cross-tag mismatch** — Regex for unwrapping command tags now uses backreference (`\1`) to enforce open/close tag name symmetry, preventing incorrect matches on malformed XML.

### Changed

- **DB schema**: migration v15 forces full re-index of sessions and subagent_sessions to apply system XML stripping to all existing `contentText`

## [1.7.2] - 2026-04-10

### Fixed

- **Token statistics ~2.3x inflation** — Claude Code JSONL splits a single API response into multiple `type:"assistant"` entries (one per content block), each carrying identical `usage` data. ccRewind was summing all entries independently, inflating input token counts by ~2.3x. Fix: `deduplicateTokensByRequestId()` in the indexer nulls token fields on all but the last entry per `requestId`, so each API call is counted exactly once. All downstream statistics (Dashboard usage trend, efficiency trend, waste detection, project health, Token Budget panel) are automatically corrected.
- **Subagent token counts not re-indexed** — Migration v14 now also invalidates `subagent_sessions.file_mtime`, ensuring subagent transcripts are re-indexed with the corrected token dedup logic.
- **`requestId` length guard** — Added `length <= 128` boundary validation to `requestId` extraction, matching the existing `uuid` guard pattern.

### Changed

- **DB schema**: migration v14 forces full re-index of both sessions and subagent_sessions for token dedup correction
- `ParsedLine` type extended with `requestId: string | null` field for API request identification

## [1.7.1] - 2026-04-10

### Fixed

- **Critical: UUID self-dedup bug** — `getExistingUuids` was matching a session's own previously-indexed messages during re-index, causing all user/assistant messages to be silently dropped. Only messages without UUID (file-history-snapshot, queue-operation, permission-mode) survived. Root cause: the dedup query ran before `indexSession` deleted old messages, so the session's own UUIDs matched itself. Fix: exclude current session from the dedup query (`session_id != ?`). Migration v13 forces a full re-index to rebuild all affected sessions.

## [1.7.0] - 2026-04-09

### Added

- **Active Time Calculation**: session duration now shows active time (excluding idle periods >5 minutes) alongside wall-clock time, providing a more meaningful measure of actual work time
  - Sidebar session list prioritizes active time display, with wall-clock time shown in parentheses when different
  - Dashboard work patterns and heatmap use active time for average calculations (`COALESCE(active_duration_seconds, duration_seconds)`)
- **Subagent File Scanning**: automatically discovers and indexes subagent transcripts from `<session>/subagents/*.jsonl` directories
  - Reads `*.meta.json` for agent type metadata when available
  - Subagent sessions stored in dedicated `subagent_sessions` table with parent-child linkage
  - Subagent messages queryable through existing messages API
  - Incremental indexing: unchanged subagent files are skipped on re-index
  - Stale cleanup: subagent entries are removed from DB when files are deleted from disk
  - New IPC channel `session:subagents` for frontend access

### Changed

- **DB schema**: migration v11 adds `active_duration_seconds` column to sessions (INTEGER); migration v12 creates `subagent_sessions` table with FK to sessions
- All user-facing queries (search, file history, analytics, waste detection, related sessions) exclude subagent sessions via centralized `EXCLUDE_SUBAGENTS` predicate
- Subagent IDs namespaced by parent session (`parentSessionId/bareFilename`) to prevent cross-session collision
- Subagent metadata + content writes wrapped in single transaction for atomicity
- `stats:usage` handler now clamps `days` parameter to [1, 365] range for input safety

## [1.6.1] - 2026-04-09

### Fixed

- **Resumed session dedup**: sessions resumed via Claude Code's `/resume` no longer produce duplicate messages — entries replayed into the new JSONL file are detected by UUID and skipped
- **Dedup ordering**: sessions are indexed by file modification time (ascending) to ensure the original session always claims UUID ownership before any resumed copy
- **Empty replay sessions**: pure-replay JSONL files (all messages already indexed from the original) are skipped entirely instead of creating ghost session entries
- **UUID format guard**: malformed UUIDs (empty, whitespace-only, or >128 chars) from corrupted JSONL are normalized to null before dedup

### Changed

- **DB schema**: migration v10 adds `uuid` column to `messages` table with index, enabling cross-session dedup; existing sessions are force re-indexed on upgrade
- Dedup logic runs in the indexer layer (before summary/session_files generation) so all session-level derivatives reflect only the actual stored messages
- `docs/SPEC.md` expanded with JSONL format notes: UUID semantics, assistant requestId chunking, user entry subtypes, and subagent directory structure

## [1.6.0] - 2026-04-09

### Added

- **Date Range Filter**: search results can be filtered by time range (all / 7 days / 30 days / 90 days) via quick-select buttons in the search bar
- **Sort Toggle**: switch between relevance-based (FTS5 rank) and chronological (newest first) ordering for search results
- **Intent Text Search**: session-level FTS5 index now includes `intent_text` column (Migration v9), enabling search by session intent/purpose
- **Session Date in Search Results**: message search result group headers and session search results now display the session start date
- **Outcome Status Badge**: session search results show outcome status (committed / tested / in-progress / quick-qa) as a badge

### Changed

- FTS5 snippet length increased from 64 to 128 characters for richer search result previews
- Search API (`search` / `searchSessions`) extended with `SearchOptions` parameter for date filtering and sort control
- Date range and sort filter changes automatically re-execute the current search query (no need to press Enter again)
- `renderSnippet` extracted to shared utility (`utils/renderSnippet.tsx`), eliminating duplication between `SearchResults` and `SessionSearchResults`
- IPC boundary adds ISO date format validation (`/^\d{4}-\d{2}-\d{2}$/`) for `dateFrom`/`dateTo` parameters
- `OutcomeStatus` values validated at runtime via `Set.has()` instead of bare type assertion
- Pagination sort order includes stable secondary key (`m.id DESC` / `s.rowid DESC`) to prevent duplicate/missing results
- Date comparison uses SQLite `date()` function for consistent timezone handling

## [1.5.0] - 2026-04-02

### Added

- **Efficiency Trend Chart** (Phase 4): daily tokens-per-turn trend line on the dashboard, togglable with Usage Trend via Usage/Efficiency switch
  - `getEfficiencyTrend()` API: aggregates `(total_input_tokens + total_output_tokens) / message_count` per day with project filter and date range
- **Waste Detection** (Phase 4): ranked list of sessions with high token consumption but no productive outcome (no commit/test)
  - `getWasteSessions()` API: filters sessions where `outcome_status NOT IN ('committed', 'tested')`, sorted by total tokens descending
  - Click-to-navigate: clicking a waste entry dispatches `SELECT_SESSION` + `SET_VIEW_MODE` to jump directly to session replay
- **Project Health Dashboard** (Phase 4): replaces Project Activity ranking with richer per-project health cards
  - Outcome distribution stacked bar (committed/tested/in-progress/quick-qa/unknown) with color coding
  - 7-day trend arrow comparing recent vs previous period session count
  - Average tokens-per-turn efficiency metric per project
  - `getProjectHealth()` API: single SQL query with `SUM(CASE WHEN ...)` for all metrics
- IPC handles for new APIs: `stats:efficiency`, `stats:waste`, `stats:project-health`
- IPC input validation uses `Number.isFinite()` for numeric parameters (rejects NaN/Infinity)

### Changed

- Dashboard data fetching uses `Promise.allSettled` instead of `Promise.all` — individual API failures no longer cascade to other dashboard cards
- `loadData` refactored from `useCallback` + separate `useEffect` to single `useEffect` with proper cancellation cleanup (fixes race condition on rapid filter changes)
- `WasteDetection` component imports shared `formatDuration()` from `utils/formatTime.ts` instead of local duplicate
- Initial project load split into independent calls (`getProjectStats` + `getProjectHealth`) to prevent mutual blocking

## [1.4.0] - 2026-04-01

### Added

- **Statistics Dashboard** (Phase 3.5-A): cross-session analytics accessible via title bar toggle button
  - **Usage Trend**: dual-axis area chart showing daily session count and token consumption, with 7D/30D/90D/All range selector
  - **Project Activity**: ranked list of projects by session count and token usage, with proportional bar indicator
  - **Tool Distribution**: donut pie chart aggregating tool usage (Read, Edit, Bash, etc.) across all sessions
  - **Tag Distribution**: donut pie chart showing tag frequency (bug-fix, refactor, testing, etc.)
  - **Work Pattern Heatmap**: 24-hour activity heatmap with average session duration display
  - Project filter dropdown: all charts respond to project selection (except Project Activity which hides when filtered)
- **Cross-Session Archaeology UI** (Phase 3.5-B): file-centric navigation and session discovery
  - **File History Drawer**: slide-in timeline showing every session that touched a file, with operation type badges (edit/write/read/discovery) and click-to-navigate
  - **Related Sessions Panel**: Jaccard similarity-based recommendations at the bottom of ChatView, showing shared files and match percentage
  - **File Chips**: expandable file list in ChatView toolbar — click any file to open its cross-session history
- `getUsageStats()` API: daily session count and token aggregation with project filter and date range
- `getProjectStats()` API: project ranking by session count and total tokens
- `getToolDistribution()` API: tool usage aggregation from CSV-encoded `tools_used` field
- `getTagDistribution()` API: tag frequency aggregation from CSV-encoded `tags` field
- `getWorkPatterns()` API: hourly session histogram and average duration
- `getRelatedSessions()` API: Jaccard coefficient similarity based on `session_files` reverse index, batched query (no N+1)
- IPC handles for all new APIs: `files:history`, `files:session`, `session:related`, `stats:usage`, `stats:projects`, `stats:tools`, `stats:tags`, `stats:patterns`
- `DistributionPieChart` reusable component for donut charts with configurable colors and labels
- `pathDisplay.ts` utility: cross-platform `basename()` and `lastSegment()` for renderer-safe path display
- `ViewMode` state (`sessions` | `dashboard`) in AppContext with title bar toggle
- `fileHistoryPath` state in AppContext for app-level FileHistoryDrawer management

### Changed

- ChatView toolbar restructured: export button wrapped in `toolbarActions` container alongside new files toggle
- All async `useEffect` hooks now include cancellation flags and `.catch()` error handling for graceful degradation
- `getFileHistory()` return type unified to `FileHistoryEntry` interface (was inline anonymous type)
- IPC optional parameter parsing extracted to `parseOptionalString()` helper (4 duplications removed)

## [1.3.0] - 2026-03-31

### Added

- **Structured summary engine** (Phase 3-A): session summaries upgraded from raw text truncation to template-based generation with three components:
  - **Intent extraction**: skips greetings/continuations ("hey", "ok", "continue"), finds the first substantive user message as session intent
  - **Activity summary**: generated from tool usage stats (e.g., "Edit×8, 5 files")
  - **Outcome inference**: two-layer system — observed signals (`gitCommitInvoked`, `testCommandRan`, `endedWithEdits`) feed into inferred status (`committed`/`tested`/`in-progress`/`quick-qa`); conservative: only labels on high confidence
- **Multi-signal tag engine**: expanded from 8 regex rules to 20+ text patterns, plus path-based inference (`.css` → ui, `test/` → testing), tool-pattern inference (heavy Read + low Edit → code-review), and outcome tags
- **Session files reverse index** (Phase 3-B): `session_files(session_id, file_path, operation, count, first_seen_seq, last_seen_seq)` table with mutation vs discovery operation types (read/edit/write vs discovery for grep/glob)
- `getFileHistory(filePath)` API: reverse lookup — which sessions touched a given file, ordered by time
- `getSessionFiles(sessionId)` API: forward lookup — which files a session operated on, with operation type
- Noise path filtering: `node_modules/`, `.git/`, `dist/`, `build/`, `.next/`, `.cache/`, `.vite/`, `coverage/` excluded from file index
- Session duration display in sidebar (`12m`, `1h30m`)
- Outcome status badge in sidebar with color-coded tags (committed=green, tested=blue, in-progress=yellow, quick-qa=purple)
- `summary_version` field for safe rule iteration and backfill tracking
- `formatDuration()` utility for human-readable duration formatting

### Changed

- **DB schema**: migration v8 adds `intent_text`, `outcome_status`, `outcome_signals`, `duration_seconds`, `summary_version` to `sessions` table; creates `session_files` table with composite primary key and path/session indexes
- Session list title now shows `intentText` (smart extraction) instead of raw `title` (naive truncation), falling back to `title` when intent is empty
- Existing sessions are force re-indexed on upgrade (migration v8 clears `file_mtime`) to populate new fields
- `summarizeSession()` return type changed from flat `SessionSummary` to `{ summary, sessionFiles }` to co-produce reverse index data
- `filesTouched` cap increased from 20 to 30 entries
- Outcome inference evaluates concrete signals (commit/test) before quick-qa check, preventing short but productive sessions from being misclassified

## [1.2.0] - 2026-03-31

### Added

- **Token Insights Engine** (Phase 2.6): heuristic rules that automatically interpret Token Budget charts, turning raw data into actionable insights
- `insightEngine.ts`: 5 insight rules — Context Spike detection, Context Limit warning, Cache Efficiency assessment, Output Hot Spot detection, Growth Rate analysis
- `InsightsPanel` component: severity-coded insight list (critical/warning/info/good) with expand/collapse for 3+ insights
- Insights integrated into TokenBudgetPanel below CostHeatBar

### Changed

- **Roadmap restructured** (PHASE-2-3.md): Phase 4 (cross-session archaeology) split and pulled forward into v1.3.0–v1.4.0; auto-updater deferred to v1.5.0+ pending code signing

## [1.1.0] - 2026-03-31

### Added

- **Context Budget visualization** (Phase 2.5): token usage tracking and charts for every session
- Parser extracts `message.usage` fields from JSONL (input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, model)
- `getSessionTokenStats` IPC API returning per-turn token breakdown with cache hit rate and model distribution
- TokenBudgetPanel: expandable panel in ChatView toolbar with toggle button
- TokenSummaryCard: 4-cell grid showing Total Input, Total Output, Cache Hit Rate, and Model(s) with multi-model percentage display
- ContextGrowthChart: recharts stacked area chart (New Input / Cache Creation / Cache Read) with 200K/1M context limit reference line toggle
- TokenBreakdown: donut pie chart showing Cache Read / Cache Creation / New Input / Output token type proportions
- CostHeatBar: horizontal heat bar visualizing per-turn output token intensity with automatic binning for sessions >200 turns
- TokenHeatGutter: inset box-shadow heat indicator on assistant message bubbles — green for good cache hits, red for high context delta
- Session list token badge: total token count (input + output) displayed next to message count
- Session list sort toggle: switch between Time (default) and Tokens ordering
- Shared `formatTokens()` utility for consistent token number formatting across components
- Shared `TOKEN_COLORS` and `CHART_TOOLTIP_STYLE` constants for chart visual consistency

### Changed

- **DB schema**: migration v7 adds `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `model` columns to `messages` table; adds `total_input_tokens`, `total_output_tokens` to `sessions` table
- Existing sessions are force re-indexed on upgrade (migration v7 clears `file_mtime`) to populate token fields
- ChatView toolbar layout changed from `flex-end` to `space-between` to accommodate Token Budget button
- Extracted `MessageRow` type and `mapMessageRow()` helper in database.ts to reduce duplication across `getMessages()` and `getMessageContext()`
- TokenBudgetPanel layout: ContextGrowthChart and TokenBreakdown displayed side-by-side in grid, CostHeatBar below
- MessageBubble receives resolved `HeatInfo` instead of full Map for better `memo` stability

### Fixed

- FTS5 search query injection: internal double quotes now escaped before wrapping (`fts5QuoteIfNeeded`), applied consistently to both `search()` and `searchSessions()`
- IPC `message:context` range parameter clamped to [0, 10] to prevent unbounded DB scans
- TokenBudgetPanel handles IPC errors gracefully with error state display instead of blank expanded panel
- CostHeatBar: no longer shows fake `max: 1` when all turns have zero output tokens
- Token heat gutter uses inset `box-shadow` instead of `border-left` to avoid overriding theme-specific assistant borders (timeline/terminal)
- `Math.max(...spread)` replaced with `reduce` in TokenHeatGutter and CostHeatBar to prevent stack overflow on large sessions

## [1.0.0] - 2026-03-30

### Added

- **Session auto-summary** (Phase 2-1): heuristic-based session summaries generated at index time — intent/conclusion text, auto-tags (bug-fix, refactor, testing, deployment, auth, ui, docs, config), files touched, and tool usage stats
- **Search context preview** (Phase 2-2): expandable ▸ button on each search result showing 2 messages before/after the match, loaded on demand via `getMessageContext()` API
- **Session-level search** (Phase 2-3): new "標籤/檔案" search mode that queries session title, tags, file paths, and summary text via dedicated `sessions_fts` FTS5 index
- Search type toggle in SearchBar: switch between "對話" (message content) and "標籤/檔案" (session metadata)
- `SessionSearchResults` component for session-level search display with tag badges
- Session list now shows auto-tags (up to 3) and file count per session

### Changed

- **DB schema**: migration v5 adds `summary_text`, `tags`, `files_touched`, `tools_used` columns to `sessions` table; migration v6 adds `sessions_fts` FTS5 virtual table
- Session list item height increased from 56px to 80px to accommodate tag row
- Existing sessions are force re-indexed on upgrade (migration v5 clears `file_mtime`) to populate summary fields
- FTS5 session search auto-quotes queries containing `/`, `.`, `-`, `\` for tokenizer compatibility

### Fixed

- Search results context preview uses `useRef` for cache to avoid unnecessary re-renders
- `indexSession()` uses `lastInsertRowid` instead of redundant SELECT for FTS5 sync
- File count badge shows "20+" when `filesTouched` is capped at 20 entries
- Session tags and file count display even when only one is present (not gated on tags alone)

## [0.9.1] - 2026-03-30

### Added

- Windows build support: NSIS installer + ZIP in release pipeline
- Auto VACUUM after DB migration to reclaim disk space
- Platform-specific artifact naming (`mac-`/`win-` prefix)

## [0.9.0] - 2026-03-30

### Added

- DB migration system: `schema_version` table with automatic migration runner
- Search pagination: 30 results per page with "Load More" button
- Search results grouped by session: collapsible session groups with match count badges
- Archived sessions: JSONL files deleted from disk are preserved in DB as "已封存" instead of being permanently deleted
- `message_content` and `message_archive` side tables for data preservation

### Changed

- **Breaking (DB schema)**: `messages` table split into 3 tables for search performance — `content_json` moved to `message_content`, `raw_json` moved to `message_archive`. Existing DBs auto-migrate on startup (~60-90s for large DBs)
- FTS5 snippet context expanded from 32 to 64 tokens
- FTS5 snippet delimiters changed from `<mark>` HTML to Unicode Private Use Area sentinels (U+E000/U+E001) to prevent UI glitch when indexed content contains literal `<mark>` text
- `removeStaleSessionsExcept()` renamed to `archiveStaleSessionsExcept()` — sets `archived=1` instead of deleting
- Search API returns `SearchPage` (with `results`, `offset`, `hasMore`) instead of flat `SearchResult[]`
- Search scope preserved across pagination (fixes bug where "Load More" used wrong project filter)

### Fixed

- Archived sessions re-index correctly when JSONL file reappears (even if mtime unchanged)
- Migration v1 uses `INSERT OR IGNORE` to prevent UNIQUE conflict on partial migration recovery
- Search `limit` hard-capped at 100 as defense-in-depth
- IPC search query length limited to 500 characters
- Collapsed search groups reset on new search query

## [0.8.0] - 2026-03-29

### Added

- Syntax highlighting for code blocks via highlight.js `atom-one-dark` theme
- Local font bundling: all 6 font families (7 woff2 files, ~402 KB) shipped with the app — fully offline, no Google Fonts CDN dependency

### Changed

- CSP tightened: removed `fonts.googleapis.com` and `fonts.gstatic.com` from `style-src` and `font-src`
- Removed phantom `Geist Mono` from Timeline theme font stack (was never bundled)
- `highlight.js` promoted from transitive to direct dependency

## [0.6.0] - 2026-03-29

### Added

- GitHub Release update checker: detects new versions on app launch and shows a notification banner in the sidebar
- Update banner with "下載" (opens GitHub Release page) and "略過" (dismisses for current session) buttons
- Terminal theme-specific styling for update banner (outline-style buttons for better contrast)
- Version comparison utility with numeric (not lexical) semver parsing
- Runtime type validation for GitHub API responses

## [0.5.2] - 2026-03-29

### Fixed

- Color contrast WCAG AA compliance for all three themes:
  - Timeline: `--color-text-muted` #94A3B8 → #6B7994 (2.47:1 → 4.67:1)
  - Archive: `--color-text-muted` #9A8E7D → #706658 (2.8:1 → 4.97:1)
  - Terminal: `--color-text-muted` #4A5068 → #9298AC (2.15:1 → 6.11:1)
  - Terminal: `--color-text-secondary` #7A8194 → #8D95A8
  - Terminal: `--color-border` #2E3140 → #3D4255 (dashed separators more visible)
- Focus management: search jump now moves focus to target message (`tabIndex={-1}` + `el.focus()`)
- Path hardcoding in `ProjectList.tsx`: replaced `/Users/` prefix with cross-platform regex
- Search bar missing loading state: input disables with "搜尋中..." placeholder during query

## [0.4.0] - 2026-03-29

### Added

- Full-text search UI: SearchBar with Enter-to-search, scope toggle (all/current project)
- SearchResults with FTS5 snippet preview, click-to-jump with scroll + pulse animation
- MessageBubble search highlight (`<mark>`) for user messages
- Markdown export: session → `.md` file with metadata table, user/assistant messages, tool `<details>` blocks
- Export button in ChatView toolbar with native save dialog
- Dynamic backtick fence (`makeFence`) for safe code block export
- Title bar drag region for macOS `hiddenInset` window

### Fixed

- Same-session search jump: effect now triggers on `targetMessageId` change (not just `loading`)
- Search excludes non-rendered message types (`last-prompt`, `queue-operation`)
- Removed redundant `pendingScrollRef` in favor of direct `targetMessageId` usage

### Changed

- Exporter extracts tool blocks once per message (was parsed twice: filter + render)

## [0.3.0] - 2026-03-29

### Added

- Sidebar semantic markup (`<header>`, `<section>`, `<h1>`/`<h2>`, `aria-labelledby`)
- ToolBlock keyboard focus style (`:focus-visible`)
- ToolBlock emoji `aria-hidden` for screen readers
- Placeholder empty state with chat bubble SVG icon
- Production CSP via `session.webRequest.onHeadersReceived` (main process)
- `postinstall` hook for automatic `electron-rebuild`
- `rollupOptions.external` for `better-sqlite3` in electron-vite config
- `asarUnpack` for `better-sqlite3` in electron-builder config

### Fixed

- System message color contrast (`#856404` → `#664d03`, 7.04:1 ratio, WCAG AA)
- CSP `script-src 'self'` blocking Vite dev server inline scripts
- `better-sqlite3` native module ABI version mismatch (NODE_MODULE_VERSION 127 vs 130)

### Changed

- `useSession` hook refactored from 4x `setState` to single `useReducer` dispatch

## [0.2.0] - 2026-03-28

### Added

- Sidebar component with project list, session list, and indexer status (Task 5-6)
- ChatView with MessageBubble, ToolBlock, and markdown rendering (Task 5-6)
- AppContext with `useReducer` for global state management
- `useSession` and `useIndexerStatus` custom hooks
- CSS module styling with design token system (`global.css`)
- Rehype plugin pipeline for syntax highlighting and sanitization

### Fixed

- Rehype plugin order: `rehypeSanitize` before `rehypeHighlight`
- Indexer refetch optimization
- 3 high-severity security issues
- Render-phase derived state for loading reset

## [0.1.0] - 2026-03-27

### Added

- Electron + React + TypeScript + Vite project skeleton (Task 1)
- Scanner + Parser modules for JSONL conversation files (Task 2)
- Database + Indexer modules with better-sqlite3 (Task 3)
- IPC communication layer with invoke/handle pattern (Task 4)
- Content Security Policy and window security hardening
