# PLAN.md — ccRewind

## 實作策略

### Build Order

基礎層 → 資料層 → UI 層 → 功能層

先確保能正確解析 JSONL 並存入 SQLite，再建 UI 去呈現。搜尋和匯出是建立在資料層之上的功能，最後做。

```mermaid
graph LR
    T1[Task 1: 專案骨架] --> T2[Task 2: Scanner + Parser]
    T2 --> T3[Task 3: Database + Indexer]
    T3 --> T4[Task 4: IPC 通訊層]
    T4 --> T5[Task 5: Sidebar UI]
    T4 --> T6[Task 6: ChatView UI]
    T5 --> T7[Task 7: 全文搜尋]
    T6 --> T7
    T7 --> T8[Task 8: Markdown 匯出]
```

Task 5 和 Task 6 可平行開發。

### 測試策略

- 框架選型：Vitest
- 覆蓋率目標：行覆蓋率 ≥ 70%
- 命名慣例：test_<模組>_<功能>_<情境>_<預期>()

### 風險與回退

- JSONL content 結構比預期複雜 → Parser 採用寬容模式，未知結構保留 raw JSON 不中斷
- better-sqlite3 原生模組與 Electron 版本衝突 → 使用 electron-rebuild，或回退至 sql.js（純 WASM）
- 大量 session 首次索引卡頓 → Worker thread 非同步執行 + 進度條

---

## Task 清單

### Task 1: 專案骨架

**目標**：建立 Electron + React + TypeScript + Vite 專案結構，能跑出空白視窗

**影響範圍**：
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `electron-builder.yml`
- Create: `src/main/index.ts`
- Create: `src/renderer/App.tsx`
- Create: `src/renderer/index.html`
- Create: `src/shared/types.ts`

**依賴**：無

**驗收條件**：
- Given 專案已建立 → When `pnpm dev` → Then 開啟 Electron 視窗顯示 React 頁面
- Given 專案已建立 → When `pnpm build` → Then 成功打包無錯誤

**測試設計**：
- 正常：test_build_devMode_windowOpens
- 邊界：test_build_production_bundleCreated

**完成信號**：`pnpm dev` 開啟視窗 + `pnpm build` 成功

---

### Task 2: Scanner + Parser

**目標**：掃描 `~/.claude/projects/` 並解析 JSONL 為結構化資料

**影響範圍**：
- Create: `src/main/scanner.ts`
- Create: `src/main/parser.ts`
- Create: `src/shared/types.ts`（擴充 Project, SessionMeta, Message 型別）
- Test: `tests/scanner.test.ts`
- Test: `tests/parser.test.ts`
- Create: `tests/fixtures/sample.jsonl`（測試用範例資料）

**依賴**：Task 1

**驗收條件**：
- Given `~/.claude/projects/` 下有專案資料夾 → When 呼叫 scanner → Then 回傳專案清單含解碼後路徑
- Given JSONL 含 user/assistant/queue-operation/last-prompt → When 解析 → Then 正確分類並提取 content_text
- Given assistant content 為陣列含 text + tool_use blocks → When 解析 → Then text 累加為 content_text，tool_use 標記且記錄 tool name
- Given JSONL 某行格式錯誤 → When 解析 → Then 跳過該行繼續，不中斷

**測試設計**：
- 正常：test_scanner_validProjectDir_returnsProjectList
- 正常：test_parser_userMessage_extractsContentText
- 正常：test_parser_assistantWithToolUse_marksToolUseAndNames
- 邊界：test_scanner_emptyDir_returnsEmptyArray
- 邊界：test_parser_malformedJsonLine_skipsAndContinues
- 邊界：test_parser_contentAsString_handlesDirectly

**完成信號**：所有測試通過 + 能正確解析真實 JSONL 檔案的前 100 行

---

### Task 3: Database + Indexer

**目標**：建立 SQLite schema（含 FTS5），實作首次 / 增量索引

**影響範圍**：
- Create: `src/main/database.ts`
- Create: `src/main/indexer.ts`
- Test: `tests/database.test.ts`
- Test: `tests/indexer.test.ts`

**依賴**：Task 2

**驗收條件**：
- Given 首次啟動 → When indexer 執行 → Then 掃描所有 JSONL 寫入 SQLite，回報進度 0-100%
- Given 已建立索引 → When 有新增 JSONL → Then 增量索引僅處理新增/修改的檔案（比對 file_mtime）
- Given 已建立索引 → When FTS5 查詢某關鍵字 → Then 回傳匹配的 message id 清單

**測試設計**：
- 正常：test_database_createSchema_tablesExist
- 正常：test_indexer_firstRun_indexesAllSessions
- 正常：test_database_fts5Query_returnsMatches
- 邊界：test_indexer_incrementalRun_onlyNewFiles
- 邊界：test_indexer_emptyProject_handlesGracefully

**完成信號**：所有測試通過 + 能對測試 fixtures 建立索引並執行 FTS5 搜尋

---

### Task 4: IPC 通訊層

**目標**：建立 main ↔ renderer 的 IPC channel，實作 contextBridge

**影響範圍**：
- Create: `src/main/ipc-handlers.ts`
- Create: `src/main/preload.ts`
- Modify: `src/main/index.ts`（註冊 IPC handlers + preload）
- Modify: `src/shared/types.ts`（加入 IPC channel 型別）
- Test: `tests/ipc-handlers.test.ts`

**依賴**：Task 3

**驗收條件**：
- Given renderer 呼叫 `projects:list` → When main 處理 → Then 回傳資料庫中的專案清單
- Given renderer 呼叫 `session:load` → When main 處理 → Then 回傳該 session 的完整 Message 陣列
- Given indexer 執行中 → When 進度更新 → Then renderer 收到 `indexer:status` 事件

