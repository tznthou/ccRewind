# ccRewind — 功能演進路線圖

> Phase 1 ✅：表拆分、資料保全、分頁、分組
> Phase 2 ✅：Session heuristic 摘要、搜尋上下文預覽、scope 擴展
> Phase 2.5 ✅：Context Budget 視覺化（token 成本透視）
> Phase 2.6 ✅：Token Insights Engine（圖表解讀層）（v1.2.0）
> Phase 3 ✅：摘要品質升級 + 檔案反向索引（v1.3.0）
> Phase 3.5 📋：統計儀表板 + 跨 Session 考古 UI（v1.4.0）
> Phase 4 📋：自動更新（待 code signing）（v1.5.0+）
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

### 改動範圍

- `src/renderer/components/TokenBudget/insightEngine.ts` — 純函數，5 條規則（新增）
- `src/renderer/components/TokenBudget/InsightsPanel.tsx` — 洞察清單 UI（新增）
- `src/renderer/components/TokenBudget/TokenBudget.module.css` — Insights 樣式（修改）
- `src/renderer/components/TokenBudget/TokenBudgetPanel.tsx` — 引入 InsightsPanel（修改）

### 驗收

- Token Budget 面板底部顯示 Insights 區域
- Context spike session 能自動偵測到暴增的 turn 並歸因
- Cache hit rate 極端值有明確的好壞評語
- 一般 session（無異常）不會產生噪音

### 未來延伸（不在此版本）

- 圖表上的 ReferenceDot spike 標記（圖表 annotation）
- 跨 session 比較基準（「此 session 在所有 session 中排名前 N%」，需 Phase 3.5 統計 API）
- Insight 與圖表的 hover 聯動

---

## Phase 3 ✅ 摘要品質升級 + 檔案反向索引（v1.3.0）

**目標**：雙軌並行——(A) 把 heuristic 摘要推到天花板；(B) 建立檔案反向索引資料層，為跨 Session 考古打地基。

**為什麼合併**：摘要改良和檔案反向索引互不依賴，但都是「理解脈絡」的基礎設施。合併交付讓 v1.3.0 同時提升單 session 品質和跨 session 能力的資料基礎。

**為什麼不做 LLM**：呼叫 Claude Code 模型有 ToS 合規灰色地帶；BYOK 門檻高（要 API key + 花錢），大部分使用者不會用。等合規路徑明朗後再考慮。

### 3-A. 摘要品質升級

**現況問題**：
- `summaryText` 只是截斷首尾 user message，無法理解意圖
- `tags` 只有 8 條 regex，覆蓋率低，很多 session 零標籤
- `filesTouched` 和 `toolsUsed` 已夠好，不需要動

**升級方向**：

**summaryText 改良**：
- 跳過無意義開頭（"hey"、"hi"、純貼上的 error log）
- 從工具動作序列推斷意圖（大量 Edit = refactor、大量 Bash = debugging、Read 為主 = code review）
- 更聰明的截取策略（找第一句有實質內容的 user message）

**tags 改良**：
- 擴充標籤類別（performance、database、api、migration、security 等）
- 從 tool 使用模式補充標籤（不只靠文字 regex）
- 從 `filesTouched` 的路徑推斷（改 `.css` → ui、改 `test/` → testing）
- 多信號交叉驗證，提高準確度

### 3-B. 檔案反向索引（資料層）

- 新建 `session_files(session_id, file_path)` side table（正規化 filesTouched）
- 對 file_path 建索引，支援快速反向查詢
- Migration 建表 + backfill 現有 sessions 的 filesTouched
- **此版只做資料層，UI 在 Phase 3.5 交付**

### 改動範圍

- `src/main/summarizer.ts` — 重寫摘要邏輯（主要改動）
- `src/main/database.ts` — 新增 `session_files` 表、Migration、反向查詢 API
- `src/shared/types.ts` — 可能擴充 `SessionSummary` 結構
- `tests/` — 摘要品質測試 + 反向索引測試

### 驗收

- 現有零標籤的 session 至少 70% 能產生標籤
- summaryText 不再出現純截斷的無意義文字（"hey"、半句話）
- 工具密集型 session 能從動作模式推斷出正確意圖
- `session_files` 表正確 backfill，反向查詢 < 50ms

---

## Phase 3.5 📋 統計儀表板 + 跨 Session 考古 UI（v1.4.0）

**目標**：雙軌並行——(A) 跨 session 使用統計視覺化；(B) 用 Phase 3 建好的反向索引，交付跨 Session 考古的 UI。

