# ccRewind — 功能演進路線圖

> 最後更新：2026-05-04
> 狀態標示：✅ 已交付 / 📋 遠期規劃 / 💤 Backlog

---

## 總覽

| Phase | 版本 | 狀態 | 主題 |
|-------|------|------|------|
| 1 | pre-release | ✅ | 基礎建設：表拆分、資料保全、分頁、分組 |
| 2 | pre-release | ✅ | Session heuristic 摘要、搜尋上下文預覽、scope 擴展 |
| 2.5 | v1.1.0 | ✅ | Context Budget 視覺化（token 成本透視） |
| 2.6 | v1.2.0 | ✅ | Token Insights Engine（圖表解讀層） |
| 3 | v1.3.0 | ✅ | 摘要品質升級 + 檔案反向索引 |
| 3.5 | v1.4.0 | ✅ | 統計儀表板 + 跨 Session 考古 UI（護城河版本） |
| 4 | v1.5.0 | ✅ | Dashboard 進階：效率趨勢、浪費偵測、專案健康度 |
| 4.5 | v1.6.0 | ✅ | 搜尋體驗強化：日期過濾、排序切換、intent_text、outcome badge |
| 5 | v1.7.0 / v1.7.2 | ✅ | Active Time + Subagent 索引 + requestId Token 去重 |
| 5.5 | v1.8.0 | ✅ | Subagent 前端 UI：chips 導覽 + breadcrumb |
| 6 | v1.9.0 / v1.9.1 | ✅ | 儲存管理 + DB 壓縮 |
| 7 | v1.10.0 | ✅ | i18n + 全面 a11y 升級：雙語 / 鍵盤導覽 / aria-live / sync UX |
| 7.5 | v1.11.0 | ✅ | a11y polish 收尾 + license relicense + README 雙版重組 |
| 7.6 | v1.12.0 | ✅ | Dashboard readability：i18n + a11y data exposure + visible legend + outcome inference v2 |
| — | — | 📋 | 資料壓縮功能（保留可還原） |
| — | — | 📋 | In-App 自動更新（待 Apple Developer ID code signing） |
| — | — | 💤 | 其餘見 Backlog |

---

## Phase 1 ✅ 基礎建設（pre-release）

表拆分（message_content / message_archive）、archived 機制、分頁、時間分組。

---

## Phase 2 ✅ Session 摘要與結構化搜尋（pre-release）

- **2-1. Heuristic 摘要**：截取首尾 user message、regex 標籤、tool 統計、files_touched
- **2-2. 搜尋上下文預覽**：搜尋結果顯示前後訊息 context
- **2-3. 搜尋 scope 擴展**：FTS5 索引涵蓋 title / tags / files_touched / summary_text

> Phase 3 已將此階段的 heuristic 摘要推上天花板，見下節。

---

## Phase 2.5 ✅ Context Budget 視覺化（v1.1.0）

**目標**：讓使用者一眼看出每個 session「token 花在哪、被誰吃掉」——context window 的成本透視鏡。

**為什麼插在 Phase 2 之後**：不依賴 LLM（Phase 3），只需解析 JSONL 已有的 `message.usage` 欄位。改動範圍明確（parser → schema → 前端圖表），可獨立交付。且圖表基礎建設（recharts）被 Phase 3.5 / 4 的統計儀表板復用。

