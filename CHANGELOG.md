# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