**為什麼合併**：統計儀表板和考古 UI 都是「跨 session 視角」，共享 recharts 基礎和 sidebar 導覽入口。合併交付讓 v1.4.0 成為 ccRewind 從 viewer 跳躍到考古工具的關鍵版本。

> 17+ 競品全部停在「看 log」層級，無人做「理解脈絡」。Phase 3.5 是真正建立護城河的版本。

### 3.5-A. 統計儀表板

**統計維度**：
- **時間趨勢**：每日/每週 session 數、token 消耗趨勢折線圖
- **專案活躍度**：哪個專案最常用、哪個消耗最多 token
- **工具分佈**：全局的 tool 使用比例（Read vs Edit vs Bash 等）
- **標籤分佈**：bug-fix / refactor / testing 等各佔多少比例
- **工作模式**：一天中哪個時段最常用、平均 session 長度

### 3.5-B. 跨 Session 考古 UI

**檔案歷史視圖**：
- filesTouched 的每個路徑可點擊 → 時間軸顯示該檔案在哪些 session 被操作過
- 每筆顯示：時間、session 摘要、操作類型（Read/Edit/Write）

**相關 Session 推薦**：
- 基於 filesTouched 交集計算相似度（Jaccard coefficient）
- Session 詳情頁底部顯示「相關 Session」清單

**專案級時間軸**：
- 一個專案所有 session 的鳥瞰圖
- 時間軸上標記關鍵節點（高 token session、特定標籤的 session）

### 改動範圍

- `src/main/database.ts` — 統計查詢（GROUP BY project / date / tool）+ 反向查詢 API + Jaccard 計算
- `src/main/ipc-handlers.ts` — 統計 + 考古 IPC API
- `src/renderer/components/Dashboard/` — 統計儀表板頁面
- `src/renderer/components/FileHistory/` — 檔案歷史視圖
- `src/renderer/components/RelatedSessions/` — 相關 Session 推薦
- `src/renderer/App.tsx` — 新增路由/入口

### 驗收

- 可從 sidebar 進入統計儀表板，至少包含時間趨勢、專案活躍度、工具分佈
- filesTouched 路徑可點擊，展示跨 session 歷史
- Session 詳情頁底部顯示相關 Session（基於檔案交集）
- 圖表可互動（hover 顯示數值）

---

## Phase 4 📋 In-App 自動更新（v1.5.0+）

**目標**：從「偵測新版 → 開瀏覽器下載」升級為「背景下載 → 提示安裝 → 重啟即完成」，消除手動更新的摩擦。

**為什麼排在護城河之後**：auto-updater 是分發便利性，不是差異化。在沒有 Apple Developer ID（$99/年）的情況下，macOS 上 electron-updater 會 fallback 回手動下載，ROI 有限。護城河（Phase 3 + 3.5）比分發管道更優先。

**前提條件**：取得 Apple Developer ID code signing certificate。沒有簽名的 auto-updater 在 macOS 上無法正常運作。

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

## Backlog（視需求排入）

| 項目 | 備註 |
|------|------|
| LLM 智慧摘要 | 待合規路徑明朗（Anthropic ToS 開放 / 本地模型 / 其他方案） |
| 匯出脫敏 | Markdown 匯出時遮蔽敏感路徑，claude-replay 已有類似功能 |
| 語意搜尋 | FTS5 夠用就不投入，可復用 BYOK 基礎設施 |
| 多 AI 工具支援 | 不符合「深度 > 廣度」定位，至少 v2.0 前不做 |
| Insights 圖表 Annotation | Phase 2.6 洞察延伸：spike 點在面積圖上用 ReferenceDot 標記 |
| Insights 跨 Session 基準 | 需 Phase 3.5 統計 API：「此 session 在所有 session 中排名前 N%」 |

---

## 風險提醒

| 風險 | 緩解 |
|------|------|
| auto-updater code signing | macOS 需 code signing + Apple Developer ID ($99/年)；未取得前維持手動下載提示 |
| heuristic 改良有限 | 接受天花板存在，LLM 摘要作為未來突破口 |
| files_touched 解析不準 | tool_use 的 input JSON 格式可能變化，parser 要寬容 |
| 護城河建設速度 | Phase 3.5 之前的差異化（FTS5 + Token 視覺化）技術門檻不高，競品可快速複製。越早交付 Phase 3.5 越安全 |
| Insight 規則噪音 | 觸發閾值寧高勿低，中等值不出聲。定期根據實際 session 資料校準閾值 |