**靈感來源**：[claude-code-organizer](https://github.com/mcpware/claude-code-organizer) 的 Context Budget 功能——顯示設定項目佔多少 token。我們做的是**對話層級**的 token 分析，定位不同。

> 詳細規格：[docs/CONTEXT-BUDGET-SPEC.md](CONTEXT-BUDGET-SPEC.md)

### 改動範圍

- **Parser** — `parseLine()` 從 `message.usage` 抽取 token 欄位
- **Types** — `ParsedLine` / `Message` 加 token + model 欄位
- **Migration v7** — messages 加 token 欄位、sessions 加彙總欄位
- **前端** — 新增 recharts、Context Budget 面板（面積圖 + 圓餅圖 + 成本熱力條）
- **IPC** — 新增 `getSessionTokenStats` API

---

## Phase 2.6 ✅ Token Insights Engine（v1.2.0）

**目標**：讓 Token Budget 面板從「展示數據」升級為「解讀數據」——用 heuristic 規則自動產生可行動的洞察，解答使用者的三個核心問題：「這數字好不好？」「為什麼？」「我該怎麼做？」

**為什麼插在這裡**：Phase 2.5 建好了圖表，但沒有解讀的圖表就是華而不實的圖形產生器。此功能零後端改動，用現有 `SessionTokenStats` 即可，是 Phase 2.5 的自然延伸。

### 5 條 Insight 規則

| # | 規則 | 觸發條件 | 輸出範例 |
|---|------|---------|---------|
| 1 | **Context Spike** | turn 間 input 增量 > 20K 或 > 1.5x | "Turn 23 context surged +45K — Bash returned large output" |
| 2 | **Context Limit** | 累積 context > 80% of limit | "Context at 82% (164K/200K) — approaching window limit" |
| 3 | **Cache Efficiency** | hit rate < 30% 或 > 70% | "Cache hit rate 78% — prompt caching working well" |
| 4 | **Output Hot Spot** | max output > 平均 * 3 | "Turn 15 generated most output (8.2K) using Edit, Write" |
| 5 | **Growth Rate** | turns > 10 且後半段增速 > 前半段 2x | "Context growth accelerated 3.2x in second half" |

### 設計原則

- **寧可少說不可多說**：預設顯示最重要的 3 條，超過可展開。中等值不出聲，只在極端值觸發
- **歸因到 tool level**：不過度猜測具體原因，標記是哪個 tool 相關
- **文案包含「所以呢」**：不只報數字（"78%"），還說代表什麼（"working well"）

---

## Phase 3 ✅ 摘要品質升級 + 檔案反向索引（v1.3.0）

**目標**：雙軌並行——(A) 把 heuristic 摘要推到天花板；(B) 建立檔案反向索引資料層，為跨 Session 考古打地基。

**為什麼合併**：摘要改良和檔案反向索引互不依賴，但都是「理解脈絡」的基礎設施。合併交付讓 v1.3.0 同時提升單 session 品質和跨 session 能力的資料基礎。

**為什麼不做 LLM**：ccRewind 屬 ccFamily 三件套，整體哲學為 rule-based + zero API cost。AI 跨 session 記憶需求已由姊妹專案 [ccRecall](https://github.com/tznthou/ccRecall) 承接（明確 No LLM dependency），ccRewind 自身專注把 heuristic 摘要推到天花板。

### 3-A. 結構化摘要引擎

- **Intent extraction**：跳過 greeting / continuation（"hey"、"ok"、"continue"），找出第一句有實質內容的 user message 作為 session intent
- **Activity summary**：從 tool 使用統計產生（例："Edit×8, 5 files"）
- **Outcome inference**：兩層推斷——observed signals（`gitCommitInvoked`、`testCommandRan`、`endedWithEdits`）推導出 inferred status（`committed` / `tested` / `in-progress` / `quick-qa`），高信心才標記
- **Multi-signal tags**：從 8 條 regex 擴充到 20+ 文字模式 + 路徑推斷（`.css` → ui、`test/` → testing）+ 工具模式推斷（重 Read 輕 Edit → code-review）+ outcome tags

### 3-B. 檔案反向索引（資料層）

- `session_files(session_id, file_path, operation, count, first_seen_seq, last_seen_seq)` 表
- operation 區分 mutation（read / edit / write）vs discovery（grep / glob）
- 噪音路徑過濾（`node_modules/` / `.git/` / `dist/` / `build/` / `.next/` / `.cache/` / `.vite/` / `coverage/`）
- 反向查詢 API：`getFileHistory(filePath)` / `getSessionFiles(sessionId)`
- **此版只做資料層，UI 在 Phase 3.5 交付**

---

## Phase 3.5 ✅ 統計儀表板 + 跨 Session 考古 UI（v1.4.0）

**目標**：雙軌並行——(A) 跨 session 使用統計視覺化；(B) 用 Phase 3 建好的反向索引，交付跨 Session 考古的 UI。

**為什麼合併**：統計儀表板和考古 UI 都是「跨 session 視角」，共享 recharts 基礎和 sidebar 導覽入口。合併交付讓 v1.4.0 成為 ccRewind 從 viewer 跳躍到考古工具的關鍵版本。

> 17+ 競品全部停在「看 log」層級，無人做「理解脈絡」。Phase 3.5 是真正建立護城河的版本。

### 3.5-A. 統計儀表板

- **Usage Trend**：雙軸面積圖（session 數 + token 消耗），7D / 30D / 90D / All 範圍切換
- **Project Activity**：按 session 數與 token 使用量排名的專案清單，含比例 bar
- **Tool Distribution**：全局工具使用比例甜甜圈圖（Read vs Edit vs Bash ...）
- **Tag Distribution**：標籤分佈甜甜圈圖（bug-fix / refactor / testing ...）
- **Work Pattern Heatmap**：24 小時活動熱力圖與平均 session 時長
- 專案 filter 下拉選單：所有圖表支援專案維度切換（Project Activity 於過濾時隱藏）

### 3.5-B. 跨 Session 考古 UI

- **File History Drawer**：點擊檔案滑出時間軸，顯示該檔案在哪些 session 被操作過 + operation badge
- **Related Sessions Panel**：基於 Jaccard 相似度（`session_files` 交集）的推薦，ChatView 底部顯示
- **File Chips**：ChatView toolbar 可展開的檔案清單，點擊跳進 File History Drawer

---

## Phase 4 ✅ Dashboard 進階功能（v1.5.0）

**目標**：為護城河版本（Phase 3.5）的 Dashboard 補上「解讀」層——從「展示分佈」升級為「指出問題」。

> ⚠️ 原 Phase 4 規劃為 In-App 自動更新，但因為 Dashboard 的解讀能力比自動更新更能拉開護城河距離，v1.5.0 實際交付 Dashboard 進階功能。自動更新下移至遠期規劃。

### 改動範圍

- **Efficiency Trend**：每日 tokens/turn 折線圖，可與 Usage Trend 透過 Usage/Efficiency 切換
- **Waste Detection**：高 token 但 `outcome_status NOT IN ('committed', 'tested')` 的 session 排行榜，點擊跳轉對話
- **Project Health**：outcome 分佈 stacked bar（committed / tested / in-progress / quick-qa / unknown）、7 天趨勢箭頭、平均 tokens/turn 效率指標
- Dashboard 資料抓取改用 `Promise.allSettled`，單 API 失敗不會拖垮整個頁面
- IPC 數值參數以 `Number.isFinite()` 驗證，拒絕 NaN / Infinity

---

## Phase 4.5 ✅ 搜尋體驗強化（v1.6.0）

**目標**：搜尋從「找得到」升級為「找得準」——加入時間與排序維度。

### 改動範圍

- **Date Range Filter**：搜尋結果可按時間範圍過濾（all / 7 天 / 30 天 / 90 天）快速切換
- **Sort Toggle**：FTS5 rank（相關性）與時間（最新優先）兩種排序
- **Intent Text Search**：session FTS5 加入 `intent_text` 欄位（migration v9），搜尋命中 session intent
- **Search Result Metadata**：訊息搜尋結果群組 header 與 session 搜尋結果顯示 session 起始日期；session 結果加上 outcome badge（committed / tested / in-progress / quick-qa）
- FTS5 snippet 長度從 64 拉到 128，預覽更豐富
- IPC 層 ISO 日期格式驗證（`/^\d{4}-\d{2}-\d{2}$/`），防止 SQL 比對繞過
- `renderSnippet` 抽到共用 utility，消除 `SearchResults` / `SessionSearchResults` 重複

---

## Phase 5 ✅ Active Time + Subagent 索引 + requestId Token 去重（v1.7.0 / v1.7.2）

**目標**：指標準確性大幅提升——時長要反映實際工作時間、subagent 要能索引、token 統計不能虛胖。

### 5-A. Active Time Calculation（v1.7.0）

- Session 時長優先顯示 active time（排除 >5 分鐘閒置），括號附註掛鐘時間
- Sidebar session 清單優先顯示 active time，與掛鐘時間不同時以括號顯示
- Dashboard 工作模式與熱力圖使用 active time 計算平均（`COALESCE(active_duration_seconds, duration_seconds)`）
- Migration v11 加入 `active_duration_seconds` 欄位

### 5-B. Subagent Indexing（v1.7.0）

- 自動掃描 `<session>/subagents/*.jsonl` 與 `*.meta.json`
- Subagent session 儲存於獨立 `subagent_sessions` 表（migration v12），parent-child linkage
- 增量索引：未變更的 subagent 檔案跳過；檔案刪除時清理 DB
- 新 IPC channel `session:subagents`
- 所有使用者查詢（search / file history / analytics / waste / related）透過 `EXCLUDE_SUBAGENTS` 排除 subagent，避免污染主視圖
- Subagent ID 以 `parentSessionId/bareFilename` 命名空間化，避免跨 session 撞名

### 5-C. requestId Token 去重（v1.7.2）

- **Bug**：Claude Code JSONL 把同一 API response 拆成多個 `type:"assistant"` entries（一個 content block 一個），每筆帶相同 `usage`，原本全部相加導致 input token 膨脹 ~2.3x
- **Fix**：`deduplicateTokensByRequestId()` 在 indexer 層把同一 `requestId` 的前 N-1 筆 token 欄位清零，最後一筆保留
- Migration v14 強制全 re-index（含 subagent），修正所有下游統計（Dashboard / Token Budget / Waste Detection / Project Health）
- `requestId` 萃取加入 `length <= 128` 邊界驗證，對齊既有 `uuid` guard

---

## Phase 5.5 ✅ Subagent 前端 UI（v1.8.0）

- 有 subagent 的 session 顯示可點擊 chips（agent type + 訊息數）於對話上方
- 點擊進入後以 breadcrumb bar（`← Back to parent` + agent type badge）導覽回 parent session
- Breadcrumb 在 loading / error / empty 狀態下都保持可見，避免導覽死結

---

## Phase 6 ✅ 儲存管理(v1.9.0 / v1.9.1)

**目標**：使用者能看見 DB 佔用分布、能主動釋放空間，且所有刪除操作都有不可繞過的確認機制。

### 6-A. Storage Management（v1.9.0）

- **Overview**：DB 大小（含 WAL / SHM sidecar）、session / message / project 數、最早至最新活動跨度
- **Project Breakdown**：每專案佔用 bar 與「排除此專案」一鍵鈕，依估算 bytes 降序
- **Date Range Exclusion**：專案 + 日期範圍規則（專案 picker + 兩個 native date input），含 debounced 預覽受影響 session 數
- **Exclusion Rules 管理**：現有規則清單與 per-rule 移除鈕
- **統一 Confirm Dialog**：checkbox 確認（取代打字確認），>50% 命中率顯示紅色警告 banner。Backdrop / buttons / checkbox 在 apply 期間凍結，按鈕文字切換為「刪除中...」防止 double-submit
- 4 個新 IPC handler：`storage:overview` / `preview` / `apply` / `remove-rule`

### 6-A2. IPC apply-token handshake（v1.9.0 Security）

- `storage:preview` 發放一次性 UUID（60 秒 TTL、單 slot、one-time consume），綁定已解析的 rule
- `storage:apply` 拒絕直接收 rule，必須帶合法 token，拒絕未知 / 過期 / 已用 token
- 防 renderer 信任邊界攻擊（XSS / 注入 devtools script 繞過 UI checkbox 硬刪任意規則）

### 6-A3. Indexer Skip（v1.9.0）

- Indexer 每次執行讀取 active exclusion rules 一次，符合規則的新 session 直接跳過
- 只對「新（未索引）session」生效，已索引的列維持 mtime-driven 更新行為
- 防止 `applyExclusion` 剛 hard delete 又被 JSONL 重新索引回來
- `readFirstTimestamp` 掃完整 JSONL 找第一個帶時間戳的行，對齊 `parser.parseSession.startedAt` 語義；>64 MiB 視為「timestamp unknown」fallback 到完整 parse（DoS guard）
- `matchesExclusionRule` 以 UTC (`toISOString().substring(0,10)`) 正規化時間戳，對齊 SQLite `DATE()` 的處理

### 6-B. Database Maintenance（v1.9.1）

- **Compact database** 按鈕：一鍵執行 `VACUUM`，文案明確說明「只重組檔案結構，不刪除對話 / session / 訊息」
- 顯示 live DB size 與可回收空間（`freelist_count × page_size` 即時 PRAGMA 讀取，不硬編碼）
- Parser 根據 `KNOWN_MESSAGE_TYPES` 白名單決定是否保留 `raw_json`——已知類型丟棄（`content_json` 已足夠），未知類型保留（debug / 未來 re-parse fallback）
- Migration v17 以 v17 白名單快照清理舊 `message_archive`，任何未知類型的 `raw_json` 仍會留下
- 移除啟動時自動 `VACUUM`（大型 DB 可能卡 10–30 秒），壓縮改為使用者主動觸發

---

## Phase 7 ✅ i18n + 全面 a11y 升級（v1.10.0）

**目標**：把使用者介面從「中文 only + 鍵盤盲區」推到「雙語（zh-TW + en）+ 完整 keyboard a11y + screen reader 友好 + 使用者主動控制 sync」。對應 D-1 ~ D-3 a11y / i18n 工作包。

### 7-A. Internationalization（D-2c, PR #9）

- 整個 UI surface——sidebar headers、titlebar tooltips、dialogs、error messages、ARIA labels、dashboard copy——由 type-safe `MessageKey` catalog 驅動，取代過去 hard-coded zh-TW 字串
- LanguageSwitcher 在 title bar 切換 locale，持久化於 localStorage，`<html lang>` 同步更新；預設 zh-TW，localStorage 不可用時 fallback 回 zh-TW
- `satisfies Record<MessageKey, string>` 嚴格模式：missing / stale keys 直接 fail strict `tsconfig.web.json` typecheck

### 7-B. Sidebar Sync UX(D-1.5, PR #10)

- 過去只在啟動時 index，啟動後寫入 `~/.claude/projects/` 的新 session 要等下次重啟才會看見
- Focus-driven auto-reindex：BrowserWindow 取得焦點時 reindex（in-flight Promise dedup 避免快速 focus-blur 把 indexer 操爛）
- 「Sync now」按鈕：使用者可主動觸發；「Last indexed Xs ago」label：使用者可看到資料新鮮度
- 內部 `IndexerProgress`（job 執行中事件）與 `IndexerStatus`（IPC contract，加 `lastIndexedAt`）切割，indexer 內部事件不混入 UI-layer 概念

### 7-C. Arrow Key Navigation(D-3a, PR #11)

- Project list、session list、message search results、session search results 全支援 ArrowUp / ArrowDown
- 從 search bar 按 ArrowDown 把焦點交給第一個結果
- ProjectList / SessionList：每按一下 dispatch selection；SearchResults / SessionSearchResults：只移動 active highlight，Enter 才 navigate（避免每次按鍵都觸發跨情境跳轉）
- 用 `aria-activedescendant`（不採 roving tabIndex）：virtualized list 在 scroll 時 active row unmount 不會丟焦點

### 7-D. Font Scale Switcher(D-3b, PR #12)

- 三檔 normal（1.0×）/ large（1.1×）/ xlarge（1.25×）透過 `--font-scale` CSS variable 縮放整個 UI 的 font-size tokens
- 持久化於 localStorage；synchronous `font-scale-init.js` 在 React mount 前讀取，防止 FOUC
- 只放大不縮小：0.9× tier 被拒（0.9 × 11px = 9.9px，最小 token 已低於 a11y 受眾的舒適閱讀界線）
- 完整 ARIA radio keyboard pattern（Arrow + Home / End + roving tabIndex + focus moves with selection）

---

## Phase 7.5 ✅ a11y polish + License relicense（v1.11.0）

**目標**：v1.10.0 a11y 主套之後的 polish 收尾——補 SR 動態通知、補 missing aria labels、修 keyboard pattern 一致性，並把 license 從 AGPL-3.0 改為更適合純桌面 app 的 GPL-3.0-or-later。

### 7.5-A. a11y polish 收尾

- **FTS5 empty state hints（D-2a, PR #13）**：搜尋無結果時顯示四個 FTS5 語法 chips（精確短語、前綴、`OR`、`NOT`），降低空結果挫敗感，引導使用者修正 query
- **Tooltip completeness（D-2b, PR #14）**：FileHistoryDrawer close button + SubagentPanel agentType breadcrumb badge 補 aria-label + title
- **Live region announcements（D-3c, PR #15）**：全域 polite live region 通知 SR 動態結果——搜尋完成、空結果、手動 sync 完成；`LiveRegion` 用 `<span key={seq}>` 強制 remount 讓 SR 重唸相同訊息；`AppContext` 加 `ANNOUNCE` action + monotonic `searchSeqRef` guard（防 stale async search resolution 覆蓋 visible UI 並 announce 錯計數）
- **searchError vs searchEmpty 區分（D-3c P1, PR #16）**：catch path 不再經過 announceResult 走 `count===0` 路徑（會與真 0 結果撞訊息），改 dispatch 新 `a11y.announcement.searchError` key
- **ThemeSwitcher ARIA radio keyboard pattern（D-3b follow-up, PR #17）**：與 v1.10.0 的 FontScaleSwitcher 保持一致，補 Arrow / Home / End + roving tabIndex

### 7.5-B. License relicense AGPL-3.0 → GPL-3.0-or-later

- AGPL 的 network clause 對純本地桌面 app 沒實質效力，反而誤導使用者以為是 SaaS。GPL 是桌面 copyleft 的標準選擇
- LICENSE 替換為 GPL v3 全文（35KB，從 GNU 官方）；`package.json` 加 `"license": "GPL-3.0-or-later"` SPDX field；README badge + license section 兩版同步

### 7.5-C. README 雙版重新檢視

- 27 列 features 表格 → 5 個 `<details>` 摺疊群組（瀏覽搜尋 / Token 預設展開，統計考古 / 資料儲存 / 介面互動預設摺疊）
- 補 v1.9.1 DB Compaction（之前兩版 Features 都漏）
- 英文版補強：File Reverse Index / Token Insights / Token Heat Indicators 三列 + Architecture mermaid Summary Engine 節點 + Core Concept structured rule engine + 三軌 tag inference 細節
- Project Structure 樹包 `<details>`（contributor 才需要看，預設隱藏）
- 雙版 Vitest test count 同步：342 → 345

---

## Phase 7.6 ✅ Dashboard readability + outcome inference v2（v1.12.0）

**目標**：v1.10.0 i18n 主套之後，Dashboard 是最後一個 hardcode-zh-TW 的介面；同時 summarizer 的 outcome 判定有 53% session 落入 `unknown`，使 Project Health 的「in-progress」分類在 stacked bar 上完全看不見。此版本一次處理兩個遺留——Dashboard 補上完整 i18n + a11y 觀察維度，並重寫 outcome inference 演算法讓 in-progress session 真正可見。

### 7.6-A. Dashboard readability pass（PR #19）

- **完整 i18n**：7 個 cards 的標題、subtitle、empty states、chart aria-labels、range buttons、trend toggle、project filter 全改 `t()`；新增 ~50 個 `dashboard.*` keys，zh-TW + en lockstep（`MessageCatalog satisfies` 編譯期強制）
- **6 個 cards 加 subtitle**：title 之下一行 muted 描述，第一次看 dashboard 的人不必猜每張卡在量什麼
- **ProjectHealth inline legend**：5 個 outcome 顏色 + 標籤直接顯示在 stacked bar 上方，不用 hover 才知道色塊代表什麼
- **WasteDetection → UnresolvedSessions rename**：原名暗示「使用者浪費時間」，新名只描述資料事實「沒走到明確結果的 sessions」。前端 only — IPC channel `stats:waste` + `WasteSession` type 在 boundary 保留以避 risky cross-process migration
- **outcomeColors 集中化**：`ProjectHealth` 跟 `UnresolvedSessions` 各自定 `OUTCOME_COLORS`（值還不完全一樣，後者缺 committed / tested）。集中到 `outcomeColors.ts` 後 stacked bar / badge / legend 不可能再漂色；補 10 個 invariant tests
- **a11y 補強**：card `<div>` → `<section>` + `aria-labelledby`、cardTitle → `<h2>`、recharts `role="img"` + 隨附 visually-hidden description（`<ul>` 列每筆 distribution / `<p>` 列 trend summary，透過 `aria-describedby` 串起來，SR 不再只聽到「Tool usage distribution pie chart」這種空殼）、UnresolvedSessions item Enter/Space 可活化
- **project filter aria-label 改用專屬 key**：原本 reuse option text「全部專案」，SR 唸「全部專案 combo box 全部專案」聽不出控制項用途；新 `dashboard.filter.label`「依專案篩選」/「Filter by project」描述用途

### 7.6-B. Outcome inference v2（PR #18）

- **問題**：v1 演算法用 `messages.slice(-5)` 只看最後 5 則訊息，且 commit / test regex 太窄，導致 53% session 卡在 `unknown`；Project Health 的 stacked bar 看起來只有 committed / tested 兩塊，「in-progress」分類完全消失
- **修正**：
  - `slice(-5)` → `filter(hasToolUse).slice(-5)`：跳過 thinking / explanation tail，看真正的 tool 操作 footprint（單獨貢獻 ~37pp NULL 下降）
  - 擴 `GIT_COMMIT_RE` / `TEST_COMMAND_RE`：補更多 git 與 test runner 變體
  - 新增 `ACTIVE_WORK_RE`：抓「活躍編輯但沒收尾」的 session 標 in-progress
- **效果**：本機 248 sessions 實測，NULL 53.0% → **15.3%**，in-progress 0% → 37.3%；Project Health 的「in-progress」段終於在 stacked bar 上看得到
- **upgrade path**：bump `SUMMARY_VERSION` 1 → 2，indexer 偵測到舊 version 自動 backfill，無 schema change，無需手動操作

---

## 遠期規劃 📋

### 資料壓縮功能（v1.10+）

> 補 exclusion 硬刪的絕對性：保留可還原的壓縮選項

exclusion 目前是不可逆 hard delete，未來希望多一條「壓縮但保留原始資料、可隨時還原」的路徑。設計細節待定（可能基於 SQLite 內部壓縮或 zstd blob）。

### In-App 自動更新（待 Apple Developer ID code signing）

**目標**：從「偵測新版 → 開瀏覽器下載」升級為「背景下載 → 提示安裝 → 重啟即完成」，消除手動更新的摩擦。

**為什麼沒排程**：auto-updater 是分發便利性，不是差異化能力。在沒有 Apple Developer ID（$99/年）的情況下，macOS 上 electron-updater 會 fallback 回手動下載，ROI 有限。護城河版本（Phase 3.5 / 4）優先。

**前提條件**：取得 Apple Developer ID code signing certificate。沒有簽名的 auto-updater 在 macOS 上無法正常運作。

**改動範圍**（預估）：

- `src/main/updater.ts` — 從 GitHub Release 通知改為 electron-updater（autoUpdater）
- `electron-builder.yml` — 加入 publish 設定（GitHub provider）
- `src/renderer/components/UpdateBanner/` — 升級 UI：下載進度 → 安裝提示 → 重啟按鈕
- 移除現有的手動偵測邏輯

---

## Backlog 💤（視需求排入）

| 項目 | 備註 |
|------|------|
| 匯出脫敏 | Markdown 匯出時遮蔽敏感路徑，claude-replay 已有類似功能 |
| 語意搜尋 | FTS5 夠用就不投入，可復用 BYOK 基礎設施 |
| 多 AI 工具支援 | 不符合「深度 > 廣度」定位，至少 v2.0 前不做 |
| Insights 圖表 Annotation | Phase 2.6 洞察延伸：spike 點在面積圖上用 ReferenceDot 標記 |
| Insights 跨 Session 基準 | 「此 session 在所有 session 中排名前 N%」（Phase 3.5 統計 API 已有，待 UI 整合） |

---

## 風險提醒

| 風險 | 緩解 |
|------|------|
| auto-updater code signing | macOS 需 code signing + Apple Developer ID ($99/年)；未取得前維持手動下載提示 |
| heuristic 改良有限 | 接受天花板存在；ccFamily rule-based + zero API cost 哲學下不切換 LLM 路線 |
| files_touched 解析不準 | tool_use 的 input JSON 格式可能變化，parser 要寬容 |
| 護城河侵蝕速度 | FTS5 + Token 視覺化技術門檻不高，競品可快速複製；Phase 3.5 / 4 / 6 的解讀層與體驗深度是主要護城河 |
| Insight / 統計規則噪音 | 觸發閾值寧高勿低，中等值不出聲；定期根據實際 session 資料校準閾值 |
| Exclusion 不可逆 | 統一 Confirm Dialog + IPC apply-token handshake 已阻擋誤刪；未來「資料壓縮功能」提供可還原備案 |
