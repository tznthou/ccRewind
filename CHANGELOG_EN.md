# Changelog

[中文](CHANGELOG.md)

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.19.2] - 2026-07-22

### Fixed

- **Token Budget context plan misdetection**: `detectContextPlan()` previously relied solely on whether any turn exceeded 200K to infer the context window size. Claude 4+/5+ models with 1M context were misclassified as 200K plan when token usage stayed below 200K (showing "84% of 200K limit"). Added model-based inference: Claude 3.x / Haiku → 200K, Claude 4+/5+ → 1M
- **JSONL whitelist: add `file-history-delta`**: new file undo tracking type from CC v2.1.215+, no longer stored as unknown type with `raw_json`

## [1.19.1] - 2026-07-20

### Changed

- Dependency updates: eslint 10.7.0, typescript-eslint 8.64.0, globals 17.7.0, pnpm 11.13.1, Node.js 22.23.1, @tanstack/react-virtual 3.14.6, and other patch fixes

## [1.19.0] - 2026-07-08

### Added

- **JSONL whitelist completion + remote-control detection (migration v23)**:
  - **4 new whitelisted types**: `mode`, `agent-setting`, `bridge-session`, `frame-link`. The first two carry no extractable content (`mode` is always "normal" in real data, `agent-setting` only ever "general-purpose"); the signals of the latter two are captured by the new columns below. None of them dump `raw_json` into `message_archive` as unknown types anymore
  - **frame-link Artifact URLs land in the DB**: the `frameUrl` of a `frame-link` attachment is parsed into `messages.frame_url` (≤4096 char guard, matching the `editedFilePath` precedent)
  - **Remote-control session flag**: new `sessions.has_remote_control`. `bridge-session` is Claude Code's remote-control session bridge marker; verified against real sessions, it spans the whole session lifecycle rather than appearing per turn, so it is derived as a session-level existence check instead of per-message tracking

### Changed

- Migration v23 forces a full reparse (`file_mtime` reset); existing sessions get `frame_url` and `has_remote_control` backfilled
- Package manager upgraded pnpm 10.x → 11.8.0 (includes security fixes; build-script approval migrated to `allowBuilds` in `pnpm-workspace.yaml`); GitHub Actions dependencies updated

## [1.18.0] - 2026-07-07

### Added

- **JSONL tree structure integrity (migration v22)**. Fixes three gaps flagged by a dev.to reader's technical review (Skillselion, 2026-07-06):
  - **parentUuid lands in the DB**. `parser.ts` already parsed it, but `indexer.ts` never copied it into `MessageInput`. `messages` now has a `parent_uuid` column + index. This is metadata for downstream fork detection — UI rendering order still uses the existing `sequence`, no tree-based reordering.
  - **Compaction/sidechain subtype flags**. Parses top-level `isCompactSummary`/`isSidechain` from JSONL into new `messages` columns; ChatView renders a badge for each.
  - **Same-file rewind abandoned-branch marking**. New `markAbandonedBranches`: identifies a fork (2+ real human-authored branches sharing a `parentUuid`) where one branch's reachable depth along the parentUuid chain is far shorter (< 10%) than the group's longest branch, and flags it `is_abandoned_branch`. ChatView renders it with a dashed border + an "Abandoned branch (rewind)" badge. The original "does it have any direct child" (1-hop) check missed real cases during verification against production data — an abandoned branch typically has exactly one trailing bookkeeping entry (e.g. an attachment) before it truly dies. Switched to comparing each branch's relative reach depth, which correctly caught real examples (e.g. a "continue" branch superseded after a rewind).
  - **`message_archive` now stores `version`**. Unknown-type entries being archived often lack a top-level JSONL `version` field themselves (that entry type simply doesn't carry one); backfilled from the nearest entry in the same file (`resolveNearestVersions`) so archived rows can answer "which schema version introduced this shape."

### Changed

- Migration v22 forces a full reparse (`file_mtime` reset) so existing sessions backfill `parent_uuid`/`is_compact_summary`/`is_sidechain`/`is_abandoned_branch`/`message_archive.version`.
- README caught up on two user-visible features it had missed: v1.17.0's thinking-block collapsing and this release's rewind abandoned-branch marking. Also fixed two inconsistent test counts in the tech stack table and project structure tree (496/469 → the actual 534), and bumped the TypeScript badge/version to the one actually in use (5.9).

## [1.17.0] - 2026-06-28

### Added

- **Render thinking blocks in the conversation view**. Assistant thinking (reasoning) has always been preserved verbatim in `message_content.content_json` (the parser keeps the full content array), but the UI only rendered content_text and tool blocks, so thinking was invisible. Adds `extractThinkingBlocks` (lenient parse) and a collapsible `ThinkingBlock` component (reusing `MarkdownRenderer`), shown as a collapsible block above the assistant's output text. Default-collapsed and lazy-mounted (a single block can run tens of thousands of chars; collapsed blocks aren't parsed); `contentJson` extraction is memoized to avoid re-parsing on search re-renders. No parser or schema change, no re-index. i18n zh-TW and en.