**測試設計**：
- 正常：test_ipc_projectsList_returnsList
- 正常：test_ipc_sessionLoad_returnsMessages
- 邊界：test_ipc_sessionLoad_invalidId_returnsEmpty

**完成信號**：所有測試通過 + renderer 能透過 IPC 取得資料

---

### Task 5: Sidebar UI

**目標**：專案選擇清單 + Session 清單，含虛擬捲動

**影響範圍**：
- Create: `src/renderer/components/Sidebar/ProjectList.tsx`
- Create: `src/renderer/components/Sidebar/SessionList.tsx`
- Create: `src/renderer/components/Sidebar/index.tsx`
- Create: `src/renderer/hooks/useProjects.ts`
- Create: `src/renderer/hooks/useSessions.ts`

**依賴**：Task 4

**驗收條件**：
- Given 應用程式啟動 → When 載入專案清單 → Then 左側 Sidebar 顯示所有專案名稱
- Given 點擊某專案 → When 載入 session 清單 → Then 顯示按日期倒序排列的 session 清單，含標題與日期
- Given 專案有 100+ sessions → When 捲動清單 → Then 使用虛擬捲動，UI 流暢不卡頓

**測試設計**：
- 正常：test_projectList_render_showsAllProjects
- 正常：test_sessionList_selectProject_showsSessions
- 邊界：test_sessionList_manyItems_virtualScrollWorks

**完成信號**：所有測試通過 + UI 可互動切換專案與 session

---

### Task 6: ChatView UI

**目標**：對話閱讀器，Markdown 渲染 + 程式碼高亮 + tool 摺疊

**影響範圍**：
- Create: `src/renderer/components/ChatView/index.tsx`
- Create: `src/renderer/components/ChatView/MessageBubble.tsx`
- Create: `src/renderer/components/ChatView/ToolBlock.tsx`
- Create: `src/renderer/components/ChatView/MarkdownRenderer.tsx`
- Create: `src/renderer/hooks/useSession.ts`

**依賴**：Task 4

**驗收條件**：
- Given 選擇某 session → When 載入 → Then 以 user（靠左）/ assistant（靠右）交替的氣泡呈現
- Given assistant 訊息含 tool_use → When 顯示 → Then 預設摺疊，顯示 tool 名稱，可點擊展開
- Given 訊息含 Markdown 程式碼區塊 → When 渲染 → Then 有語法高亮

**測試設計**：
- 正常：test_chatView_loadSession_rendersMessages
- 正常：test_toolBlock_collapsed_showsToolName
- 正常：test_toolBlock_expand_showsContent
- 邊界：test_chatView_emptySession_showsPlaceholder

**完成信號**：所有測試通過 + 能完整閱讀真實 session 對話

---

### Task 7: 全文搜尋

**目標**：搜尋列 + 結果清單 + 跳轉定位 + 高亮

**影響範圍**：
- Create: `src/renderer/components/SearchBar/index.tsx`
- Create: `src/renderer/components/SearchBar/SearchResults.tsx`
- Create: `src/renderer/hooks/useSearch.ts`
- Modify: `src/main/ipc-handlers.ts`（加入 search:query handler）
- Modify: `src/renderer/components/ChatView/index.tsx`（加入搜尋高亮與跳轉）

**依賴**：Task 5, Task 6

**驗收條件**：
- Given 輸入關鍵字 → When 搜尋 → Then 顯示匹配的 session 清單含片段預覽
- Given 點擊搜尋結果 → When 跳轉 → Then 載入該 session 並捲動到匹配位置，關鍵字高亮
- Given 搜尋範圍 → When 切換 → Then 可選全部專案或僅目前專案

**測試設計**：
- 正常：test_search_validQuery_returnsResults
- 正常：test_search_clickResult_jumpsToMatch
- 邊界：test_search_noMatch_showsEmptyState
- 邊界：test_search_specialChars_handlesGracefully

**完成信號**：所有測試通過 + 能搜尋到真實 session 中的內容並跳轉

---

### Task 8: Markdown 匯出

**目標**：將 session 匯出為 Markdown 檔案

**影響範圍**：
- Create: `src/main/exporter.ts`
- Modify: `src/main/ipc-handlers.ts`（加入 export:markdown handler）
- Modify: `src/renderer/components/ChatView/index.tsx`（加入匯出按鈕）
- Test: `tests/exporter.test.ts`

**依賴**：Task 6

**驗收條件**：
- Given 閱讀某 session → When 點擊匯出 → Then 開啟系統儲存對話框
- Given 匯出完成 → When 開啟 .md 檔案 → Then 包含 metadata（標題、日期、專案名）+ user/assistant 對話 + tool 以 `<details>` 摺疊
- Given session 含中文內容 → When 匯出 → Then UTF-8 編碼正確

**測試設計**：
- 正常：test_exporter_validSession_generatesMarkdown
- 正常：test_exporter_toolContent_wrappedInDetails
- 邊界：test_exporter_emptySession_handlesGracefully

**完成信號**：所有測試通過 + 匯出的 Markdown 在任何 Markdown viewer 中可正確閱讀

---

## 驗證計畫

### 冒煙測試清單

啟動後快速驗證（< 2 分鐘）：
- [ ] 應用程式啟動，顯示專案清單
- [ ] 選擇專案，顯示 session 清單
- [ ] 選擇 session，顯示完整對話
- [ ] 搜尋關鍵字，顯示結果並可跳轉
- [ ] 匯出 session 為 Markdown，檔案可正確開啟
