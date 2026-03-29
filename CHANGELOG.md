# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
