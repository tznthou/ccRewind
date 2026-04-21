# ccRewind User Guide

> Back to [README](../README_EN.md)

Detailed usage guide for each ccRewind feature. For a quick overview, see the Features table in the README.

---

## Session Summaries & Tags

Each session is automatically analyzed at index time:

- **Intent summary**: Extracts the first and last user messages to show what the session was about at a glance
- **Auto-tags**: Inferred from conversation keywords, including `bug-fix`, `refactor`, `testing`, `deployment`, `auth`, `ui`, `docs`, `config`
- **Files touched**: Extracted from tool_use calls (Read/Edit/Write), shows which files were actually operated on
- **Tool stats**: Usage frequency like `Read:15, Edit:8, Bash:5`

Tags and file counts appear directly on each session list item. No need to open a session to understand what it covers.

## Search

ccRewind offers two search modes, toggled via radio buttons next to the search bar:

- **Messages** (default): Searches message content. Results are grouped by session. Each result has a ▸ button that expands to show 2 surrounding messages as context preview, so you can judge relevance without navigating away
- **Tags/Files**: Searches session titles, tags, file paths, summaries, and intent. Great for queries like "which session touched auth.ts?" or "show all bug-fix sessions"

Below the search bar, filter controls let you narrow results:

- **Date range**: All / 7 days / 30 days / 90 days for quick temporal filtering
- **Sort order**: Relevance (FTS5 rank) or Newest first (chronological), auto-re-searches on change

Both modes support "All projects / Current project" scope filtering. Search result groups display the session date, and session search results show outcome status badges.

## Storage Management

Claude Code has its own periodic cleanup for the raw JSONL under `~/.claude/projects/`, so you don't need to worry about those — ccRewind is a strictly read-only tool and never touches your source data. What this page manages is ccRewind's **own index database** at `~/.ccrewind/index.db`, which grows with your Claude Code usage.

Click the cylindrical database icon in the title bar to open the storage page:

- **Overview cards**: DB size (including WAL/SHM sidecars), counts of sessions / messages / projects, earliest-to-latest activity span
- **Project breakdown**: each project shown with a visual size bar sorted by bytes descending, with a one-click "Exclude this project" button per row
- **Date-range exclusion**: a collapsed advanced panel with a project picker plus two native date inputs; a debounced live preview shows the exact session / message / byte impact as you pick conditions
- **Existing rules**: listed with a per-rule remove button — removing a rule lets the indexer rebuild the matching sessions on the next run
- **Unified confirm dialog**: every destructive action funnels through the same dialog — a single "I understand this is irreversible" checkbox (nothing to type), a red banner when the hit ratio exceeds 50%, and backdrop/buttons/checkbox all frozen during apply to prevent double-submit
- **Database compaction** (v1.9.1): SQLite does not shrink the file on DELETE — removed rows become free pages inside the same file. When reclaimable space (live `freelist_count × page_size`) crosses 10 MB, a "Compact database" card appears on the storage page. Confirming runs `VACUUM` to reorganize the file layout (typically 10-30 s). The UI is emphatic that this operation **only reorganizes file structure and never deletes any conversation, session, or message** — closing the common misread of "reclaimable" as "about to be erased"

**Security**: `storage:apply` does not accept a rule directly. Each `storage:preview` issues a one-time UUID bound to the rule (60-second TTL, single-slot); `apply` can only consume that token. A compromised renderer (XSS, injected devtools script) cannot forge an apply call — it must first go through a preview issued by the main process.

The indexer reads active rules once per run and silently skips new sessions that match, so a hard-deleted session is not re-imported while its JSONL still sits on disk. Skip applies to new sessions only; already-indexed rows keep their normal mtime-driven update path.