## [1.16.0] - 2026-06-07

### Added

- **Attribution tracking (migration v21)**. Parser extracts `attributionSkill`, `attributionPlugin`, `attributionMcpServer`, `attributionMcpTool`, and `attributionAgent` from JSONL top-level fields into the `messages` table. Enables tracing which skill, plugin, or MCP tool generated each AI response — archaeological context like "this answer was produced using context7 MCP + Explore agent." All fields guarded to ≤512 chars, consistent with existing uuid/requestId bounds.
- **Image block detection + base64 stripping**. `parseContent` now handles `type: "image"` blocks, setting `hasImage` to true. Before storing `contentJson`, base64 image data (`source.type === "base64"`) is precisely stripped (replaced with `[base64-stripped]`), preserving block structure (type, media_type) for future UI placeholders. Prevents screenshots and pasted images from bloating the SQLite DB.
- **Structured API error parsing**. System messages now store `system_subtype` (≤128 char guard); when `subtype === "api_error"`, the parser extracts `error.status` (HTTP status code, e.g., 529 overloaded) into `api_error_status`. Provides first-party data for degradation detection: SQL-queryable "how many 529 errors in the past 7 days."
- **Edited file tracking (attachment parsing)**. Parser extracts `filename` from `attachment.type === "edited_text_file"` entries (≤4096 char guard); the summarizer's `extractFileEvents` integrates these as `operation: "edit"` events, automatically feeding into `session_files` and `filesTouched`. Known behavior: the same file may appear in both a tool_use Edit and an edited_text_file attachment, incrementing the aggregated count — does not affect functional correctness.

### Changed

- **`SUMMARY_VERSION` 3 → 4** (rides on migration v21). **The first Sync after upgrading will reparse every session** to populate new fields (attribution, hasImage, systemSubtype, apiErrorStatus) and append edited_text_file session_files events. One-time cost; subsequent syncs return to normal incremental behavior.
- **`extractFileEvents` structural refactor**. Changed from `continue` early-return to `if` block so the new `editedFilePath` check isn't skipped by the tool_use guard. Logically equivalent refactor with no behavioral change (other than the new editedFilePath events).

## [1.15.0] - 2026-05-26

### Added

- **Session star/bookmark** (`2e2d5dd`). Session list now supports star bookmarks: hover to reveal ☆, click to toggle ★, and use the ★ filter button to show only starred sessions. Backed by an independent `session_stars` table (migration v20, no FK) that survives reindex; optimistic update with rollback for instant UI feedback. Full a11y (`aria-pressed`, `aria-label`) and i18n (zh-TW + en).

## [1.14.0] - 2026-05-21

### Added

