# ccRewind — 功能演進路線圖

> Phase 1 ✅：表拆分、資料保全、分頁、分組
> Phase 2 ✅：Session heuristic 摘要、搜尋上下文預覽、scope 擴展
> Phase 2.5 ✅：Context Budget 視覺化（token 成本透視）
> Phase 2.7 🔜：electron-updater 自動更新（v1.2.0）
> Phase 3 📋：摘要品質升級（heuristic 天花板）（v1.3.0）
> Phase 3.5 📋：統計儀表板（對話頻率、工具分佈、專案活躍度）（v1.4.0）
> Phase 4 📋：跨 Session 考古（檔案歷史、相關推薦、專案時間軸）（v2.0.0）
> 未定 📋：LLM 智慧摘要（待合規路徑明朗）

---

## Phase 1 ✅ 基礎建設

表拆分（message_content / message_archive）、archived 機制、分頁、時間分組。

## Phase 2 ✅ Session 摘要與結構化搜尋

- **2-1. Heuristic 摘要**：截取首尾 user message、regex 標籤、tool 統計、files_touched
- **2-2. 搜尋上下文預覽**：搜尋結果顯示前後訊息 context
- **2-3. 搜尋 scope 擴展**：FTS5 索引涵蓋 title / tags / files_touched / summary_text

> 現況：heuristic 摘要品質有限（截斷文字 + keyword matching），Phase 3 將升級 heuristic 到天花板。

---

## Phase 2.5 ✅ Context Budget 視覺化

**目標**：讓使用者一眼看出每個 session「token 花在哪、被誰吃掉」——context window 的成本透視鏡。

**為什麼插在這裡**：不依賴 LLM（Phase 3），只需解析 JSONL 已有的 `message.usage` 欄位。改動範圍明確（parser → schema → 前端圖表），可獨立交付。且圖表基礎建設（recharts）可被 Phase 4 統計儀表板復用。

