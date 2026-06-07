# Changelog

[English](CHANGELOG_EN.md)

本檔案記錄此專案所有重要變更。

格式遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，版本號遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)。

## [Unreleased]

### Added

- **Attribution 歸因追蹤（migration v21）**。Parser 從 JSONL 頂層提取 `attributionSkill`、`attributionPlugin`、`attributionMcpServer`、`attributionMcpTool`、`attributionAgent` 五個欄位，寫入 `messages` 表。可追溯每條 AI 回覆使用了哪個 skill、plugin 或 MCP 工具——「這段回答是用 context7 MCP + Explore agent 生成的」這類考古線索。所有欄位附 ≤512 字元長度 guard，對齊既有 uuid/requestId 防護模式。
- **Image block 偵測 + base64 剝離**。`parseContent` 新增 `case 'image'`，訊息含圖片時 `hasImage` 標記為 true。`contentJson` 序列化前精確剝除 `source.type === 'base64'` 的 image block data（替換為 `[base64-stripped]`），保留 block 結構（type、media_type）供 UI 未來做 placeholder。防止截圖貼圖導致 SQLite DB 膨脹。
- **API error 結構化解析**。`system` 訊息新增 `system_subtype` 欄位存儲（≤128 字元 guard）；`subtype === 'api_error'` 時提取 `error.status`（HTTP status code，如 529 overloaded）存入 `api_error_status`。為 degradation detection 提供一手資料：可 SQL 查詢「過去 7 天 529 錯誤出現幾次」。
- **Edited file 追蹤（attachment 解析）**。Parser 從 `attachment.type === 'edited_text_file'` 提取 `filename`（≤4096 字元 guard），Summarizer 的 `extractFileEvents` 整合為 `operation: 'edit'` 事件，自動計入 `session_files` 和 `filesTouched`。已知行為：同一檔案可能同時有 tool_use Edit 和 edited_text_file attachment，聚合後 count 會多算，不影響功能正確性。

### Changed

- **`SUMMARY_VERSION` 3 → 4**（隨 migration v21）。**升級後第一次 Sync 會 reparse 所有 sessions**，用來填入新欄位（attribution、hasImage、systemSubtype、apiErrorStatus）並補充 edited_text_file 的 session_files 事件。一次性副作用，後續同步走正常增量。
- **`extractFileEvents` 結構重構**。從 `continue` early-return 改為 `if` block，讓 `editedFilePath` 檢查不被 tool_use guard 跳過。純邏輯等價重構，無行為變化（除了新增 editedFilePath 事件）。

## [1.15.0] - 2026-05-26

### Added

- **Session 星號標記**（`2e2d5dd`）。Session 列表支援星號標記：hover 顯示 ☆ 按鈕，點擊切換 ★ 標記，搭配 ★ filter 按鈕只看加星的 session。獨立 `session_stars` 表（migration v20，無 FK），reindex 不會洗掉星號；optimistic update + rollback 確保 UI 即時回饋。支援 a11y（`aria-pressed`、`aria-label`）與 i18n（繁中＋英）。

## [1.14.0] - 2026-05-21

### Added

- **Session ID Chip 一鍵複製**（`a0e0b3e`）。ChatView toolbar 加 sessionId chip：顯示前 8 碼縮寫 + 點擊複製完整 UUID + 1.5s 視覺 flash + SR announcement。回放某段對話時要把 sessionId 帶到外部工具（grep、`claude --resume`、issue 回報）的高頻動作，從「展開 dev tools 找 selector」降到「一點」。
- **Tool error 偵測基礎建設（migration v19）**（`7c862e3`、`f804ce1`）。`messages` 表新增 `tool_error_count` 欄位（NOT NULL DEFAULT 0），parser 在 ingest 時統計每則 message 中 `is_error: true` 的 tool_result block 數量，供後續 degradation detection（Phase D）使用。此版**不上 UI**，是純基建：跨專案盤點顯示 34.2% sessions 含 `is_error`，是判斷「Claude Code 改一次就過 vs. 連續錯卡住」的最直接訊號之一，但 v1 不上面板，等 Phase D 真實資料才設計呈現方式。
- **Renovate + Electron smoke workflow**（`bf7e8f8`、PR #20）。`.github/renovate.json` 配 ADR-003 五條 packageRules（Electron stack dashboard / TypeScript 拉出 / safe patch automerge / minor manual / GitHub Actions），新增 mac+win matrix `electron-smoke.yml` 跑 `pnpm dist` 驗 native binding（better-sqlite3 ABI）。`packageManager` 鎖死 `pnpm@10.20.0`，CI 從 `pnpm/action-setup` 拿掉 `with: version` 避免雙寫衝突。詳見 `docs/ADR-003-dependency-upgrade-tool.md`。

### Fixed

- **搜尋結果 group header 顯示日期**（`f7fb897`）。`SearchResults` / `SessionSearchResults` 的 group header 從 `formatTime`（HH:MM）改用 `formatDateTime`（MM/DD HH:MM），跨日搜尋結果不再只看到時間分不清哪一天。個別 match timestamp 維持 HH:MM，因 group header 已 cover 日期，保持單列排版簡潔。
- **Summarizer 跳過 slash-command wrapper messages**（`20a8c91`）。`/command args` 形式的 user 輸入會在 JSONL 裡先被包成一個 wrapper user message（content 為 `<command-name>` XML），真正的 prompt 在下一筆。intent extraction 原本抓 first user message 結果常常拿到空殼。新版偵測並跳過這類 wrapper，往下找真正的 intent。

### Changed

- **`SUMMARY_VERSION` 2 → 3**（隨 migration v19）。**升級到 v1.14.0 後第一次按 Sync 會 reparse 所有 sessions**（實測 1104 sessions / 約 55 萬 messages 需 30–60 秒），用來 backfill `tool_error_count` 欄位。一次性副作用，後續同步走正常增量。

### Docs

- **ADR-003 + PLAN.md Task 11**（`908de19`）。Renovate vs Dependabot 決策過程、5 條 packageRules 設計依據、Electron smoke 必要性論證寫成 ADR-003；PLAN.md 加 Task 11 紀錄落地步驟。

## [1.13.0] - 2026-05-14

### Added

- **Tasks Panel：把 session 內的 TODO 歷史端到 ChatView 上**（`8c9b44b`）。Claude Code 透過 `TaskCreate` / `TaskUpdate` 把每個 session 的待辦寫進 `~/.claude/tasks/{sessionId}/*.json`，這是「AI 在這段對話裡規劃了哪幾步、卡在哪」最直接的證據，但介面上原本看不到。新增 Tasks Panel 緊接 SubagentPanel 渲染：subject、三態 status 徽章（pending / in_progress / completed），blockedBy 依賴用 chip 呈現。
  - 後端 pipeline：`migration v18` 新增 `session_tasks` 表，採 `(session_id, task_id)` composite PK **且刻意不掛 FK**——把任務歷史與 session reindex 的 delete/reinsert cycle 解耦，這樣排除規則刪掉某 session 後重建，不會順手把任務歷史一起洗掉
  - `scanner.scanTasks` 讀 `~/.claude/tasks/{sessionId}/*.json`（跳過 `.lock`）；`task-parser.parseTaskFile` 驗 id/subject/status 並 coerce arrays；`indexer.runTaskScanning` 在 subagent phase 之後跑，採 per-file mtime diff 的 append-mode（snapshot-only，不追歷史變更）
  - IPC `session:tasks` + `getSessionTasks` ElectronAPI，i18n zh-TW + en 同步
  - Code review + security audit 補修兩件事：高優先（Codex）——`runTaskScanning` 現在跳過 DB 裡不存在的 session，避免排除規則刪掉的 session 累積 orphan task rows；中優先（security）——task JSON 加 1MB size cap，防 symlink 或超大檔吃光記憶體
  - 新增 16 個 regression tests（parser + scanner），總計 445/445 通過

## [1.12.2] - 2026-05-07

### Fixed

