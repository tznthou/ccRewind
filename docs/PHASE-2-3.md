# ccRewind — 功能演進路線圖

> Phase 1 ✅：表拆分、資料保全、分頁、分組
> Phase 2 ✅：Session heuristic 摘要、搜尋上下文預覽、scope 擴展
> Phase 2.5 🔜：Context Budget 視覺化（token 成本透視）
> Phase 3 📋：LLM 智慧摘要（BYOK）
> Phase 4 📋：知識庫（決策鏈追蹤、統計儀表板、語意搜尋）

---

## Phase 1 ✅ 基礎建設

表拆分（message_content / message_archive）、archived 機制、分頁、時間分組。

## Phase 2 ✅ Session 摘要與結構化搜尋

- **2-1. Heuristic 摘要**：截取首尾 user message、regex 標籤、tool 統計、files_touched
- **2-2. 搜尋上下文預覽**：搜尋結果顯示前後訊息 context
- **2-3. 搜尋 scope 擴展**：FTS5 索引涵蓋 title / tags / files_touched / summary_text

> 現況：heuristic 摘要品質有限（截斷文字 + keyword matching），Phase 3 將用 LLM 升級。

---

## Phase 2.5 🔜 Context Budget 視覺化

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

## Phase 3 🔜 LLM 智慧摘要（BYOK）

**目標**：用 LLM 產生真正的意圖理解摘要，取代 heuristic 的「截取第一句 + 最後一句」

**為什麼先做這個**：Phase 4 的語意搜尋、決策鏈追蹤都建立在好的摘要之上，先升級摘要品質 ROI 最高。

### 現況問題

- `summaryText` 只是截斷 user message，無法理解意圖
- `tags` 只靠 regex keyword matching，覆蓋率低
- 使用者看到的摘要沒有實質幫助

### 設計方向

- **BYOK**（Bring Your Own Key）：使用者在設定頁輸入 OpenAI API key
- **預設模型**：GPT-4o mini（性價比最高，全量 193 session 約 $0.07–$0.27）
- **無 key fallback**：沒設定 key 時行為與現在完全一致（heuristic 摘要）
- **背景批次**：索引後非同步執行，不阻塞 UI
- **省 token**：每 session 送截取 context（前後各 N 則訊息，~2K tokens），已有 LLM 摘要不重複呼叫

### 改動範圍

- `src/main/llm-summarizer.ts` — LLM 摘要邏輯
- `src/main/indexer.ts` — 索引後非同步觸發 LLM 摘要
- `src/main/database.ts` — 區分 heuristic vs LLM 摘要（`summary_source` 欄位）
- `src/renderer/components/Settings/` — API key 設定 UI
- `src/main/config.ts` — 安全儲存 API key（Electron safeStorage / OS keychain）

### 驗收

- 設定 API key 後，新 session 自動產生 LLM 摘要
- 未設定 key 時行為與現在完全一致
- session 列表能明顯看出摘要品質差異

---

## Phase 4 📋 知識庫（開發者第二大腦）

**目標**：從「考古工具」進化為「決策知識庫」——能回答「我上次怎麼解決 X 問題的？」

> 中長期目標，需要評估 ROI 再決定做多深。依賴 Phase 3 的高品質摘要。

### 4-1. 跨 Session 決策鏈追蹤

偵測跨 session 關聯——同一個檔案在不同 session 被修改、同一個 bug 在多個 session 被討論。

- 從 `files_touched` 建立檔案 → session 反向索引
- 「這個檔案的歷史」視圖 + 「相關 session」推薦

### 4-2. 統計儀表板

對話頻率、tool 分佈、專案活躍度趨勢圖。

- 圖表庫：recharts（輕量）或 visx
- 統計查詢：GROUP BY project / date / tool

### 4-3. 語意搜尋

用 embedding model 為 session 生成向量，支援語意搜尋。

| 方案 | 優點 | 缺點 |
|------|------|------|
| Local model（all-MiniLM-L6-v2） | 離線、免費、隱私 | 需 ONNX runtime，85 MB 模型 |
| OpenAI API embedding | 品質好、簡單 | 需 API key、付費 |
| FTS5 BM25 tuning | 零依賴 | 不是真正的語意搜尋 |

> 建議：語意搜尋作為可選功能，可復用 Phase 3 的 BYOK 基礎設施。

---

## 風險提醒

| 風險 | 緩解 |
|------|------|
| BYOK key 安全性 | API key 存 OS keychain（Electron safeStorage），不存明文 |
| LLM 成本失控 | 只對未摘要 session 呼叫，設 rate limit，顯示 token 用量 |
| Embedding model 太大 | 先不做，用 FTS5 BM25 撐到真正需要時 |
| files_touched 解析不準 | tool_use 的 input JSON 格式可能變化，parser 要寬容 |
