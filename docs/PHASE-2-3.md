# Phase 2 & 3 — ccRewind 搜尋進化路線

> Phase 1（已完成）：表拆分、資料保全、分頁、分組
> 本文件規劃 Phase 2（Session 摘要）與 Phase 3（知識庫）

---

## Phase 2：Session 摘要與結構化搜尋

**目標**：讓搜尋結果從「散落的文字碎片」進化為「有脈絡的 session 概覽」

### 2-1. Session 自動摘要（heuristic，不需 LLM）

**做什麼**：索引時為每個 session 產生結構化摘要，存入 DB

**摘要欄位**（sessions 表新增或獨立 session_summary 表）：
- `summary_text`：自動產生的摘要文字（~200 字）
- `tags`：自動標籤（逗號分隔，例如 `auth,refactor,bug-fix`）
- `files_touched`：出現在 tool_use 中的檔案路徑
- `tools_used`：使用過的 tool 名稱統計（例如 `Read:15,Edit:8,Bash:5`）

**摘要產生策略**（純 heuristic，零 API 成本）：
1. 取第一則 user 訊息作為「意圖」
2. 取最後一則 user 訊息作為「結論」
3. 從 tool_use 的 input 提取檔案路徑（Read/Edit/Write 的 file_path 參數）
4. 統計 tool 使用頻率
5. 從 content_text 提取關鍵動作詞推測標籤：
   - 含 `fix`/`bug`/`error` → `bug-fix`
   - 含 `refactor`/`rename`/`move` → `refactor`
   - 含 `test`/`spec` → `testing`
   - 含 `deploy`/`release`/`version` → `deployment`

**改動範圍**：
- `src/main/database.ts` — migration 新增欄位 + 寫入方法
- `src/main/summarizer.ts` — 新檔案，摘要產生邏輯
- `src/main/indexer.ts` — 索引時呼叫 summarizer
- `src/shared/types.ts` — SessionMeta 加摘要欄位
- `src/renderer/components/Sidebar/SessionList.tsx` — 顯示標籤 + 檔案數
- `tests/summarizer.test.ts` — 摘要邏輯測試

**驗收**：
- 每個 session 列表項目顯示標籤 badge + 涉及檔案數
- 搜尋結果的 session 分組顯示摘要

### 2-2. 搜尋結果上下文擴展

**做什麼**：點擊搜尋結果時，不只跳到單一訊息，而是顯示前後 3 則訊息的完整對話片段

**改動範圍**：
- `src/main/database.ts` — 新增 `getMessageContext(messageId, range)` 方法
- `src/main/ipc-handlers.ts` — 新增 `message:context` handler
- `src/renderer/components/ChatView/ChatView.tsx` — 搜尋跳轉時先載入 context 片段再展開完整 session

**備選方案**：
- 簡單版：維持現有跳轉行為，但在搜尋結果的 snippet 中顯示更多上下文（已在 Phase 1 把 snippet 從 32 加到 64）
- 完整版：搜尋結果預覽面板，點擊後展開前後對話

### 2-3. 搜尋 scope 擴展

**做什麼**：除了搜「訊息內容」，也能搜：
- Session 標題
- 標籤
- 涉及的檔案路徑

**改動範圍**：
- `src/main/database.ts` — FTS5 索引加入 summary_text + tags + files_touched
- `src/renderer/components/Sidebar/SearchBar.tsx` — 搜尋類型切換（全文 / 標籤 / 檔案）

---

## Phase 3：知識庫（開發者第二大腦）

**目標**：從「考古工具」跳躍為「決策知識庫」——能回答「我上次怎麼解決 X 問題的？」

> Phase 3 是中長期目標，需要評估 ROI 再決定做多深

### 3-1. 語意搜尋

**做什麼**：用 embedding model 為每個 session 生成向量，支援語意搜尋

**技術選項**：

| 方案 | 優點 | 缺點 |
|------|------|------|
| Local model（all-MiniLM-L6-v2） | 離線、免費、隱私 | 需額外安裝 ONNX runtime，85 MB 模型 |
| OpenAI/Anthropic API embedding | 品質好、簡單 | 需 API key、付費、隱私疑慮 |
| SQLite FTS5 BM25 tuning | 零依賴 | 不是真正的語意搜尋 |

**建議路線**：先用 FTS5 BM25 tuning 強化關鍵字搜尋（Phase 2 就能做），語意搜尋作為可選功能（需要使用者自己提供 API key 或安裝 local model）

**改動範圍**（如果做 local embedding）：
- `src/main/embedder.ts` — 新檔案，embedding 生成
- `src/main/database.ts` — 新增 vector 表 + 相似度查詢
- `src/main/indexer.ts` — 索引時生成 embedding
- `src/renderer/components/Sidebar/SearchBar.tsx` — 語意搜尋模式切換

### 3-2. 跨 Session 決策鏈追蹤

**做什麼**：偵測跨 session 的關聯——同一個檔案在不同 session 被修改、同一個 bug 在多個 session 被討論

**實作思路**：
1. 從 Phase 2 的 `files_touched` 建立檔案 → session 的反向索引
2. 提供「這個檔案的歷史」視圖：列出所有修改過此檔案的 session
3. 提供「相關 session」推薦：共用檔案越多 → 相關度越高

**改動範圍**：
- `src/main/database.ts` — 新增 file_index 表（file_path → session_id 多對多）
- `src/main/ipc-handlers.ts` — 新增 `file:history` handler
- `src/renderer/components/` — 新增 FileHistory 元件
- 可能需要 sidebar 新 tab 或 ChatView 右側面板

### 3-3. 統計儀表板

**做什麼**：對話頻率、tool 分佈、專案活躍度趨勢圖（PRD 中的 P2 功能）

**改動範圍**：
- `src/renderer/components/Dashboard/` — 新元件
- 圖表庫：考慮 recharts（輕量）或 visx（D3 wrapper）
- `src/main/database.ts` — 統計查詢（GROUP BY project/date/tool）

---

## 優先序建議

```
Phase 2（下一步，ROI 最高）
  2-1. Session 摘要（heuristic）     ← 最優先，零成本大改善
  2-2. 搜尋上下文擴展               ← 簡單版先做
  2-3. 搜尋 scope 擴展              ← 依賴 2-1

Phase 3（評估後再做）
  3-2. 決策鏈追蹤（檔案歷史）        ← 依賴 2-1 的 files_touched
  3-3. 統計儀表板                   ← 獨立，可隨時做
  3-1. 語意搜尋                     ← 最後做，技術風險高
```

## 風險提醒

| 風險 | 緩解 |
|------|------|
| 摘要 heuristic 品質不夠好 | 先做，看實際效果再決定是否需要 LLM |
| Embedding model 太大 | 先不做，用 FTS5 BM25 撐到真正需要時 |
| files_touched 解析不準 | tool_use 的 input JSON 格式可能變化，parser 要寬容 |
| scope 膨脹 | Phase 2 嚴格限制在 heuristic，不引入外部依賴 |