- **JSONL parser 在出口統一 normalize 未配對 UTF-16 surrogate**（`dd357c8`、`cb81b84`）。Claude Code <2.1.132 的 tool error truncation 會切到 emoji codepoint 中間，在 JSONL 字串裡留下 lone surrogate（未配對的 high/low UTF-16 code unit）。新版 Claude Code 在 `--resume` 載入 session 時做 in-memory sanitize，但磁碟上的舊 session 檔仍含此資料。ccRewind 是這些檔案的純唯讀消費者：實測 better-sqlite3 在 INSERT 時會把 lone surrogate 替換成 U+FFFD（不會 crash）、`JSON.stringify` 也會輸出 ASCII escape `\uD83D` 形式，但下游 `JSON.parse(contentJson)` 會把 lone surrogate 還原，React 渲染與 exporter 寫檔時又得依賴 V8 的 fallback 行為——名實不符。新增 `ensureWellFormed(s)` helper 包裝 `String.prototype.toWellFormed()`（ES2024，Node 20+ native），並在 parser 出口的四個入口統一套用：`parseContent` 的 string 路徑、array text-block 路徑、`parseLine` 的 top-level `obj.content` 路徑（queue-operation 等）、以及 `JSON.stringify(message.content, replacer)` 的 string leaf——後者讓 `tool_result.content` 等巢狀 string 在序列化時就 normalize，下游 `JSON.parse` 還原時得到的是 well-formed string。下游 summarizer / FTS5 / UI / 匯出皆不再需要知道這個歷史髒資料問題。新增 9 個 regression tests（總計 429/429）。OWASP A03（input validation）。

## [1.12.1] - 2026-05-05

### Added

- **Token Budget 面板國際化**（`492bf2b`）。Token Budget 介面——六個圖表元件（`TokenSummaryCard`、`ContextGrowthChart`、`TokenBreakdown`、`CostHeatBar`、`InsightsPanel`、`TokenBudgetPanel`）加上 `insightEngine` 規則集——是最後一個寫死雙語的死角：每個 Insight 標題與內文原本都是靜態 zh-TW 字串，靠執行時 locale switch 切片。引擎現在回傳 `Insight`，帶有 discriminated-union 的 `data: InsightData`（7 種 insight 類型，加上 `SpikeCause` sub-union），完全 i18n-agnostic；UI 則透過小型 `insightMessages.ts` 對映層把 `InsightData → MessageKey`。新增 43 個 `tokenBudget.*` keys，zh-TW 與 en 透過 `satisfies MessageCatalog` 型別檢查保持同步。新增 `insightMessages.test.ts`，含 14 個樣本 × 2 locale 的 smoke test 加上 14 個對映正確性斷言；新增 insight 類型卻沒接 message key，現在會直接讓測試失敗，不再悄悄渲染空字串。

### Fixed

- **Token Budget plan detection——226K context 不再誤報為「113% of 200K」**（`768d95e`）。`assessContextLimit` 原本是一連串 `if` 沒做 plan detection：任何 200K 到 800K 之間的 `contextTotal` 都掉進 200K 分支，渲染出「Context at 113% of 200K limit (226.8K)」——這在物理上不可能，因為 200K-context 模型一開始就會拒絕超過 200K 的請求。能達到 226K，就證明這個 session 跑在 1M-context 模型上。新增 `detectContextPlan(turns)`：只要任何 observed `contextTotal` 超過 200K 就回傳 `'1m'`，否則 `'200k'`；`assessContextLimit` 依此挑對應 threshold band；`ContextGrowthChart` 的 reference-line toggle 預設用偵測到的 plan，讓圖表與 Insights 面板保持一致。前置條件（假設一個 session 只有一種 plan-class——目前架構成立，因為 subagent turns 走獨立 JSONL 檔，session 中途跨 plan `/model` 切換也很少見）已在 inline comment 文檔化。新增 5 個 regression tests，包含原始截圖案例。

- **Token Budget 面板不再把 raw exception 文字洩漏到 UI**（`7f014fa`）。`TokenBudgetPanel` 的 catch path 把 IPC 失敗的 raw `e.message` 直接塞進可見的 `setError` state，可能讓內部訊息（檔案路徑、native module 錯誤、SQLite 原因）洩漏給終端使用者——但這個面板對使用者的承諾只是「無法載入 token 統計」。現在改為 fail closed：使用者看到通用的 i18n `tokenBudget.error.loadFailed` 訊息，底層錯誤只在 DEV builds 透過 `console.error` 記錄。OWASP A09 + A10。

## [1.12.0] - 2026-05-04

### Added

