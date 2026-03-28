# PRD.md — ccRewind

## 目標使用者

| 角色 | 需求 | 痛點 | 期望效益 |
|------|------|------|----------|
| Claude Code 重度使用者 | 回顧歷史對話、搜尋特定內容 | JSONL 無法直接閱讀、跨 session 搜尋困難 | 快速定位過去的決策脈絡與協作紀錄 |

## 使用者故事

### US-1: 專案切換

作為 Claude Code 使用者，
我想要看到所有專案的清單，
以便快速切換到我想回顧的專案。

驗收條件：
- Given `~/.claude/projects/` 下有多個專案資料夾 → When 啟動 ccRewind → Then 左側 Sidebar 列出所有專案，名稱為解碼後的路徑
- Given 專案資料夾名稱為 `-Users-tznthou-Documents-cube` → When 顯示於清單 → Then 顯示為 `~/Documents/cube`

### US-2: Session 清單

作為 Claude Code 使用者，
我想要看到某專案下所有歷史 session，
以便選擇想回顧的特定對話。

驗收條件：
- Given 選擇某專案 → When 載入 session 清單 → Then 按日期倒序排列，顯示日期與推導標題
- Given session JSONL 檔案存在 → When 推導標題 → Then 從第一筆 user 訊息或 queue-operation 擷取前 80 字作為標題
- Given 專案有 100+ sessions → When 顯示清單 → Then 使用虛擬捲動，不一次載入全部

### US-3: 對話閱讀

作為 Claude Code 使用者，
我想要以清楚的介面閱讀完整對話，
以便理解當時的協作脈絡。

驗收條件：
- Given 選擇某 session → When 載入對話 → Then 以 user/assistant 交替的氣泡式介面呈現
- Given assistant 訊息包含 tool_use → When 顯示該訊息 → Then tool_use 區塊預設摺疊，可點擊展開
- Given assistant 訊息包含 Markdown 格式 → When 顯示該訊息 → Then 正確渲染 Markdown（含程式碼高亮）
- Given user 訊息包含 tool_result → When 顯示該訊息 → Then tool_result 預設摺疊，可點擊展開

### US-4: 全文搜尋

作為 Claude Code 使用者，
我想要跨所有 session 搜尋關鍵字，
以便快速找到特定的對話內容。

驗收條件：
- Given 輸入搜尋關鍵字 → When 按下 Enter → Then 顯示匹配的 session 清單，含匹配片段預覽
- Given 搜尋結果中點擊某條目 → When 跳轉到該 session → Then 自動捲動到匹配位置並高亮關鍵字
- Given 搜尋範圍 → When 執行搜尋 → Then 可選擇搜尋全部專案或僅限目前專案

### US-5: Markdown 匯出

作為 Claude Code 使用者，
我想要將某次 session 匯出為 Markdown 檔案，
以便保存或分享。

驗收條件：
- Given 正在閱讀某 session → When 點擊匯出按鈕 → Then 產生 `.md` 檔案並開啟系統儲存對話框
- Given 匯出的對話包含 tool_use/tool_result → When 寫入 Markdown → Then 使用 `<details>` 標籤摺疊 tool 內容
- Given 匯出的 Markdown → When 開啟檢視 → Then 包含 session 標題、日期、專案名稱作為 metadata

## 功能需求

| 功能 | 描述 | 優先級 |
|------|------|--------|
| 專案掃描 | 掃描 `~/.claude/projects/` 列出所有專案 | P0 |
| Session 索引 | 解析 JSONL 建立 SQLite 索引（含 FTS5） | P0 |
| 對話閱讀器 | IDE 風格對話呈現，Markdown 渲染 + 程式碼高亮 | P0 |
| Tool 摺疊 | tool_use / tool_result 預設摺疊、可展開 | P0 |
| 全文搜尋 | SQLite FTS5 跨 session 搜尋 | P0 |
| Markdown 匯出 | 單一 session 匯出為 .md 檔案 | P1 |
| 虛擬捲動 | Session 清單和長對話的效能優化 | P1 |
| 增量索引 | 偵測新增 / 修改的 JSONL 自動更新索引 | P1 |
| 統計儀表板 | 對話頻率、tool 分佈、專案活躍度趨勢圖 | P2（Phase 2） |

## 非功能需求

| 項目 | 指標 |
|------|------|
| 首次索引效能 | 500 sessions 首次索引 < 30 秒，含進度回饋 |
| 搜尋效能 | FTS5 查詢回應 < 200ms |
| Session 載入 | 單一 session 載入並渲染 < 500ms |
| 記憶體使用 | 閒置時 < 150MB |
| 平台支援 | macOS（主要）、Linux / Windows（次要） |
| 資料安全 | 純唯讀，不修改 `~/.claude/` 下的任何檔案 |