**靈感來源**：[claude-code-organizer](https://github.com/mcpware/claude-code-organizer) 的 Context Budget 功能——顯示設定項目佔多少 token。我們做的是**對話層級**的 token 分析，定位不同。

> 詳細規格：[docs/CONTEXT-BUDGET-SPEC.md](CONTEXT-BUDGET-SPEC.md)

### 改動範圍摘要

- **Parser** — `parseLine()` 從 `message.usage` 抽取 token 欄位
- **Types** — `ParsedLine` / `Message` 加 token + model 欄位
- **Migration v7** — messages 加 token 欄位、sessions 加彙總欄位
- **前端** — 新增 recharts、Context Budget 面板（面積圖 + 圓餅圖 + 成本熱力條）
- **IPC** — 新增 `getSessionTokenStats` API

### 驗收

- Session 詳情頁可展開 Context Budget 面板
- 面積圖顯示 context 隨對話輪次的成長趨勢
- 能識別出 token spike（例如大量 tool_result 灌入）
- Session 列表可依 total token 排序

---

## Phase 2.7 🔜 In-App 自動更新（v1.2.0）

**目標**：從「偵測新版 → 開瀏覽器下載」升級為「背景下載 → 提示安裝 → 重啟即完成」，消除手動更新的摩擦。

**為什麼插在這裡**：後續 Phase 會頻繁迭代，如果每次更新都要使用者手動下載替換，迭代速度會被分發管道卡住。先升級更新機制，後續所有 Phase 的交付都受益。

### 改動範圍

- `src/main/updater.ts` — 從 GitHub Release 通知改為 electron-updater（autoUpdater）
- `electron-builder.yml` — 加入 publish 設定（GitHub provider）
- `src/renderer/components/UpdateBanner/` — 升級 UI：下載進度 → 安裝提示 → 重啟按鈕
- 移除現有的手動偵測邏輯（`updater.ts` 中的 GitHub API 呼叫）

### 驗收

- 發布新版後，舊版應用在背景自動下載更新
- 下載完成後顯示「新版本已就緒，重啟以套用」提示
- 使用者點擊重啟後，應用更新至新版
- 無新版時無任何干擾

---

## Phase 3 📋 摘要品質升級（v1.3.0）

**目標**：把 heuristic 摘要推到天花板——更準確的標籤、更有意義的摘要文字、從工具使用模式推斷意圖。

**為什麼不做 LLM**：呼叫 Claude Code 模型有 ToS 合規灰色地帶；BYOK 門檻高（要 API key + 花錢），大部分使用者不會用。等合規路徑明朗後再考慮（見 Phase 3.5）。

### 現況問題

- `summaryText` 只是截斷首尾 user message，無法理解意圖
- `tags` 只有 8 條 regex，覆蓋率低，很多 session 零標籤
- `filesTouched` 和 `toolsUsed` 已夠好，不需要動

### 升級方向

**summaryText 改良**：
- 跳過無意義開頭（"hey"、"hi"、純貼上的 error log）
- 從工具動作序列推斷意圖（大量 Edit = refactor、大量 Bash = debugging、Read 為主 = code review）
- 更聰明的截取策略（找第一句有實質內容的 user message）

**tags 改良**：
- 擴充標籤類別（performance、database、api、migration、security 等）
- 從 tool 使用模式補充標籤（不只靠文字 regex）
- 從 `filesTouched` 的路徑推斷（改 `.css` → ui、改 `test/` → testing）
- 多信號交叉驗證，提高準確度

### 改動範圍

- `src/main/summarizer.ts` — 重寫摘要邏輯（主要改動）
- `src/shared/types.ts` — 可能擴充 `SessionSummary` 結構
- `tests/` — 摘要品質測試（用實際 session 資料驗證改良效果）

### 驗收

- 現有零標籤的 session 至少 70% 能產生標籤
- summaryText 不再出現純截斷的無意義文字（"hey"、半句話）
- 工具密集型 session 能從動作模式推斷出正確意圖

---

## Phase 3.5 📋 統計儀表板（v1.4.0）

**目標**：提供跨 session 的使用統計視覺化——「我跟 Claude Code 的協作全貌」。

**為什麼提前**：不依賴 Phase 3 的摘要改良，也不依賴 Phase 4 的反向索引。現有資料（sessions 表的時間、token、tool 統計）已足夠。感知價值高，且 recharts 基礎建設已在 Phase 2.5 建立。

### 統計維度

- **時間趨勢**：每日/每週 session 數、token 消耗趨勢折線圖
- **專案活躍度**：哪個專案最常用、哪個消耗最多 token
- **工具分佈**：全局的 tool 使用比例（Read vs Edit vs Bash 等）
- **標籤分佈**：bug-fix / refactor / testing 等各佔多少比例
- **工作模式**：一天中哪個時段最常用、平均 session 長度

### 改動範圍

- `src/main/database.ts` — 新增統計查詢（GROUP BY project / date / tool）
- `src/main/ipc-handlers.ts` — 新增統計 IPC API
- `src/renderer/components/Dashboard/` — 新頁面，recharts 圖表組合
- `src/renderer/App.tsx` — 新增 Dashboard 路由/入口

### 驗收

- 可從 sidebar 或頂部導覽進入統計儀表板
- 至少包含時間趨勢、專案活躍度、工具分佈三張圖表
- 圖表可互動（hover 顯示數值、點擊可篩選）

---

## Phase 4 📋 跨 Session 考古（v2.0.0）

**目標**：從「看單一 session」進化到「跨 session 的脈絡追蹤」——能回答「我上次怎麼解決 X 問題的？」

> 17+ 競品全部停在「看 log」層級，無人做「理解脈絡」。這是真正從 viewer 變成考古工具的跳躍。

### 4-1. 檔案反向索引 + 歷史視圖

- 新建 `session_files(session_id, file_path)` side table（正規化 filesTouched）
- 對 file_path 建索引，支援快速反向查詢
- UI：filesTouched 的每個路徑可點擊 → 時間軸顯示該檔案在哪些 session 被操作過
- 每筆顯示：時間、session 摘要、操作類型（Read/Edit/Write）

### 4-2. 相關 Session 推薦

- 基於 filesTouched 交集計算相似度（Jaccard coefficient）
- Session 詳情頁底部顯示「相關 Session」清單
- 幫使用者發現「原來這兩個 session 在處理同一件事」

### 4-3. 專案級時間軸

- 一個專案所有 session 的鳥瞰圖
- 時間軸上標記關鍵節點（高 token session、特定標籤的 session）
- recharts 基礎可復用

---

## Backlog（視需求排入）

| 項目 | 備註 |
|------|------|
| LLM 智慧摘要 | 待合規路徑明朗（Anthropic ToS 開放 / 本地模型 / 其他方案） |
| 匯出脫敏 | Markdown 匯出時遮蔽敏感路徑，claude-replay 已有類似功能 |
| 語意搜尋 | FTS5 夠用就不投入，可復用 BYOK 基礎設施 |
| 多 AI 工具支援 | 不符合「深度 > 廣度」定位，至少 v2.0 前不做 |

---

## 風險提醒

| 風險 | 緩解 |
|------|------|
| auto-updater code signing | macOS 需 code signing 才能用 autoUpdater；未簽名時 fallback 為手動下載提示 |
| heuristic 改良有限 | 接受天花板存在，Phase 3.5 LLM 摘要作為未來突破口 |
| files_touched 解析不準 | tool_use 的 input JSON 格式可能變化，parser 要寬容 |
