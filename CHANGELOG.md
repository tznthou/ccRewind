# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
