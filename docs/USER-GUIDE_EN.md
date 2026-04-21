# ccRewind User Guide

> Back to [README](../README_EN.md)

Detailed usage guide for each ccRewind feature. For a quick overview, see the Features table in the README.

---

## Session Summaries & Tags

Each session is analyzed at index time into a structured summary:

- **Intent extraction**: Skips greetings ("hey", "ok") and continuations ("continue", "go ahead") to find the first substantive user message as the session title
- **Activity summary**: Generated from tool usage stats (e.g. `Edit×8, 5 files`) so you can gauge the scope at a glance
- **Outcome inference**: Analyzes tool patterns in the final turns to classify the session — `committed` (git commit invoked), `tested` (test command ran), `in-progress` (still editing), `quick-qa` (brief Q&A)
- **Multi-signal tags**: Three-track inference — text regex (20+ rules), path heuristics (`.css` → ui, `test/` → testing), and tool patterns (heavy Read + light Edit → code-review)
- **Files touched**: Extracted from tool_use, tagged by operation type (read/edit/write vs. discovery), with noise paths like `node_modules/` filtered out automatically
- **Tool stats**: Usage frequency like `Read:15, Edit:8, Bash:5`

Outcome badges, tags, file counts, and session duration surface directly on each session list item — you can grasp the character and result of every session without opening it.

## Search

ccRewind offers two search modes, toggled via radio buttons next to the search bar:

- **Messages** (default): Searches message content. Results are grouped by session. Each result has a ▸ button that expands to show 2 surrounding messages as context preview, so you can judge relevance without navigating away
- **Tags/Files**: Searches session titles, tags, file paths, summaries, and intent. Great for queries like "which session touched auth.ts?" or "show all bug-fix sessions"

Below the search bar, filter controls let you narrow results:

- **Date range**: All / 7 days / 30 days / 90 days for quick temporal filtering
- **Sort order**: Relevance (FTS5 rank) or Newest first (chronological), auto-re-searches on change

Both modes support "All projects / Current project" scope filtering. Search result groups display the session date, and session search results show outcome status badges.

## Context Budget

Open any session and click **Show Token Budget** at the top of the conversation to expand the panel:

- **Summary cards**: Total Input / Total Output / Cache Hit Rate / Model(s); multi-model sessions show percentage splits
- **Context Growth area chart**: Per-turn stacked context size (New Input / Cache Creation / Cache Read), with togglable 200K / 1M reference lines
- **Token Breakdown pie chart**: Session-wide proportions of each token type
- **Output Intensity heat bar**: Per-turn output token intensity, making it easy to spot "which turn made Claude write the most"
- **Insights panel**: Automatically interprets the charts above — "is this good or bad, why, what should I do?" Detects context spikes and attributes them to specific tools, evaluates cache-hit efficiency, flags the most output-intensive turn, and analyzes growth between the first and second halves of the conversation

In the message list, each assistant bubble has a colored gutter on the left: green for good cache hits, red for turns that injected large amounts of new context (budget killers). You can spot expensive turns intuitively without expanding the panel.

Each session row in the sidebar shows the total token count (e.g. 1.2M), and clicking the **Tokens** button re-sorts the list by token consumption.

## Dashboard

Click the Dashboard icon (four-square grid) in the title bar to switch to the cross-session analytics view, which offers seven panels:

- **Usage / Efficiency Trend**: Dual-axis area chart (session count + token consumption), switchable to efficiency trend (daily average tokens/turn), with 7D / 30D / 90D / All range selection
- **Project Health**: Replaces the old project ranking — each project shows an outcome stacked bar (committed/tested/in-progress/quick-qa/unknown), a 7-day trend arrow, and average tokens/turn
- **Waste Detection**: Lists sessions with the highest token consumption but no commit or test outcome, showing intent, token count, duration, file count, and outcome badge. Click any entry to jump straight to its replay
- **Tool Usage / Tags**: Donut charts showing tool usage frequency and tag distribution respectively
- **Work Patterns**: 24-hour activity heatmap plus average session duration — your most productive hours at a glance

The project dropdown in the top-right filters all charts simultaneously to a specific project.

## Cross-Session Archaeology

Open any session and the toolbar shows a file-count button (e.g. `12 files ▾`). Expanding it lists every file this session operated on, color-coded by operation type (yellow = edit, green = write, blue = read, purple = discovery).

Click any file to slide out the **File History** drawer from the right, which timelines every session that touched that file. Click any entry to jump directly to that session.

At the bottom of the conversation, **Related Sessions** recommendations appear automatically — based on Jaccard similarity over file overlap, surfacing other sessions that modified the same files, with shared filenames and similarity percentages.

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
