# ccRewind 使用說明

> 返回 [README](../README.md)

本文件詳細說明 ccRewind 各項功能的使用方式。功能一覽請見 README 的「功能特色」表格。

---

## Session 摘要與標籤

每個 Session 在索引時會自動產生結構化摘要：

- **意圖提取**：跳過 greeting（"hey"、"ok"）和 continuation（"continue"、"go ahead"），找到第一句實質內容作為 Session 標題
- **動作概要**：從工具使用統計生成（如 `Edit×8, 5 files`），一眼看出這次 session 的工作量
- **Outcome 推斷**：分析最後幾輪的工具模式，推斷 session 結果——`committed`（有 git commit）、`tested`（跑了測試）、`in-progress`（還在改）、`quick-qa`（快問快答）
- **多信號標籤**：三軌交叉推斷——文字 regex（20+ 條）、路徑推斷(改 `.css` → ui、改 `test/` → testing)、工具模式推斷（大量 Read + 少量 Edit → code-review）
- **涉及檔案**：從 tool_use 提取，區分操作類型（read/edit/write vs discovery），自動過濾 node_modules 等噪音路徑
- **工具統計**：顯示 `Read:15, Edit:8, Bash:5` 這類使用頻率

Outcome badge、標籤、檔案數、session 時長會直接顯示在 Session 列表項目上，不需要點進去就能掌握每個 Session 的性質和結果。

## 搜尋

ccRewind 提供兩種搜尋模式，在搜尋列右側的 radio 按鈕切換：

- **對話**（預設）：搜尋訊息內容，結果按 Session 分組。每筆結果左側有 ▸ 按鈕，點擊展開前後 2 則訊息的上下文預覽，不用跳轉就能判斷相關性
- **標籤/檔案**：搜尋 Session 的標題、標籤、涉及檔案路徑、摘要和意圖。適合「我上次改 auth.ts 是哪個 Session？」或「所有標記為 bug-fix 的對話」這類查詢

搜尋列下方提供篩選控制：

- **日期範圍**：不限 / 7 天 / 30 天 / 90 天，快速縮小搜尋範圍
- **排序方式**：相關性（FTS5 rank）或最新優先（時間倒序），切換後自動重新搜尋

兩種模式都支援「全部專案 / 目前專案」範圍篩選。搜尋結果群組顯示 Session 日期，Session 搜尋結果額外顯示 outcome 狀態 badge。

## Context Budget

進入任何 Session 後，點擊頂部 **Show Token Budget** 按鈕即可展開面板：

- **Summary Cards**：Total Input / Total Output / Cache Hit Rate / Model(s)，多模型 Session 會顯示各自佔比
- **Context Growth 面積圖**：逐 turn 的 context 大小堆疊圖（New Input / Cache Creation / Cache Read），可切換 200K / 1M 參考線
- **Token Breakdown 圓餅圖**：整個 Session 的 token 類型佔比
- **Output Intensity 熱力條**：每個 turn 的 output token 強度，快速辨識「哪個 turn 讓 Claude 寫最多東西」
- **Insights 洞察面板**：自動解讀上方圖表，告訴你「這數字好不好、為什麼、該怎麼做」——偵測 context spike 並歸因到具體 tool、評估 cache 命中效率、標記 output 最密集的 turn、分析前後半段成長趨勢

訊息列表中，每個 assistant 訊息左側會顯示色碼指示：綠色代表 cache 命中良好，紅色代表該 turn 灌入大量新 context（預算殺手），不用展開面板就能直覺發現高成本回合。

Session 列表的每筆項目旁顯示 token 總量（如 1.2M），並可點擊 **Tokens** 按鈕改為依 token 消耗量排序。

## 統計儀表板

點擊標題列的 Dashboard 圖示（四格方塊）切換到統計視圖，提供七個跨 Session 分析面板：

- **Usage / Efficiency Trend**：雙軸面積圖（session 數 + token 消耗），可切換為效率趨勢（每日平均 tokens/turn），支援 7D / 30D / 90D / All 切換
- **Project Health**：取代舊版專案排名，每個專案顯示 outcome 堆疊橫條（committed/tested/in-progress/quick-qa/unknown）、7 天趨勢箭頭、平均 tokens/turn
- **Waste Detection**：列出消耗最多 token 但無 commit/test 產出的 session，顯示意圖、token 數、時長、檔案數、outcome badge，點擊可直接跳轉回放
- **Tool Usage / Tags**：甜甜圈圓餅圖，分別顯示工具使用頻率和標籤分佈
- **Work Patterns**：24 小時活動熱力圖 + 平均 session 時長，一眼看出你的高產時段

右上角的下拉選單可以篩選特定專案，所有圖表同步更新。

## 跨 Session 考古

進入任何 Session 後，工具列會顯示檔案數按鈕（如 `12 files ▾`）。展開後顯示該 session 操作的所有檔案，以色碼標記操作類型（黃=edit、綠=write、藍=read、紫=discovery）。

點擊任一檔案會從右側滑出 **File History** 抽屜，以時間軸呈現該檔案在所有 session 中的操作歷史。點擊任一條目可直接跳轉到該 session。

對話底部會自動顯示 **Related Sessions** 推薦——基於檔案交集的 Jaccard 相似度計算，找出跟當前 session 改過相同檔案的其他 session，顯示共享檔案名和相似度百分比。

## 儲存管理

Claude Code 的原始 JSONL（`~/.claude/projects/`）有自己的定時清理機制，不需要我們擔心——ccRewind 是純唯讀應用，絕不碰你的原始資料。這裡管理的是 ccRewind **自己的索引資料庫**（`~/.ccrewind/index.db`），它會隨著 Claude Code 使用量成長。

點擊標題列的資料庫圖示（圓柱形）進入儲存管理頁：

- **總覽卡**：DB 大小（含 WAL/SHM sidecar）、Session / Message 數、專案數、最早到最新的活動時間範圍
- **專案佔用**：以視覺化 bar 呈現各專案相對容量，按大小降冪排序；每列附「排除此專案」一鍵按鈕
- **依日期範圍排除**：折疊的進階面板，可同時指定專案 + 起迄日期；選完條件下方即時預覽將刪除的 session / message 數量與 MB
- **現有規則清單**：列出所有排除規則，可隨時移除；規則被移除後 indexer 會在下次執行時重建對應的 session
- **統一確認對話框**：所有刪除操作走同一個 dialog——需勾「我了解此操作不可復原」checkbox 才啟用「確認刪除」按鈕；影響超過 50% 會多一條紅色警告 banner。**無需打字輸入**，全程選擇式操作；apply 期間 backdrop / 按鈕 / checkbox 全部 freeze，防雙擊
- **資料庫壓縮**（v1.9.1）：排除資料後，SQLite 的檔案不會立即縮小——被刪除的頁面以 free pages 形式保留在檔案內。當「可回收空間」超過閾值（10 MB）時，儲存頁會出現「壓縮資料庫」按鈕；確認後執行 `VACUUM` 重整檔案結構（典型耗時 10-30 秒）。UI 明確標示此操作**只整理檔案佈局，不會刪除任何對話、session 或 message**，避免「可回收」一詞被誤讀為「會被清除」

安全機制：IPC 層採 apply-token handshake——preview 時 main process 發出一次性 UUID token（60 秒 TTL），apply 只消費對應 token 而非任意 rule。即使 renderer 被 XSS 或 devtools script 操控，也無法繞過 UI 觸發刪除。

Indexer 讀取規則後會自動 skip 命中的 session（避免 JSONL 還在時被 re-index 重建），只影響新 session，已索引的仍維持原有 mtime 增量更新邏輯。