- **Dashboard 全 7 cards 國際化**（[#19](https://github.com/tznthou/ccRewind/pull/19)）。Dashboard 頁面——先前最後一個寫死 zh-TW 的介面——現在所有可見字串都透過 `MessageKey` catalog 驅動：card 標題、range 按鈕（7d / 30d / 90d / all）、trend toggle、project filter、empty states、chart aria-labels，以及約 50 個新的 `dashboard.*` keys。zh-TW 與 en 透過 `satisfies MessageCatalog` 型別檢查保持同步。配合 v1.10.0 的 sidebar/dialog/title-bar i18n，整個 UI 介面已全面雙語。

- **Visually-hidden 圖表資料摘要供螢幕閱讀器**（[#19](https://github.com/tznthou/ccRewind/pull/19)）。Recharts 元件（Pie、AreaChart、heatmap）外層用 `role="img"` 包起來時，原本會把可見的 legend 與 data values 對輔助技術隱藏——SR 使用者只聽到「Tool usage distribution pie chart」這種沒實際數字的通用標籤。每個圖表現在透過 `aria-describedby` 暴露一個 visually-hidden 描述：`DistributionPieChart` 列出每個 `{name}: {value} {unit}`、trend charts 摘要日期區間總計、`WorkPatternHeatmap` 列舉活躍時段。新增三個 `dashboard.aria.*` 摘要 keys（zh-TW + en 同步），加上 `.visuallyHidden` CSS helper。

- **Project Health 內聯可見圖例**（[#19](https://github.com/tznthou/ccRewind/pull/19)）。stacked bar 原本渲染五種 outcome 顏色卻沒有圖例——讀者得 hover 每個 segment 才知道 `#22c55e` 代表什麼。卡片現在在列表上方顯示水平圖例（committed / tested / in-progress / quick-qa / unknown），來源就是驅動 bar segments 與 `UnresolvedSessions` badges 的同一個 `outcomeColors.ts` 模組，所以顏色不會悄悄漂移。

- **六張 Dashboard cards 加上描述性副標**（[#19](https://github.com/tznthou/ccRewind/pull/19)）。每個 card 標題後面接一行 muted 字體的副標，說明這張卡測量什麼（例：Usage Trend 下面寫「Token consumption and session volume over time」）。讓首次使用者不用導覽就能看懂每張卡回答的問題。

### Changed

- **Outcome 推論升級——「in-progress」狀態現在看得到了**（[#18](https://github.com/tznthou/ccRewind/pull/18)）。summarizer 的 outcome classifier 原本把 53% 的 sessions 標成 `unknown`，因為它只看最後 5 條 raw messages、且 commit/test 偵測 regex 太窄。v2 擴充 regex 集合（更多 git-commit 與 test-runner 模式），新增 `ACTIVE_WORK_RE` 偵測「持續編輯但未 commit」的 sessions，最關鍵的是——切片改成「最後 5 條**含 tool use** 的 messages」，不再是「最後 5 條任意 messages」（後者經常是 thinking/explanation 尾巴）。對本地索引的實測影響：NULL 從 53.0% → **15.3%**，`in-progress` 變成可見類別占 37.3%（原本 0%），Project Health 的 stacked bars 現在真的會顯示原本設計要呈現的 work-in-progress segment。`SUMMARY_VERSION` 從 1 → 2，下次 index scan 時舊 sessions 會自動 backfill；不需要 schema 變更。

- **「Waste Detection」更名為「Unresolved Sessions」**（[#19](https://github.com/tznthou/ccRewind/pull/19)）。原名暗示使用者判斷（「你浪費時間在這上面」）；新名描述資料（「沒達到明確結果的 sessions」）。重命名只動前端——IPC channel `stats:waste` 與邊界上的 `WasteSession` type 刻意保留，避免風險高的跨 process 遷移。兩個名字的不對稱已文檔化，且只存在於 IPC seam。

### Fixed

- **Project filter 的 aria-label 改為描述控制元件本身，而非預設選項**（[#19](https://github.com/tznthou/ccRewind/pull/19)）。`<select>` 原本用 `aria-label={t('dashboard.filter.allProjects')}`（渲染為「All projects」/ 「全部專案」），這是選項文字——所以螢幕閱讀器會唸「All projects, combo box, All projects」，完全沒提到這個控制元件做什麼。新增 `dashboard.filter.label` key（「Filter by project」/「依專案篩選」）描述用途；選項文字 key 不變。

- **Outcome 顏色集中管理避免悄悄漂移**（[#19](https://github.com/tznthou/ccRewind/pull/19)）。`ProjectHealth` 與 `UnresolvedSessions` 原本各自定義 `OUTCOME_COLORS` map——而且值已經有微小不一致（`UnresolvedSessions` 缺 `committed` 與 `tested`）。兩者現在都從單一來源 `src/renderer/components/Dashboard/outcomeColors.ts` import，連同正規 `OUTCOME_KEYS` 順序、`DISTRIBUTION_KEY ↔ OutcomeKey` 雙向對映、以及 `resolveOutcomeColor` fallback helper。新增 10 個 invariant unit tests 守護契約。

## [1.11.0] - 2026-05-03

### Added

- **FTS5 search 空結果時的語法提示**（[#13](https://github.com/tznthou/ccRewind/pull/13)）。當搜尋查詢回傳零結果時，新的 `SearchSyntaxHints` 元件在 `SearchResults` 與 `SessionSearchResults` 的 empty states 內渲染四個 FTS5 syntax chips（exact phrase、prefix、`OR`、`NOT`）。在使用者最需要的當下，告訴他們查詢語言能做什麼，而不是把人晾在死路 empty page。

- **螢幕閱讀器播報用的 Live region**（[#15](https://github.com/tznthou/ccRewind/pull/15)）。新增全域 polite live region，向螢幕閱讀器播報動態結果：搜尋完成（含結果筆數與 session group 數）、空結果、手動「Sync now」完成。新的 `LiveRegion` 元件用 `<span key={seq}>` 強制 remount，讓相同訊息在重複觸發時也會重新播報（否則 SR 會忽略重複文字）。`AppContext` 加入 `ANNOUNCE` action 與單調遞增的 `searchSeqRef` guard，防止快速點擊 filter 按鈕時 stale async 結果播報錯誤筆數。

### Changed

- **BREAKING——授權從 AGPL-3.0 改為 GPL-3.0-or-later。** GPL 更適合唯讀桌面應用；AGPL 的 network clause 對非 SaaS 應用沒有實際效果，反而可能誤導使用者對部署模式的理解。`LICENSE` 換成 GPL v3 文本；`package.json` 改用該 SPDX identifier；兩版 README 的 license badge 與章節同步更新。

- **README features 重組。** 27 條個別 feature 列重組為 5 個可折疊的 `<details>` blocks（Browsing & Search 與 Token & Context 預設展開；Statistics & Archaeology、Data & Storage、UI & Interaction 預設折疊）。Project Structure tree 也用 `<details>` 包起來降低視覺重量。DB Compaction（1.9.1 的功能）補進 Features——兩種語言版本原本都漏了。

- **英文版 README 與中文版對齊。** Core Concept 擴充結構化 rule engine 細節（intent + action + outcome）與 three-signal tag inference。Features 補上原本缺的 File Reverse Index、Token Insights、Token Heat Indicators 列。Architecture mermaid 圖加上 Summary Engine 節點。tech stack 表格與 project structure tree 的測試數同步 342 → 345。

### Fixed

- **icon-only / badge UI 的 tooltip 完整性**（[#14](https://github.com/tznthou/ccRewind/pull/14)）。兩個遺漏的 accessible labels：`FileHistoryDrawer` 關閉按鈕現在用既有 `common.close` key 的 `aria-label` + `title`；`SubagentPanel` agentType breadcrumb badge 新增 `chatView.subagent.typeBadgeTitle` key（zh-TW + en），讓螢幕閱讀器與 hover tooltip 都能播報這個 badge 代表什麼。

- **螢幕閱讀器播報區分 searchError 與 searchEmpty**（[#16](https://github.com/tznthou/ccRewind/pull/16)）。`SearchBar.executeSearch` 的 catch path 重複使用 `announceResult(type, 0, 0, q)`，會走 `count===0` 分支播報「No results found」——跟真正的空結果分不出來。SR 使用者沒有訊號判斷該重新措辭（沒命中）還是重試（IPC 暫時錯誤）。新增 `a11y.announcement.searchError` key（zh-TW + en），現在直接從 catch path dispatch。

- **ThemeSwitcher ARIA radio 鍵盤模式**（[#17](https://github.com/tznthou/ccRewind/pull/17)）。`ThemeSwitcher` 用了 `role="radiogroup"` + `role="radio"` 卻沒有鍵盤支援——方向鍵沒反應，只有 Tab+Enter/Space 能用。跟 sibling `FontScaleSwitcher`（v1.10.0 加的）不一致，後者完整實作 WAI-ARIA radio 鍵盤模式。`ThemeSwitcher` 現在比照辦理：ArrowRight/Down → 下一個、ArrowLeft/Up → 上一個、Home → 第一個、End → 最後一個；roving tabIndex（只有 active radio 是 `tabIndex=0`）；focus 跟著選擇移動。

## [1.10.0] - 2026-05-02

### Added

- **國際化——繁體中文（zh-TW）與英文（en）UI 在地化**（[#9](https://github.com/tznthou/ccRewind/pull/9)）。整個 UI 介面——sidebar headers、titlebar tooltips、dialogs、錯誤訊息、ARIA labels、dashboard 文案——現在全部由型別安全的 `MessageKey` catalog 驅動，不再用寫死的 zh-TW 字串。title bar 新增 `LanguageSwitcher` 切換 locale；選擇會持久化到 `localStorage`，`<html lang>` 也會同步更新。預設 `zh-TW`；當 `localStorage` 不可用時 fallback 到 `zh-TW`。catalog 用 `satisfies Record<MessageKey, string>`，遺漏或過時的 key 會在嚴格的 `tsconfig.web.json` typecheck 失敗。

- **Sidebar 同步 UX——focus 觸發自動 reindex、手動「Sync now」、與過時標籤**（[#10](https://github.com/tznthou/ccRewind/pull/10)）。先前 ccRewind 只在啟動時索引；啟動後寫入 `~/.claude/projects/` 的新 sessions 直到下次重啟才會被看見。renderer 現在會在 BrowserWindow 重新取得 focus 時 reindex（in-flight Promise 會 de-duplicate，所以快速 focus-blur 循環不會把 indexer 操爆），sidebar header 暴露手動「Sync now」按鈕，並顯示「Last indexed Xs ago」標籤讓使用者知道目前畫面有多舊。內部把 `IndexerProgress`（`runIndexer` 跑作業期間使用）與 `IndexerStatus`（IPC 契約，多了 `lastIndexedAt`）拆開，讓 indexer 內部事件不被 UI 層概念污染。

- **Sidebar 各列表的方向鍵導航**（[#11](https://github.com/tznthou/ccRewind/pull/11)）。Project list、session list、message search results、session search results 現在都支援 `ArrowUp` / `ArrowDown` 鍵盤導航；從 search bar 按 `ArrowDown` 會把焦點交給第一筆結果。`ProjectList` 與 `SessionList` 在每次方向鍵按下時 dispatch selection；`SearchResults` 與 `SessionSearchResults` 方向鍵只移動 active highlight，`Enter` 才執行跨 context 導航（後者較重，不該每次按鍵都觸發）。實作用 `aria-activedescendant` 而不是 roving `tabIndex`，這樣虛擬化列表中 active row 在捲動時 unmount 也不會丟焦。

- **title bar 的字級切換器**（[#12](https://github.com/tznthou/ccRewind/pull/12)）。三個層級——normal（1.0×）、large（1.1×）、xlarge（1.25×）——透過 `:root` 上的 `--font-scale` CSS 變數縮放整個 UI 的 font-size tokens。選擇持久化到 `localStorage`，並透過同步的 `font-scale-init.js` 在 React mount 前讀取，避免 FOUC。只支援放大；曾考慮的 `0.9×` 縮小層級被否決，因為 `0.9 × 11px = 9.9px` 會讓最小的 font tokens 跌到舒適閱讀的標準以下，而這個功能的目標族群正是無障礙使用者。包含完整 ARIA radio 鍵盤模式（ArrowLeft/Right/Up/Down + Home/End + roving tabIndex + focus 跟選擇移動）。

## [1.9.3] - 2026-04-29

### Added

- **Assistant Markdown 與 Tool blocks 內的搜尋關鍵字 highlight**（[#6](https://github.com/tznthou/ccRewind/issues/6)）。先前只有 User messages 的命中詞會被 `<mark>` highlight；點擊落在 Assistant message 或 `tool_result`（grep/Read 輸出可能上千行）的搜尋結果，畫面會捲到對應 bubble，但讀者還是得自己找關鍵字。新的 `rehypeSearchHighlight` plugin 把 Markdown text nodes 內的命中詞包起來——包含 inline `code`（function 名 / 檔案路徑）——但刻意跳過 fenced `<pre><code>` blocks 以保留 highlight.js 的 token 結構。`ToolBlock` 現在對 `<pre>` 內容 memoize `highlightText`。當命中 mark 落在折疊的 `<details>` 中（`tool_result` 常見）時，block 會自動展開且 viewport 精準捲到第一個命中。

### Fixed

- **點擊搜尋結果不再隨機捲不到對應訊息。** `ChatView` 內 `useEffect` 的 race condition 讓首次點擊經常把 viewport 留在最頂端：search effect dispatch 了 `CLEAR_TARGET_MESSAGE`，又 retrigger sibling「scroll-to-top」effect（其 dependency array 含 `targetMessageId`），覆蓋掉 search scroll。reset effect 改用 `prevSessionIdRef`，只有真正 session 變更時才觸發；外層與內層 `requestAnimationFrame` callbacks 都在 cleanup 中取消，避免快速點擊下殘留 stale callbacks。

## [1.9.2] - 2026-04-21

### Fixed

- **跨專案導航現在會同步 Sidebar 的 project context**（[#3](https://github.com/tznthou/ccRewind/issues/3)）。點擊屬於不同專案的 Related Session、File History entry、session/message 搜尋結果或 Waste Detection card 時，主畫面會載入新 session，但 Sidebar 卻卡在舊專案——使用者搞不清楚目前 session 到底屬於哪個專案。`NAVIGATE_TO_RESULT` 改名為 `NAVIGATE_TO_SESSION`，並擴充必要 `projectId` + 選用 `messageId`；reducer 原子地更新 `selectedProjectId` + `selectedSessionId` + `targetMessageId`，同時保留搜尋狀態（不再透過 `SELECT_PROJECT` reset-and-rebuild）。五個跨專案 callsites 全部遷移。後端 `getRelatedSessions` / `getWasteSessions` 查詢現在回傳 `project_id`；`RelatedSession` / `WasteSession` types 多了 `projectId`。

## [1.9.1] - 2026-04-21

### Added

- Storage 頁面的**資料庫維護卡片**——顯示即時 DB 大小與可回收空間（從 live PRAGMA 讀取的 `freelist_count × page_size`，絕不寫死），加上一鍵「壓縮資料庫」按鈕，按需執行 `VACUUM`。卡片文案與確認 banner 內明確說明壓縮只是重組檔案結構，絕不會刪除任何對話、session 或 message。
- 兩個 IPC handlers（`storage:db-stats` / `storage:compact`），透過 invoke/handle + preload 把維護介面暴露給 renderer。

### Changed

- **Parser 不再無條件封存每一行 JSONL。** 新的 `KNOWN_MESSAGE_TYPES` whitelist 決定 `raw_json` 是否保留：known types 丟掉（解析後的 `content_json` 已足夠），unknown types 留著當 debug / 未來重新解析的 fallback。這符合 CLAUDE.md 的「lenient parser：preserve raw JSON for unknown structures」意圖——先前的實作什麼都保留，在典型安裝下累積數百 MB 冗餘列。
- Migration v17 依 v17 whitelist snapshot 清理 legacy `message_archive` 列，所以舊 parser 寫入的 unknown-type `raw_json` 在升級後仍會保留。DB 檔案本身不會在使用者觸發新的 compact flow 之前縮小（純 SQLite 語意——DELETE 釋放 pages，`VACUUM` 才回收）。
- **拿掉 `runMigrations` 結尾的自動 `VACUUM`。** 啟動時 `VACUUM` 與新的「使用者觸發壓縮」UX 衝突，且 1 GB+ 的 DB 可能阻塞 app 啟動 10-30 秒。free pages 現在浮現在 Storage 維護卡片上；壓縮是使用者刻意的動作。

## [1.9.0] - 2026-04-21

### Added

- **Storage Management**——使用者可控的本機索引資料庫（`~/.ccrewind/index.db`）磁碟用量管理。從 title bar 新的資料庫圖示進入。
  - Overview cards：DB 大小（含 WAL / SHM sidecars）、session / message / project 數量、最早到最新活動跨度。
  - 每專案明細，含 size bar 與一鍵「排除此專案」按鈕，依估算 bytes 降序排序。
  - 折疊的進階面板支援 date-range 排除：project picker + 兩個原生 date inputs，含 debounced 即時預覽影響筆數。
  - 既有規則列表，每規則一個移除按鈕。
  - 統一的確認對話框：不要打字確認，只要勾「我了解這不可逆」checkbox（未勾選前按鈕停用）。命中比超過 50% 時紅色 banner 警示。執行期間背景 / 按鈕 / checkbox 全凍結，按鈕文字切為「刪除中...」——防止重複送出。
  - 四個新 IPC handlers（`storage:overview` / `preview` / `apply` / `remove-rule`），透過 invoke/handle + preload 把 DB layer 暴露給 renderer。`storage:overview` 用單一 round-trip 聚合 stats + project breakdown + inactive sessions + rules。

- **Indexer 對 rule-matched sessions 的 skip**——indexer 現在每次執行讀取一次 active 排除規則，跳過符合的 new sessions。防止 `applyExclusion` 剛 hard-delete 的 JSONL-backed sessions 又被重新匯入。skip 只對 new（未索引）sessions 生效——已索引的列維持正常 mtime-driven 更新行為。
  - `readFirstTimestamp` 掃描整個 JSONL 找第一條帶 timestamp 的 line，跟 `parser.parseSession.startedAt` 語意一致，所以 skip 決策跟 `applyExclusion` 過去刪除的對齊。超過 64 MiB 的檔案視為「timestamp unknown」（DoS guard），fallback 到完整 parse 路徑。
  - `matchesExclusionRule` 把 timestamps 透過 `new Date → toISOString().substring(0,10)` 正規化為 UTC，所以帶 offset 的輸入（例：`2024-07-01T00:30:00+08:00`）會跟 SQLite 的 `DATE()` 正規化一致；無效 timestamps 保守地回 false。

- **Storage Management DB layer**（上述功能的 infra）：`exclusion_rules` table（migration v16），含複合 project + date range 規則、nullable 欄位、`CHECK` 確保至少一個非 null 條件。Database 方法涵蓋 storage stats、per-project breakdown、inactive session detection、exclusion rule CRUD、preview（只聚合，不 materialize ID）、apply（hard delete + FTS sync + CASCADE + best-effort `VACUUM`，全部包在單一 atomic transaction）。Session-to-date 對映用第一條 message timestamp（保守：跨日 sessions 算在起始日）。`applyExclusion` 回傳 `vacuumed: boolean`，避免 post-commit `VACUUM` 失敗誤導 callers 重試已刪除的操作。

### Security

- **IPC apply-token handshake**——`storage:apply` 不再直接接受 exclusion rule。每次 `storage:preview` 發行一個一次性 UUID 綁定到解析後的 rule（60 秒 TTL、單槽、單次消費）；`apply` 必須帶這個 token，未知 / 過期 / 重複使用都會拒絕。封住 renderer 信任邊界的漏洞——若 renderer 被攻陷（XSS、注入 devtools script），原本可繞過 UI checkbox 直接 hard-delete 任意規則。

### Changed

- **DB schema**：migration v16 新增 `exclusion_rules` table，含 `project_id` FK 與 `idx_exclusion_project` index。
- `getDbBytes` 現在加總 `-wal` 與 `-shm` sidecar 檔案，正確回報 WAL-mode 磁碟用量。
- Exclusion rule input 強化：拒絕 empty/whitespace 條件、強制 `YYYY-MM-DD` 日期格式、驗證 `thresholdDays` 為非負整數——防止 SQL 比對繞過（`DATE(started_at) >= ''` 或 `DATE('bad-input')` 回傳 `NULL`），可能導致大規模誤刪。
- 內部：`chunkedIn` helper 集中處理 exclusion 相關查詢的 500 列 `IN (...)` 批次；FTS5 `sessions_fts` rowid 刪除抽取為 `deleteSessionsFromFts` helper。
- Renderer API：`applyExclusion` signature 從 `(rule)` 改為 `(applyToken)` 配合 handshake。

## [1.8.0] - 2026-04-11

### Added

- **Subagent UI**——啟動 subagent 的 sessions 現在會在對話上方顯示可點擊的 chips（agent type + message 數）。點擊 chip 會進入該 subagent 的對話，breadcrumb bar（`← 回到主對話` + agent type badge）提供穩定的回退導航。breadcrumb 在 loading/error/empty states 都會持續存在，避免導航死路。

## [1.7.4] - 2026-04-11

### Fixed

- **Token heat gutter 在 Timeline/Terminal 主題下看不見**——heat gutter 用了寫死的 `rgba()` 值且 opacity 低（0.3），在深色與淺色背景下都不符合 WCAG 1.4.11 non-text contrast（3:1）。修法：換成 per-theme CSS 變數（`--color-heat-positive` / `--color-heat-negative`），用 `color-mix(in srgb)` 驅動，最低強度從 30% 拉到 65%。從 `inset box-shadow 3px` 改為 `border-left 4px`，視覺重量更明顯。
- **Timeline 雙 border 衝突**——Timeline 主題的 accent `border-left` 與 heat gutter `box-shadow` 疊成混亂的 6px 雙色帶。修法：accent border 現在用 `:not([data-heat])` selector，只在沒有 heat indicator 時才顯示。

### Added

- **Terminal heat glow**——Terminal 主題對 heat-indicated messages 加上 `box-shadow` 發光效果，給透明 bubbles 增添深度，配合復古未來感。

## [1.7.3] - 2026-04-11

### Fixed

- **標題與訊息中的系統 XML 雜訊**——Claude Code 會把系統 XML tags（`<local-command-caveat>`、`<task-notification>`、`<ide_opened_file>`、`<system-reminder>`）注入使用者 message 內容。這些原封不動存進 `contentText`，污染 session 標題與訊息顯示。修法：`stripSystemXml()` 在 JSONL parsing 時剝除已知系統 tags（whitelist-only），同時保留 command metadata（`<command-name>`、`<command-args>`）為 unwrapped plain text。原始資料完整保留在 `raw_json` 與 `content_json`。
- **UNWRAP_RE 跨 tag 不對稱**——unwrap command tags 的 regex 現在用 backreference（`\1`）強制開閉 tag 名對稱，防止錯誤匹配畸形 XML。

### Changed

- **DB schema**：migration v15 強制 sessions 與 subagent_sessions 全面重建索引，把系統 XML 剝除套用到所有現有 `contentText`。

## [1.7.2] - 2026-04-10

### Fixed

- **Token 統計約 2.3 倍膨脹**——Claude Code JSONL 把單一 API 回應切成多筆 `type:"assistant"` entries（每個 content block 一筆），每筆都帶相同的 `usage` 資料。ccRewind 把每筆獨立加總，input token 數膨脹約 2.3 倍。修法：indexer 內的 `deduplicateTokensByRequestId()` 把每個 `requestId` 內除最後一筆外的 token 欄位都 null 掉，每次 API call 只算一次。所有下游統計（Dashboard usage trend、efficiency trend、waste detection、project health、Token Budget panel）自動修正。
- **Subagent token 數沒重建索引**——Migration v14 也 invalidate `subagent_sessions.file_mtime`，確保 subagent transcripts 用修正後的 token dedup 邏輯重建索引。
- **`requestId` 長度 guard**——`requestId` 抽取加上 `length <= 128` 邊界驗證，跟既有 `uuid` guard 模式對齊。

### Changed

- **DB schema**：migration v14 強制 sessions 與 subagent_sessions 全面重建索引，套用 token dedup 修正。
- `ParsedLine` type 擴充 `requestId: string | null` 欄位用於 API request 識別。

## [1.7.1] - 2026-04-10

### Fixed

- **Critical：UUID self-dedup bug**——`getExistingUuids` 在 re-index 時匹配到 session 自己已索引過的 messages，造成所有 user/assistant messages 被悄悄丟棄。只有沒 UUID 的 messages（file-history-snapshot、queue-operation、permission-mode）倖存。根因：dedup query 在 `indexSession` 刪除舊 messages 之前跑，所以 session 自己的 UUIDs 跟自己 self-match。修法：dedup query 排除當前 session（`session_id != ?`）。Migration v13 強制全面 re-index，重建所有受影響 sessions。

## [1.7.0] - 2026-04-09

### Added

- **Active Time 計算**：session duration 現在同時顯示 active time（排除 >5 分鐘 idle 期間）與 wall-clock time，提供更有意義的實際工作時間衡量
  - Sidebar session 列表優先顯示 active time，wall-clock time 在不同時放在括號內
  - Dashboard work patterns 與 heatmap 的平均計算用 active time（`COALESCE(active_duration_seconds, duration_seconds)`）
- **Subagent 檔案掃描**：自動發現並索引 `<session>/subagents/*.jsonl` 目錄下的 subagent transcripts
  - 有 `*.meta.json` 時讀取 agent type metadata
  - Subagent sessions 存在獨立的 `subagent_sessions` table，有 parent-child 關聯
  - Subagent messages 透過既有 messages API 可查詢
  - 增量索引：未變更的 subagent 檔案在 re-index 時略過
  - Stale cleanup：disk 上檔案被刪除時，subagent entries 從 DB 移除
  - 新 IPC channel `session:subagents` 供前端存取

### Changed

- **DB schema**：migration v11 為 sessions 加 `active_duration_seconds` 欄位（INTEGER）；migration v12 建立 `subagent_sessions` table，FK 到 sessions
- 所有面向使用者的查詢（search、file history、analytics、waste detection、related sessions）透過集中的 `EXCLUDE_SUBAGENTS` predicate 排除 subagent sessions
- Subagent IDs 以 parent session 命名空間化（`parentSessionId/bareFilename`），防止跨 session 衝突
- Subagent metadata + content 寫入包在單一 transaction 內保證原子性
- `stats:usage` handler 把 `days` 參數鉗制在 [1, 365] 範圍以增強輸入安全

## [1.6.1] - 2026-04-09

### Fixed

- **Resumed session 去重**：透過 Claude Code 的 `/resume` 接續的 sessions 不再產生重複 messages——重播到新 JSONL 的 entries 透過 UUID 偵測並略過
- **Dedup 順序**：sessions 依檔案修改時間（升序）索引，確保原始 session 永遠先於 resumed copy 取得 UUID 所有權
- **空 replay sessions**：純 replay 的 JSONL 檔案（所有 messages 都已從原始 session 索引過）整檔略過，不再建立鬼魂 session entries
- **UUID 格式 guard**：受損 JSONL 的畸形 UUIDs（空、純空白、>128 字元）在 dedup 前正規化為 null

### Changed

- **DB schema**：migration v10 為 `messages` table 加 `uuid` 欄位與 index，啟用跨 session 去重；既有 sessions 升級時強制 re-index
- Dedup 邏輯在 indexer 層執行（在 summary/session_files 產生之前），所以所有 session-level 衍生資料都只反映實際儲存的 messages
- `docs/SPEC.md` 擴充 JSONL 格式說明：UUID 語意、assistant requestId chunking、user entry subtypes、subagent 目錄結構

## [1.6.0] - 2026-04-09

### Added

- **日期範圍 Filter**：搜尋結果可依時間範圍篩選（all / 7 days / 30 days / 90 days），透過 search bar 的快選按鈕
- **排序 Toggle**：搜尋結果可在相關性（FTS5 rank）與時序（最新優先）之間切換
- **Intent Text 搜尋**：session-level FTS5 index 現在包含 `intent_text` 欄位（Migration v9），可依 session intent/purpose 搜尋
- **搜尋結果含 Session 日期**：message 搜尋結果群組標頭與 session 搜尋結果現在顯示 session 開始日期
- **Outcome 狀態 Badge**：session 搜尋結果以 badge 顯示 outcome 狀態（committed / tested / in-progress / quick-qa）

### Changed

- FTS5 snippet 長度從 64 提升到 128 字元，搜尋結果預覽更豐富
- Search API（`search` / `searchSessions`）擴充 `SearchOptions` 參數，支援日期篩選與排序控制
- 日期範圍與排序 filter 變更會自動重跑當前查詢（不用再按 Enter）
- `renderSnippet` 抽取為共享 utility（`utils/renderSnippet.tsx`），消除 `SearchResults` 與 `SessionSearchResults` 之間的重複
- IPC 邊界對 `dateFrom`/`dateTo` 參數加上 ISO 日期格式驗證（`/^\d{4}-\d{2}-\d{2}$/`）
- `OutcomeStatus` 值用 `Set.has()` 在 runtime 驗證，而非裸 type assertion
- Pagination 排序加入穩定次鍵（`m.id DESC` / `s.rowid DESC`），防止重複/遺漏結果
- 日期比對用 SQLite `date()` 函數確保時區處理一致

## [1.5.0] - 2026-04-02

### Added

- **Efficiency Trend Chart**（Phase 4）：dashboard 上的每日 tokens-per-turn 趨勢線，可透過 Usage/Efficiency switch 與 Usage Trend 切換
  - `getEfficiencyTrend()` API：依 project filter 與日期範圍，每日聚合 `(total_input_tokens + total_output_tokens) / message_count`
- **Waste Detection**（Phase 4）：高 token 消耗但無生產力結果（無 commit/test）的 session 排行
  - `getWasteSessions()` API：篩選 `outcome_status NOT IN ('committed', 'tested')` 的 sessions，依 total tokens 降序排列
  - 點擊跳轉：點擊 waste entry 會 dispatch `SELECT_SESSION` + `SET_VIEW_MODE` 直接跳到 session 回放
- **Project Health Dashboard**（Phase 4）：取代 Project Activity ranking，提供更豐富的 per-project health cards
  - Outcome 分布 stacked bar（committed/tested/in-progress/quick-qa/unknown），含色彩編碼
  - 7 日趨勢箭頭比對近期 vs 前期 session 數
  - 每專案平均 tokens-per-turn 效率指標
  - `getProjectHealth()` API：單一 SQL 查詢用 `SUM(CASE WHEN ...)` 取得所有指標
- 新 API 的 IPC handles：`stats:efficiency`、`stats:waste`、`stats:project-health`
- IPC 數值參數驗證用 `Number.isFinite()`（拒絕 NaN/Infinity）

### Changed

- Dashboard 資料抓取改用 `Promise.allSettled` 而非 `Promise.all`——個別 API 失敗不再 cascade 影響其他 dashboard cards
- `loadData` 從 `useCallback` + 獨立 `useEffect` 重構為單一 `useEffect`，含適當 cancellation cleanup（修正快速 filter 變更時的 race condition）
- `WasteDetection` 元件從 `utils/formatTime.ts` import 共享 `formatDuration()`，不再有本地重複
- Initial project 載入拆成獨立呼叫（`getProjectStats` + `getProjectHealth`），防止互相阻塞

## [1.4.0] - 2026-04-01

### Added

- **Statistics Dashboard**（Phase 3.5-A）：跨 session 分析，透過 title bar toggle 按鈕進入
  - **Usage Trend**：雙軸 area chart 顯示每日 session 數與 token 消耗，含 7D/30D/90D/All range selector
  - **Project Activity**：依 session 數與 token 用量排序的專案排行，含比例 bar
  - **Tool Distribution**：donut pie chart 聚合所有 sessions 的 tool 用量（Read、Edit、Bash 等）
  - **Tag Distribution**：donut pie chart 顯示 tag 頻率（bug-fix、refactor、testing 等）
  - **Work Pattern Heatmap**：24 小時活動 heatmap，含平均 session duration 顯示
  - 專案 filter 下拉選單：所有 charts 都會回應專案選擇（除了 Project Activity，filter 時會隱藏）
- **跨 Session 考古 UI**（Phase 3.5-B）：以檔案為中心的導航與 session 探索
  - **File History Drawer**：滑入式 timeline 顯示動過某檔案的所有 sessions，含操作類型 badges（edit/write/read/discovery）與點擊跳轉
  - **Related Sessions Panel**：基於 Jaccard similarity 的推薦，位於 ChatView 底部，顯示共同檔案與匹配百分比
  - **File Chips**：ChatView toolbar 內的可展開檔案列表——點任何檔案就開啟它的跨 session 歷史
- `getUsageStats()` API：含 project filter 與日期範圍的每日 session 數與 token 聚合
- `getProjectStats()` API：依 session 數與總 token 排序的專案排行
- `getToolDistribution()` API：從 CSV-encoded `tools_used` 欄位聚合 tool 用量
- `getTagDistribution()` API：從 CSV-encoded `tags` 欄位聚合 tag 頻率
- `getWorkPatterns()` API：每小時 session histogram 與平均 duration
- `getRelatedSessions()` API：基於 `session_files` reverse index 的 Jaccard 係數相似度，批次查詢（無 N+1）
- 所有新 API 的 IPC handles：`files:history`、`files:session`、`session:related`、`stats:usage`、`stats:projects`、`stats:tools`、`stats:tags`、`stats:patterns`
- `DistributionPieChart` 可重用元件，做 donut charts 含可配置顏色與標籤
- `pathDisplay.ts` utility：跨平台 `basename()` 與 `lastSegment()`，給 renderer 用的安全路徑顯示
- AppContext 加 `ViewMode` state（`sessions` | `dashboard`），含 title bar toggle
- AppContext 加 `fileHistoryPath` state，給 app 層級 FileHistoryDrawer 管理用

### Changed

- ChatView toolbar 重組：export 按鈕包進 `toolbarActions` container，跟新的檔案 toggle 並列
- 所有 async `useEffect` hooks 都加入 cancellation flags 與 `.catch()` 錯誤處理，做 graceful degradation
- `getFileHistory()` 回傳型別統一為 `FileHistoryEntry` interface（原本是 inline 匿名型別）
- IPC 選用參數解析抽取為 `parseOptionalString()` helper（消除 4 處重複）

## [1.3.0] - 2026-03-31

### Added

- **結構化摘要引擎**（Phase 3-A）：session 摘要從原始文字截斷升級為基於模板生成，含三個元件：
  - **Intent extraction**：跳過問候/續接（「hey」、「ok」、「continue」），找第一條實質的使用者訊息作為 session intent
  - **Activity summary**：從 tool 使用統計生成（例：「Edit×8, 5 files」）
  - **Outcome 推論**：兩層系統——觀察到的訊號（`gitCommitInvoked`、`testCommandRan`、`endedWithEdits`）餵進推論狀態（`committed`/`tested`/`in-progress`/`quick-qa`）；保守：只在高信心時才標記
- **多訊號 tag engine**：從 8 條 regex 規則擴充為 20+ 文字模式，加上路徑推論（`.css` → ui、`test/` → testing）、tool 模式推論（大量 Read + 少量 Edit → code-review）、與 outcome tags
- **Session files reverse index**（Phase 3-B）：`session_files(session_id, file_path, operation, count, first_seen_seq, last_seen_seq)` table，操作類型分為 mutation 與 discovery（read/edit/write 為 mutation，grep/glob 為 discovery）
- `getFileHistory(filePath)` API：reverse lookup——哪些 sessions 動過某檔案，依時間排序
- `getSessionFiles(sessionId)` API：forward lookup——某 session 操作了哪些檔案，含操作類型
- 噪音路徑過濾：`node_modules/`、`.git/`、`dist/`、`build/`、`.next/`、`.cache/`、`.vite/`、`coverage/` 排除在檔案索引之外
- Sidebar 顯示 session duration（`12m`、`1h30m`）
- Sidebar 顯示 outcome 狀態 badge，含色彩編碼 tags（committed=綠、tested=藍、in-progress=黃、quick-qa=紫）
- `summary_version` 欄位用於安全的規則迭代與 backfill 追蹤
- `formatDuration()` utility 用於人類可讀的時長格式

### Changed

- **DB schema**：migration v8 為 `sessions` table 加 `intent_text`、`outcome_status`、`outcome_signals`、`duration_seconds`、`summary_version`；建立 `session_files` table 含複合 primary key 與 path/session indexes
- Session 列表標題現在顯示 `intentText`（智慧抽取）而非原始 `title`（粗暴截斷），intent 為空時 fallback 到 `title`
- 既有 sessions 升級時強制 re-index（migration v8 清空 `file_mtime`）以填入新欄位
- `summarizeSession()` 回傳型別從扁平的 `SessionSummary` 改為 `{ summary, sessionFiles }`，同時產出 reverse index 資料
- `filesTouched` 上限從 20 提升到 30 筆
- Outcome 推論在 quick-qa 檢查之前先評估具體訊號（commit/test），防止短但有產出的 sessions 被誤分類

## [1.2.0] - 2026-03-31

### Added

- **Token Insights Engine**（Phase 2.6）：自動解讀 Token Budget 圖表的啟發式規則，把原始資料轉為可行動的洞察
- `insightEngine.ts`：5 條 insight 規則——Context Spike 偵測、Context Limit 警告、Cache Efficiency 評估、Output Hot Spot 偵測、Growth Rate 分析
- `InsightsPanel` 元件：含嚴重度色彩編碼的 insight 列表（critical/warning/info/good），3+ insights 時可展開/折疊
- Insights 整合進 TokenBudgetPanel 的 CostHeatBar 下方

### Changed

- **Roadmap 重組**（PHASE-2-3.md）：Phase 4（cross-session archaeology）拆分並提前到 v1.3.0–v1.4.0；auto-updater 延後到 v1.5.0+ 待 code signing 完成

## [1.1.0] - 2026-03-31

### Added

- **Context Budget 視覺化**（Phase 2.5）：每個 session 的 token 用量追蹤與圖表
- Parser 從 JSONL 抽取 `message.usage` 欄位（input_tokens、output_tokens、cache_read_input_tokens、cache_creation_input_tokens、model）
- `getSessionTokenStats` IPC API 回傳每 turn token 拆解，含 cache 命中率與 model 分布
- TokenBudgetPanel：ChatView toolbar 的可展開面板，含 toggle 按鈕
- TokenSummaryCard：4 格網格顯示 Total Input、Total Output、Cache Hit Rate、Model(s)，多 model 時顯示百分比
- ContextGrowthChart：recharts stacked area chart（New Input / Cache Creation / Cache Read），含 200K/1M context limit 參考線 toggle
- TokenBreakdown：donut pie chart 顯示 Cache Read / Cache Creation / New Input / Output 四種 token 類型比例
- CostHeatBar：水平 heat bar 視覺化每 turn output token 強度，sessions >200 turns 時自動 binning
- TokenHeatGutter：assistant message bubbles 上的 inset box-shadow heat indicator——cache 命中好為綠、context delta 高為紅
- Session 列表 token badge：訊息數旁顯示總 token 數（input + output）
- Session 列表排序 toggle：可在 Time（預設）與 Tokens 排序切換
- 共享 `formatTokens()` utility 提供跨元件一致的 token 數字格式
- 共享 `TOKEN_COLORS` 與 `CHART_TOOLTIP_STYLE` 常數確保圖表視覺一致

### Changed

- **DB schema**：migration v7 為 `messages` table 加 `input_tokens`、`output_tokens`、`cache_read_tokens`、`cache_creation_tokens`、`model` 欄位；為 `sessions` table 加 `total_input_tokens`、`total_output_tokens`
- 既有 sessions 升級時強制 re-index（migration v7 清空 `file_mtime`）以填入 token 欄位
- ChatView toolbar 排版從 `flex-end` 改為 `space-between` 容納 Token Budget 按鈕
- database.ts 抽取 `MessageRow` type 與 `mapMessageRow()` helper，減少 `getMessages()` 與 `getMessageContext()` 的重複
- TokenBudgetPanel 排版：ContextGrowthChart 與 TokenBreakdown 在網格中並列顯示，CostHeatBar 在下方
- MessageBubble 接收解析後的 `HeatInfo` 而非完整 Map，提升 `memo` 穩定性

### Fixed

- FTS5 search query injection：內部雙引號現在會在外層包裝前 escape（`fts5QuoteIfNeeded`），對 `search()` 與 `searchSessions()` 一致套用
- IPC `message:context` range 參數鉗制在 [0, 10]，防止無上限 DB 掃描
- TokenBudgetPanel 優雅處理 IPC 錯誤，顯示錯誤狀態而非空白展開面板
- CostHeatBar：所有 turns output tokens 都是 0 時不再顯示假的 `max: 1`
- Token heat gutter 改用 inset `box-shadow` 而非 `border-left`，避免覆蓋主題特定的 assistant borders（timeline/terminal）
- TokenHeatGutter 與 CostHeatBar 把 `Math.max(...spread)` 換成 `reduce`，防止大 sessions 下 stack overflow

## [1.0.0] - 2026-03-30

### Added

- **Session 自動摘要**（Phase 2-1）：索引時生成的啟發式 session 摘要——intent/conclusion 文字、自動 tags（bug-fix、refactor、testing、deployment、auth、ui、docs、config）、touched 檔案、與 tool 用量統計
- **搜尋上下文預覽**（Phase 2-2）：每筆搜尋結果的可展開 ▸ 按鈕，顯示命中前後各 2 條訊息，透過 `getMessageContext()` API 按需載入
- **Session 級搜尋**（Phase 2-3）：新「標籤/檔案」搜尋模式，透過專屬 `sessions_fts` FTS5 index 查詢 session 標題、tags、檔案路徑、與摘要文字
- SearchBar 加搜尋類型 toggle：可在「對話」（訊息內容）與「標籤/檔案」（session metadata）切換
- `SessionSearchResults` 元件用於 session 級搜尋顯示，含 tag badges
- Session 列表現在顯示 auto-tags（最多 3 個）與每 session 檔案數

### Changed

- **DB schema**：migration v5 為 `sessions` table 加 `summary_text`、`tags`、`files_touched`、`tools_used` 欄位；migration v6 加 `sessions_fts` FTS5 virtual table
- Session 列表項目高度從 56px 提升到 80px 容納 tag row
- 既有 sessions 升級時強制 re-index（migration v5 清空 `file_mtime`）以填入摘要欄位
- FTS5 session 搜尋對含 `/`、`.`、`-`、`\` 的查詢自動加引號，符合 tokenizer 相容性

### Fixed

- 搜尋結果 context 預覽用 `useRef` 做 cache，避免不必要的 re-render
- `indexSession()` 用 `lastInsertRowid` 替代多餘的 SELECT 做 FTS5 同步
- 檔案數 badge 在 `filesTouched` 達到 20 上限時顯示「20+」
- Session tags 與檔案數即使只有一個也會顯示（不再受 tags 是否存在閘控）

## [0.9.1] - 2026-03-30

### Added

- Windows build 支援：release pipeline 加入 NSIS installer + ZIP
- DB migration 後自動 VACUUM 回收磁碟空間
- 平台特定 artifact 命名（`mac-`/`win-` 前綴）

## [0.9.0] - 2026-03-30

### Added

- DB migration 系統：`schema_version` table 加自動 migration runner
- 搜尋分頁：每頁 30 筆結果，含「Load More」按鈕
- 搜尋結果按 session 群組：可折疊的 session groups，含 match count badges
- 已封存 sessions：disk 上 JSONL 檔被刪除的 sessions 在 DB 內保留為「已封存」，不永久刪除
- `message_content` 與 `message_archive` 側表用於資料保存

### Changed

- **Breaking（DB schema）**：`messages` table 為了搜尋效能拆成 3 個 tables——`content_json` 移到 `message_content`、`raw_json` 移到 `message_archive`。既有 DB 啟動時自動 migrate（大型 DB 約 60-90 秒）
- FTS5 snippet context 從 32 tokens 擴充到 64 tokens
- FTS5 snippet 分隔符從 `<mark>` HTML 改為 Unicode Private Use Area sentinels（U+E000/U+E001），防止索引內容含字面 `<mark>` 字串時的 UI glitch
- `removeStaleSessionsExcept()` 改名為 `archiveStaleSessionsExcept()`——設定 `archived=1` 而非刪除
- Search API 回傳 `SearchPage`（含 `results`、`offset`、`hasMore`）而非扁平 `SearchResult[]`
- 搜尋 scope 在分頁間保留（修正「Load More」用錯 project filter 的 bug）

### Fixed

- 已封存 sessions 在 JSONL 檔案重新出現時正確 re-index（即使 mtime 未變）
- Migration v1 用 `INSERT OR IGNORE` 防止部分 migration 復原時 UNIQUE 衝突
- Search `limit` 硬上限 100 作為 defense-in-depth
- IPC search query 長度限制 500 字元
- 折疊的搜尋群組在新查詢時 reset

## [0.8.0] - 2026-03-29

### Added

- 透過 highlight.js `atom-one-dark` 主題的程式碼 syntax highlighting
- Local 字型打包：6 個字族（7 個 woff2 檔案，約 402 KB）隨 app 出貨——完全離線，不依賴 Google Fonts CDN

### Changed

- CSP 強化：從 `style-src` 與 `font-src` 移除 `fonts.googleapis.com` 與 `fonts.gstatic.com`
- 移除 Timeline 主題 font stack 中的鬼魂 `Geist Mono`（從未實際打包）
- `highlight.js` 從 transitive 提升為直接相依

## [0.6.0] - 2026-03-29

### Added

- GitHub Release 更新檢查：app 啟動時偵測新版本並在 sidebar 顯示通知 banner
- 更新 banner 含「下載」（開啟 GitHub Release 頁）與「略過」（在當前 session 忽略）按鈕
- Terminal 主題特定樣式給更新 banner（outline 風格按鈕對比更佳）
- 版本比對 utility，用數值（非字典序）解析 semver
- GitHub API 回應的 runtime 型別驗證

## [0.5.2] - 2026-03-29

### Fixed

- 三個主題的色彩對比 WCAG AA 合規：
  - Timeline：`--color-text-muted` #94A3B8 → #6B7994（2.47:1 → 4.67:1）
  - Archive：`--color-text-muted` #9A8E7D → #706658（2.8:1 → 4.97:1）
  - Terminal：`--color-text-muted` #4A5068 → #9298AC（2.15:1 → 6.11:1）
  - Terminal：`--color-text-secondary` #7A8194 → #8D95A8
  - Terminal：`--color-border` #2E3140 → #3D4255（虛線分隔線更明顯）
- Focus 管理：搜尋跳轉現在會把 focus 移到目標訊息（`tabIndex={-1}` + `el.focus()`）
- `ProjectList.tsx` 的路徑寫死：把 `/Users/` 前綴換成跨平台 regex
- Search bar 缺 loading state：查詢期間 input 停用並顯示「搜尋中...」placeholder

## [0.4.0] - 2026-03-29

### Added

- 全文搜尋 UI：SearchBar 含 Enter 觸發搜尋、scope toggle（全部/當前專案）
- SearchResults 含 FTS5 snippet 預覽、點擊跳轉含 scroll + pulse 動畫
- MessageBubble 對使用者訊息的搜尋 highlight（`<mark>`）
- Markdown 匯出：session → `.md` 檔，含 metadata 表格、user/assistant 訊息、tool `<details>` blocks
- ChatView toolbar 加匯出按鈕，使用原生儲存對話框
- 動態 backtick fence（`makeFence`）做安全的程式碼區塊匯出
- macOS `hiddenInset` 視窗的 title bar 拖曳區

### Fixed

- 同 session 搜尋跳轉：effect 現在於 `targetMessageId` 變更時觸發（不只 `loading`）
- 搜尋排除非渲染訊息類型（`last-prompt`、`queue-operation`）
- 移除多餘的 `pendingScrollRef`，改直接用 `targetMessageId`

### Changed

- Exporter 每訊息抽取 tool blocks 一次（原本 parse 兩次：filter + render）

## [0.3.0] - 2026-03-29

### Added

- Sidebar 語意化標記（`<header>`、`<section>`、`<h1>`/`<h2>`、`aria-labelledby`）
- ToolBlock 鍵盤焦點樣式（`:focus-visible`）
- ToolBlock emoji 對螢幕閱讀器 `aria-hidden`
- 含對話氣泡 SVG 圖示的 placeholder empty state
- 透過 `session.webRequest.onHeadersReceived`（main process）的 production CSP
- 自動 `electron-rebuild` 的 `postinstall` hook
- electron-vite config 對 `better-sqlite3` 的 `rollupOptions.external`
- electron-builder config 對 `better-sqlite3` 的 `asarUnpack`

### Fixed

- 系統訊息色彩對比（`#856404` → `#664d03`，7.04:1 比例，WCAG AA）
- CSP `script-src 'self'` 阻擋 Vite dev server inline scripts
- `better-sqlite3` native module ABI 版本不符（NODE_MODULE_VERSION 127 vs 130）

### Changed

- `useSession` hook 從 4 次 `setState` 重構為單一 `useReducer` dispatch

## [0.2.0] - 2026-03-28

### Added

- Sidebar 元件含 project list、session list、indexer status（Task 5-6）
- ChatView 含 MessageBubble、ToolBlock、Markdown 渲染（Task 5-6）
- AppContext 用 `useReducer` 做全域狀態管理
- `useSession` 與 `useIndexerStatus` 自訂 hooks
- CSS module 樣式含 design token 系統（`global.css`）
- Rehype plugin pipeline 處理 syntax highlighting 與 sanitization

### Fixed

- Rehype plugin 順序：`rehypeSanitize` 在 `rehypeHighlight` 之前
- Indexer refetch 優化
- 3 個高嚴重度安全問題
- Render 階段 derived state 用於 loading reset

## [0.1.0] - 2026-03-27

### Added

- Electron + React + TypeScript + Vite 專案骨架（Task 1）
- JSONL 對話檔案的 Scanner + Parser 模組（Task 2）
- 含 better-sqlite3 的 Database + Indexer 模組（Task 3）
- 用 invoke/handle 模式的 IPC 通訊層（Task 4）
- Content Security Policy 與視窗安全強化