- **Session ID chip with one-click copy** (`a0e0b3e`). ChatView toolbar now has a sessionId chip: shows the 8-char prefix, copies the full UUID on click, 1.5s visual flash, screen-reader announcement. Carrying the sessionId out to external tools (grep, `claude --resume`, issue reports) used to mean digging through devtools selectors — now it's a single click.
- **Tool-error detection infrastructure (migration v19)** (`7c862e3`, `f804ce1`). New `tool_error_count` column on `messages` (NOT NULL DEFAULT 0); the parser counts `is_error: true` tool_result blocks per message during ingest, feeding the downstream degradation-detection work (Phase D). **No UI in this release** — pure plumbing. Cross-project scans show 34.2% of sessions contain at least one `is_error`, which is the most direct signal of "Claude Code recovered on the next try vs. got stuck in a loop" — but we're holding off on surface design until real data from Phase D tells us what users actually need to see.
- **Renovate + Electron smoke workflow** (`bf7e8f8`, PR #20). `.github/renovate.json` configured with ADR-003's five packageRules (Electron-stack dashboard / TypeScript carve-out / safe-patch automerge / minor manual / GitHub Actions); new mac+win matrix `electron-smoke.yml` runs `pnpm dist` to validate native bindings (better-sqlite3 ABI). `packageManager` pinned to `pnpm@10.20.0`; the `with: version` field removed from `pnpm/action-setup` calls in CI to resolve the double-pin conflict. See `docs/ADR-003-dependency-upgrade-tool.md`.

### Fixed

- **Search result group headers now show the date** (`f7fb897`). `SearchResults` / `SessionSearchResults` group headers switched from `formatTime` (HH:MM) to `formatDateTime` (MM/DD HH:MM), so cross-day search results no longer leave you guessing which day a match came from. Individual match timestamps stay HH:MM because the group header already covers the date, keeping the row layout tight.
- **Summarizer now skips slash-command wrapper messages** (`20a8c91`). When the user types `/command args`, the JSONL first records a wrapper user message (content is a `<command-name>` XML stub), with the actual prompt in the next entry. The intent extractor used to grab the first user message and end up with the empty wrapper. It now detects and skips those wrappers, falling through to the real intent.

### Changed

- **`SUMMARY_VERSION` 2 → 3** (rides on migration v19). **The first Sync after upgrading to v1.14.0 will reparse every session** (measured at ~30–60s for 1,104 sessions / ~550k messages) to backfill the new `tool_error_count` column. This is a one-time cost; subsequent syncs return to normal incremental behavior.

### Docs

- **ADR-003 + PLAN.md Task 11** (`908de19`). Captures the Renovate-vs-Dependabot decision, the rationale behind each of the five packageRules, and why Electron smoke matters, all written up as ADR-003; PLAN.md adds Task 11 tracking the rollout.

## [1.13.0] - 2026-05-14

### Added

- **Tasks Panel: per-session TODO history surfaced in ChatView** (`8c9b44b`). Claude Code's `TaskCreate` / `TaskUpdate` writes per-session todos to `~/.claude/tasks/{sessionId}/*.json` — the most direct evidence of what the AI planned for this conversation and where it got stuck — yet there was no way to see them from the UI. A new Tasks Panel renders inline beneath `SubagentPanel` in ChatView: subject text, three-state status badge (pending / in_progress / completed), and `blockedBy` dependency chips.
  - Backend pipeline: `migration v18` adds the `session_tasks` table with a `(session_id, task_id)` composite PK and **deliberately no FK** — decoupling task history from the session reindex's delete/reinsert cycle, so an exclusion-rule cleanup followed by a rebuild doesn't wipe the session's task rows along with it
  - `scanner.scanTasks` reads `~/.claude/tasks/{sessionId}/*.json` (skipping `.lock`); `task-parser.parseTaskFile` validates id/subject/status and coerces arrays; `indexer.runTaskScanning` runs after the subagent phase using per-file mtime diff in append-mode (snapshot-only, no edit history)
  - IPC `session:tasks` + `getSessionTasks` ElectronAPI, with zh-TW + en i18n in lockstep
  - Code review + security audit pass caught two follow-ups: high (Codex) — `runTaskScanning` now skips sessions absent from the DB so exclusion-rule deletions don't accrue orphan task rows; medium (security) — 1MB file-size cap on task JSON to prevent OOM via symlink or oversized-file attacks
  - 16 new regression tests (parser + scanner); total 445/445 green

## [1.12.2] - 2026-05-07

### Fixed

- **JSONL parser normalizes lone UTF-16 surrogates at every exit point** (`dd357c8`, `cb81b84`). Claude Code <2.1.132's tool-error truncation could cut into emoji codepoints, leaving unpaired UTF-16 surrogates (lone high or low surrogate code units) in the JSONL strings. Newer Claude Code versions sanitize in-memory on `--resume`, but the on-disk files remain affected. ccRewind is a read-only consumer of those files: better-sqlite3 silently substitutes U+FFFD on INSERT (no crash) and `JSON.stringify` emits ASCII escapes like `\uD83D`, but downstream `JSON.parse(contentJson)` restores the lone surrogate — React rendering and the exporter then rely on V8's fallback behavior, leaving the contract implicit. A new `ensureWellFormed(s)` helper wraps `String.prototype.toWellFormed()` (ES2024, native in Node 20+) and is applied at the four parser exit points: `parseContent`'s string path, its array text-block path, `parseLine`'s top-level `obj.content` branch (queue-operation etc.), and inside the `JSON.stringify(message.content, replacer)` call so every string leaf — including nested `tool_result.content` — gets normalized before persistence; downstream `JSON.parse` then yields well-formed strings. Downstream summarizer / FTS5 / UI / exports never need to know about this legacy dirty data. Adds 9 regression tests (429/429 green). OWASP A03 (input validation).

## [1.12.1] - 2026-05-05

### Added

- **Token Budget panel internationalization** (`492bf2b`). The Token Budget surface — six chart components (`TokenSummaryCard`, `ContextGrowthChart`, `TokenBreakdown`, `CostHeatBar`, `InsightsPanel`, `TokenBudgetPanel`) plus the `insightEngine` rule set — was the last hardcoded-bilingual hold-out: every Insight title and body was a static zh-TW string sliced by a runtime locale switch. The engine now returns `Insight` with a discriminated-union `data: InsightData` (7 insight types, plus a `SpikeCause` sub-union) and stays i18n-agnostic; the UI carries a small `insightMessages.ts` mapping layer that converts `InsightData → MessageKey`. 43 new `tokenBudget.*` keys, zh-TW and en in lockstep via the `satisfies MessageCatalog` typecheck. A new `insightMessages.test.ts` adds 14 sample × 2 locale smoke tests plus 14 explicit mapping-correctness assertions, so adding a new insight type without wiring its message key now fails the test suite instead of silently rendering an empty string.

### Fixed

- **Token Budget plan detection — 226K context no longer misreported as "113% of 200K"** (`768d95e`). `assessContextLimit` was a cascade of `if`-statements with no plan detection: any `contextTotal` between 200K and 800K fell into the 200K branch and rendered "Context at 113% of 200K limit (226.8K)" — physically impossible, since a 200K-context model rejects > 200K requests in the first place. Reaching 226K is itself proof the session ran on a 1M-context model. A new `detectContextPlan(turns)` returns `'1m'` if any observed `contextTotal` exceeds 200K and `'200k'` otherwise; `assessContextLimit` picks the matching threshold band; `ContextGrowthChart`'s reference-line toggle defaults to the detected plan so the chart and the Insights panel stay consistent. Pre-condition (assumes one plan-class per session — holds in current architecture because subagent turns live in separate JSONL files and cross-plan `/model` switches mid-session are unusual) is documented inline. Adds 5 regression tests including the original screenshot case.

- **Token Budget panel no longer leaks raw exception text to the UI** (`7f014fa`). `TokenBudgetPanel`'s catch path forwarded the raw `e.message` from the IPC failure straight into the visible `setError` state, which could surface internal wording (file paths, native module errors, SQLite reasons) to end users on a panel whose visible promise is just "couldn't load token stats". Now fails closed: a generic i18n `tokenBudget.error.loadFailed` message is shown to users, while the underlying error is logged via `console.error` only in DEV builds. OWASP A09 + A10.

## [1.12.0] - 2026-05-04

### Added

- **Dashboard internationalization across all 7 cards** ([#19](https://github.com/tznthou/ccRewind/pull/19)). The Dashboard page — previously the last hardcoded-zh-TW surface — now drives every visible string through the `MessageKey` catalog: card titles, range buttons (7d / 30d / 90d / all), trend toggle, project filter, empty states, chart aria-labels, and ~50 new `dashboard.*` keys. zh-TW and en stay lockstep via the `satisfies MessageCatalog` typecheck. Combined with the v1.10.0 sidebar/dialog/title-bar i18n, the entire UI surface is now bilingual.

- **Visually-hidden chart data summaries for screen readers** ([#19](https://github.com/tznthou/ccRewind/pull/19)). Recharts components (Pie, AreaChart, heatmap) wrapped in `role="img"` previously hid their visible legend and data values from assistive tech — SR users only heard generic labels like "Tool usage distribution pie chart" with no actual values. Each chart now exposes a visually-hidden description via `aria-describedby`: `DistributionPieChart` lists every `{name}: {value} {unit}` item, the trend charts summarize totals across the date range, and `WorkPatternHeatmap` enumerates active hours. Adds three `dashboard.aria.*` summary keys (zh-TW + en lockstep) and a `.visuallyHidden` CSS helper.

- **Inline visible legend for Project Health** ([#19](https://github.com/tznthou/ccRewind/pull/19)). The stacked bar previously rendered five outcome colors with no key — readers had to hover each segment to learn what `#22c55e` meant. The card now shows a horizontal legend (committed / tested / in-progress / quick-qa / unknown) above the list, sourced from the same `outcomeColors.ts` module that drives the bar segments and the `UnresolvedSessions` badges so colors can never silently drift apart.

- **Descriptive subtitles on six Dashboard cards** ([#19](https://github.com/tznthou/ccRewind/pull/19)). Each card title is now followed by a one-line muted subtitle explaining what the card measures (e.g., "Token consumption and session volume over time" under Usage Trend). Helps first-time users understand which question each card answers without needing a tour.

### Changed

- **Outcome inference upgraded — "in-progress" status now visible** ([#18](https://github.com/tznthou/ccRewind/pull/18)). The summarizer's outcome classifier was leaving 53% of sessions tagged `unknown` because it only inspected the last 5 raw messages and used narrow regexes for commit/test detection. v2 widens the regex set (more git-commit and test-runner patterns), adds an `ACTIVE_WORK_RE` for sessions actively editing without committing, and — most importantly — slices the last 5 messages **that contain tool use** instead of the trailing 5 messages of any kind (which were often thinking/explanation tail). Real-world impact on the local index: NULL drops from 53.0% → **15.3%**, `in-progress` becomes a visible category at 37.3% (was 0%), and Project Health's stacked bars now actually show the work-in-progress segment they were designed for. Bumps `SUMMARY_VERSION` 1 → 2 so existing sessions auto-backfill on next index scan; no schema change required.

- **"Waste Detection" renamed to "Unresolved Sessions"** ([#19](https://github.com/tznthou/ccRewind/pull/19)). The original name implied user judgment ("you wasted time on this"); the new name describes the data ("sessions that didn't reach a clear outcome"). Rename is frontend-only — the IPC channel `stats:waste` and the `WasteSession` type at the boundary are intentionally retained to avoid a risky cross-process migration. The two-name asymmetry is documented and lives only at the IPC seam.

### Fixed

- **Project filter aria-label now describes the control, not its default option** ([#19](https://github.com/tznthou/ccRewind/pull/19)). The `<select>` previously used `aria-label={t('dashboard.filter.allProjects')}` (rendering as "All projects" / 「全部專案」), which is the option text — so screen readers announced "All projects, combo box, All projects" with no indication of what the control does. New `dashboard.filter.label` key ("Filter by project" / 「依專案篩選」) describes the purpose; the option text key is unchanged.

- **Outcome colors centralized to prevent silent drift** ([#19](https://github.com/tznthou/ccRewind/pull/19)). `ProjectHealth` and `UnresolvedSessions` previously each defined their own `OUTCOME_COLORS` map — and the values were already slightly inconsistent (`UnresolvedSessions` was missing `committed` and `tested`). Both now import from a single `src/renderer/components/Dashboard/outcomeColors.ts` source, alongside the canonical `OUTCOME_KEYS` order, the `DISTRIBUTION_KEY ↔ OutcomeKey` bidirectional mapping, and the `resolveOutcomeColor` fallback helper. Adds 10 invariant unit tests guarding the contracts.

## [1.11.0] - 2026-05-03

### Added

- **FTS5 search syntax hints on empty results** ([#13](https://github.com/tznthou/ccRewind/pull/13)). When a search query returns zero results, a new `SearchSyntaxHints` component renders four FTS5 syntax chips (exact phrase, prefix, `OR`, `NOT`) inside both `SearchResults` and `SessionSearchResults` empty states. Surfaces what the query language can do at the moment users need it, instead of leaving them at a dead-end empty page.

- **Live region for screen reader announcements** ([#15](https://github.com/tznthou/ccRewind/pull/15)). A global polite live region announces dynamic results to screen readers: search completion (with result count and session group count), empty results, and manual "Sync now" completion. The new `LiveRegion` component uses `<span key={seq}>` to force remount so identical messages re-announce on repeat triggers (otherwise SR ignores duplicate text). `AppContext` gains an `ANNOUNCE` action with a monotonic `searchSeqRef` guard preventing stale async resolutions from announcing wrong counts when filter buttons are clicked rapidly.

### Changed

- **BREAKING — License relicensed from AGPL-3.0 to GPL-3.0-or-later.** GPL fits a read-only desktop app better; AGPL's network clause has no practical effect on a non-SaaS application and risked misleading users about the deployment model. `LICENSE` replaced with GPL v3 text; `package.json` now declares the SPDX identifier; license badge and section in both READMEs updated.

- **README features restructured.** 27 individual feature rows grouped into 5 collapsible `<details>` blocks (Browsing & Search and Token & Context open by default; Statistics & Archaeology, Data & Storage, UI & Interaction collapsed). Project Structure tree wrapped in `<details>` to reduce visual weight. DB Compaction (the 1.9.1 feature) added to Features — was missing from both language versions.

- **English README parity with Chinese.** Core Concept expanded with structured rule engine details (intent + action + outcome) and three-signal tag inference. Features gained the missing File Reverse Index, Token Insights, and Token Heat Indicators rows. Architecture mermaid added the Summary Engine node. Test count synced 342 → 345 across tech stack table and project structure tree.

### Fixed

- **Tooltip completeness on icon-only / badge UI** ([#14](https://github.com/tznthou/ccRewind/pull/14)). Two missing accessible labels: `FileHistoryDrawer` close button now uses `aria-label` + `title` from the existing `common.close` key; `SubagentPanel` agentType breadcrumb badge gains a new `chatView.subagent.typeBadgeTitle` key (zh-TW + en) so screen readers and hover tooltips both announce what the badge represents.

- **Distinguish searchError from searchEmpty in screen reader announcements** ([#16](https://github.com/tznthou/ccRewind/pull/16)). The catch path in `SearchBar.executeSearch` was reusing `announceResult(type, 0, 0, q)`, which routes through the `count===0` branch to announce "No results found" — indistinguishable from a genuine empty result. SR users had no signal whether to rephrase the query (no match) or retry (transient IPC error). A new `a11y.announcement.searchError` key (zh-TW + en) is now dispatched directly from the catch path.

- **ThemeSwitcher ARIA radio keyboard pattern** ([#17](https://github.com/tznthou/ccRewind/pull/17)). `ThemeSwitcher` used `role="radiogroup"` + `role="radio"` but had no keyboard support — arrow keys did nothing and only Tab+Enter/Space worked. Inconsistent with the sibling `FontScaleSwitcher` (added in v1.10.0) which fully implements the WAI-ARIA radio keyboard pattern. `ThemeSwitcher` now mirrors that pattern: ArrowRight/Down → next, ArrowLeft/Up → prev, Home → first, End → last; roving tabIndex (only the active radio is `tabIndex=0`); focus moves with selection.

## [1.10.0] - 2026-05-02

### Added

- **Internationalization — Traditional Chinese (zh-TW) and English (en) UI localization** ([#9](https://github.com/tznthou/ccRewind/pull/9)). The entire UI surface — sidebar headers, titlebar tooltips, dialogs, error messages, ARIA labels, dashboard copy — is now driven by a type-safe `MessageKey` catalog instead of hard-coded zh-TW strings. A new `LanguageSwitcher` in the title bar toggles the locale; the choice persists to `localStorage` and `<html lang>` updates accordingly. Defaults to `zh-TW`; falls back to `zh-TW` when `localStorage` is unavailable. The catalog uses `satisfies Record<MessageKey, string>` so missing or stale keys fail the strict `tsconfig.web.json` typecheck.

- **Sidebar sync UX — focus-driven auto-reindex, manual "Sync now", and staleness label** ([#10](https://github.com/tznthou/ccRewind/pull/10)). Previously, ccRewind only indexed at startup; new sessions written to `~/.claude/projects/` after launch went unseen until the next restart. The renderer now reindexes when the BrowserWindow regains focus (in-flight Promises de-duplicate so rapid focus-blur cycles don't thrash the indexer), exposes a manual "Sync now" button on the sidebar header, and shows a "Last indexed Xs ago" label so users know how stale the view is. Internally, `IndexerProgress` (used by `runIndexer` while the job is running) is split from `IndexerStatus` (the IPC contract that adds `lastIndexedAt`) so the indexer's internal events stay free of UI-layer concerns.

- **Arrow key navigation across sidebar lists** ([#11](https://github.com/tznthou/ccRewind/pull/11)). Project list, session list, message search results, and session search results now support `ArrowUp` / `ArrowDown` keyboard navigation; pressing `ArrowDown` from the search bar hands off focus to the first result. `ProjectList` and `SessionList` dispatch selection on each arrow press; `SearchResults` and `SessionSearchResults` move only the active highlight on arrows, with `Enter` performing the cross-context navigate (which is heavier and shouldn't fire on every keystroke). Implementation uses `aria-activedescendant` rather than roving `tabIndex` so virtualized lists don't lose focus when the active row unmounts during scroll.

- **Font scale switcher in the title bar** ([#12](https://github.com/tznthou/ccRewind/pull/12)). Three tiers — normal (1.0×), large (1.1×), and xlarge (1.25×) — scale the entire UI's font-size tokens via a `--font-scale` CSS variable on `:root`. The choice persists to `localStorage` and a synchronous `font-scale-init.js` reads the value before React mounts, preventing FOUC. Tiers are scale-up only; a smaller `0.9×` tier was rejected because `0.9 × 11px = 9.9px` would push the smallest font tokens below comfortable readability for the accessibility audience this feature targets. Includes the full ARIA radio keyboard pattern (ArrowLeft/Right/Up/Down + Home/End + roving tabIndex + focus moves with selection).

## [1.9.3] - 2026-04-29

### Added

- **Search keyword highlight inside Assistant Markdown and Tool blocks** ([#6](https://github.com/tznthou/ccRewind/issues/6)). Previously only User messages got `<mark>` highlighting on the matched term; clicking a search result that landed in an Assistant message or a `tool_result` (which can run to thousands of lines for grep/Read output) would scroll to the bubble but leave the reader hunting for the keyword. A new `rehypeSearchHighlight` plugin wraps matches in Markdown text nodes — including inline `code` for function names / file paths — while intentionally skipping fenced `<pre><code>` blocks to preserve highlight.js token structure. `ToolBlock` now memoizes `highlightText` over its `<pre>` content. When the matched mark sits inside a collapsed `<details>` (typical for `tool_result`), the block auto-opens and the viewport scrolls precisely to the first match.

### Fixed

- **Search-result clicks no longer randomly fail to scroll to the matched message.** A `useEffect` race condition in `ChatView` made first-time clicks frequently leave the viewport pinned at the top: the search effect dispatched `CLEAR_TARGET_MESSAGE`, which retriggered a sibling "scroll-to-top" effect (which had `targetMessageId` in its dependency array) and overrode the search scroll. The reset effect now uses `prevSessionIdRef` to fire only on actual session changes, and both outer/inner `requestAnimationFrame` callbacks are cancelled in cleanup to avoid stale callbacks under rapid clicks.

## [1.9.2] - 2026-04-21

### Fixed

- **Cross-project navigation now syncs the Sidebar project context** ([#3](https://github.com/tznthou/ccRewind/issues/3)). Clicking a Related Session, File History entry, session/message search result, or Waste Detection card that belongs to a different project used to load the new session in the main view but leave the Sidebar stuck on the old project — users lost their sense of which project the current session actually belonged to. `NAVIGATE_TO_RESULT` has been renamed to `NAVIGATE_TO_SESSION` and extended with required `projectId` + optional `messageId`; the reducer atomically updates `selectedProjectId` + `selectedSessionId` + `targetMessageId` while preserving search state (no more reset-and-rebuild via `SELECT_PROJECT`). All five cross-project callsites migrated. Backend `getRelatedSessions` / `getWasteSessions` queries now return `project_id`; `RelatedSession` / `WasteSession` types gained `projectId`.

## [1.9.1] - 2026-04-21

### Added

- **Database maintenance card** on the Storage page — shows live DB size and reclaimable space (`freelist_count × page_size` from live PRAGMA reads, never hard-coded) with a one-click "Compact database" button that runs `VACUUM` on demand. Copy on the card and inside the confirm banner spells out that compaction only reorganizes file structure and never deletes conversations, sessions, or messages.
- Two IPC handlers (`storage:db-stats` / `storage:compact`) exposing the maintenance surface to the renderer via invoke/handle + preload.

### Changed

- **Parser no longer unconditionally archives every JSONL line.** A `KNOWN_MESSAGE_TYPES` whitelist now decides whether `raw_json` survives: known types drop it (the parsed `content_json` is sufficient), unknown types keep it as a debug / future-re-parse fallback. This matches CLAUDE.md's "lenient parser: preserve raw JSON for unknown structures" intent — the previous implementation preserved everything, accumulating hundreds of megabytes of redundant rows on a typical install.
- Migration v17 clears legacy `message_archive` rows scoped by the v17 whitelist snapshot, so any unknown-type `raw_json` the old parser wrote survives the upgrade. The DB file itself does not shrink until the user triggers the new compact flow (pure SQLite semantics — DELETE frees pages, `VACUUM` reclaims them).
- **Removed automatic `VACUUM` at the end of `runMigrations`.** Startup `VACUUM` conflicted with the new user-triggered compaction UX and could block app launch 10-30 seconds on a 1 GB+ DB. Free pages now surface in the Storage maintenance card; compaction is a deliberate user action.

## [1.9.0] - 2026-04-21

### Added

- **Storage Management** — User-controlled disk usage for the local index database (`~/.ccrewind/index.db`). Reach it from the new database icon in the title bar.
  - Overview cards: DB size (including WAL / SHM sidecars), session / message / project counts, earliest-to-latest activity span.
  - Per-project breakdown with a size bar and a one-click "exclude this project" button, sorted by estimated bytes descending.
  - Collapsed advanced panel for date-range exclusion: project picker + two native date inputs with a debounced live preview of the affected counts.
  - Existing rules list with a per-rule remove button.
  - Unified confirm dialog: no typed confirmation, just an "I understand this is irreversible" checkbox (disabled until ticked). A red banner warns when the hit ratio exceeds 50 %. Backdrop / buttons / checkbox freeze during apply and the button label swaps to "刪除中..." — prevents double-submit.
  - Four new IPC handlers (`storage:overview` / `preview` / `apply` / `remove-rule`) expose the DB layer to the renderer via invoke/handle + preload. `storage:overview` aggregates stats + project breakdown + inactive sessions + rules in a single round-trip.

- **Indexer skip for rule-matched sessions** — The indexer now reads active exclusion rules once per run and skips new sessions that match. Prevents re-importing the JSONL-backed sessions that `applyExclusion` just hard-deleted. Skip only applies to new (unindexed) sessions — already-indexed rows keep their normal mtime-driven update behaviour.
  - `readFirstTimestamp` scans the full JSONL to find the first timestamped line, matching `parser.parseSession.startedAt` semantics so the skip decision lines up with what `applyExclusion` used to delete. Files over 64 MiB are treated as "timestamp unknown" (DoS guard) and fall back to the full parse path.
  - `matchesExclusionRule` normalises timestamps to UTC via `new Date → toISOString().substring(0,10)` so offset-bearing inputs (e.g. `2024-07-01T00:30:00+08:00`) agree with SQLite's `DATE()` normalisation; invalid timestamps conservatively return false.

- **Storage Management DB layer** (infrastructure for the above): `exclusion_rules` table (migration v16) with composite project + date range rules, nullable columns, and `CHECK` ensuring at least one non-null criterion. Database methods cover storage stats, per-project breakdown, inactive session detection, exclusion rule CRUD, preview (aggregate-only, no ID materialization), and apply (hard delete + FTS sync + CASCADE + best-effort `VACUUM` within a single atomic transaction). Session-to-date mapping uses first message timestamp (conservative: cross-day sessions stay with their start day). `applyExclusion` returns `vacuumed: boolean` so a post-commit `VACUUM` failure does not mislead callers into retrying an already-deleted operation.

### Security

- **IPC apply-token handshake** — `storage:apply` no longer accepts an exclusion rule directly. Each `storage:preview` issues a one-time UUID bound to the parsed rule (60-second TTL, single-slot, one-time consume); `apply` requires that token and rejects unknown / expired / re-used values. Closes a renderer trust-boundary gap where a compromised renderer (XSS, injected devtools script) could otherwise bypass the UI checkbox and hard-delete arbitrary rules.

### Changed

- **DB schema**: migration v16 adds `exclusion_rules` table with `project_id` FK and `idx_exclusion_project` index.
- `getDbBytes` now sums `-wal` and `-shm` sidecar files for accurate WAL-mode disk usage reporting.
- Exclusion rule input hardening: rejects empty/whitespace criteria, enforces `YYYY-MM-DD` date format, and validates `thresholdDays` as a non-negative integer — preventing SQL comparison bypasses (`DATE(started_at) >= ''` or `DATE('bad-input')` returning `NULL`) that could cause mass accidental deletion.
- Internal: `chunkedIn` helper centralises 500-row `IN (...)` batching across exclusion-related queries; FTS5 `sessions_fts` rowid deletion extracted to `deleteSessionsFromFts` helper.
- Renderer API: `applyExclusion` signature changes from `(rule)` to `(applyToken)` to match the handshake.

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
