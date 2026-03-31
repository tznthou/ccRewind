# Context Budget 視覺化 — 詳細規格

> Phase 2.5 | 狀態：規劃中
> 回到路線圖：[PHASE-2-3.md](PHASE-2-3.md)

---

## 1. 動機

Claude Code 的 JSONL 每個 assistant 回應都記錄了完整的 token usage：

```json
{
  "input_tokens": 3,
  "cache_read_input_tokens": 21103,
  "cache_creation_input_tokens": 6690,
  "output_tokens": 98,
  "service_tier": "standard"
}
```

但 ccRewind 目前 **完全沒有解析這些欄位**。使用者無法知道：
- 一個 session 總共燒了多少 token
- 哪個對話回合造成 context 暴漲（例如大量 tool_result 灌入）
- cache hit rate 好不好（影響成本）
- 哪種操作模式最耗 token（密集 tool 呼叫 vs 長篇文字回覆）

---

## 2. 資料來源

### 2.1 JSONL 中的 usage 欄位

只有 `type: "assistant"` 的行包含 `message.usage`，結構如下：

| 欄位 | 說明 |
|------|------|
| `input_tokens` | 非 cache 的新 input token |
| `cache_read_input_tokens` | 從 prompt cache 讀取的 token |
| `cache_creation_input_tokens` | 寫入 prompt cache 的 token |
| `output_tokens` | 模型輸出的 token |
| `service_tier` | `"standard"` 或其他 |

另外 `message.model` 記錄模型名稱（如 `claude-opus-4-6`）。

### 2.2 衍生指標

| 指標 | 計算方式 |
|------|----------|
| `context_tokens` | `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` |
| `cache_hit_rate` | `cache_read_input_tokens / context_tokens` |
| `context_delta` | 當前 turn 的 `context_tokens` - 前一 turn 的 `context_tokens` |

---

## 3. Schema 變更

### 3.1 Migration v7 — messages 表新增欄位

```sql
ALTER TABLE messages ADD COLUMN input_tokens INTEGER;
ALTER TABLE messages ADD COLUMN output_tokens INTEGER;
ALTER TABLE messages ADD COLUMN cache_read_tokens INTEGER;
ALTER TABLE messages ADD COLUMN cache_creation_tokens INTEGER;
ALTER TABLE messages ADD COLUMN model TEXT;
```

所有欄位 nullable — user 類型和舊格式的行沒有 usage 資料。

### 3.2 Migration v7 — sessions 表新增彙總欄位

```sql
ALTER TABLE sessions ADD COLUMN total_input_tokens INTEGER;
ALTER TABLE sessions ADD COLUMN total_output_tokens INTEGER;
```

彙總值在 `indexSession` 時由 parser 結果加總寫入，不做 trigger 即時更新（避免 re-index 時的複雜度）。

### 3.3 為什麼不另開 token 表？

token 資料與 message 是 1:1 關係，且每筆只有 5 個小欄位（~25 bytes）。分表只會增加 JOIN 成本，沒有空間效益。

---

## 4. Parser 變更

### 4.1 ParsedLine 新增欄位

```typescript
// src/shared/types.ts — ParsedLine
export interface ParsedLine {
  // ... 現有欄位 ...
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
  model: string | null
}
```

### 4.2 parseLine() 修改

```typescript
// src/main/parser.ts — parseLine() 內
const usage = message.usage as Record<string, unknown> | undefined
const inputTokens = usage
  ? (toInt(usage.input_tokens) ?? 0)
    + (toInt(usage.cache_read_input_tokens) ?? 0)
    + (toInt(usage.cache_creation_input_tokens) ?? 0)
  : null
const outputTokens = usage ? toInt(usage.output_tokens) ?? 0 : null
const cacheReadTokens = usage ? toInt(usage.cache_read_input_tokens) ?? 0 : null
const cacheCreationTokens = usage ? toInt(usage.cache_creation_input_tokens) ?? 0 : null
const model = typeof message.model === 'string' ? message.model : null
```

> `toInt(v)`: `typeof v === 'number' ? Math.floor(v) : null` — 防禦非數字值。

### 4.3 Message type 同步更新

```typescript
// src/shared/types.ts — Message
export interface Message {
  // ... 現有欄位 ...
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
  model: string | null
}
```

---

## 5. Database 寫入

### 5.1 MessageInput 新增欄位

```typescript
export interface MessageInput {
  // ... 現有欄位 ...
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
  model: string | null
}
```

### 5.2 indexSession 修改

- INSERT messages 時寫入 5 個新欄位
- 加總所有 messages 的 token → 寫入 sessions 的 `total_input_tokens` / `total_output_tokens`

### 5.3 re-index 相容性

既有 session 的 token 欄位為 NULL。re-index（刪除 + 重建）時會從 JSONL 重新解析，自動填入。使用者不需手動操作。

---

## 6. IPC API

### 6.1 getSessionTokenStats

```typescript
// 新增 IPC handler
getSessionTokenStats(sessionId: string): Promise<SessionTokenStats>
```

回傳結構：

```typescript
interface SessionTokenStats {
  /** Session 級彙總 */
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheCreationTokens: number
  cacheHitRate: number            // 0~1
  models: string[]                // 所有出現過的 model（不存單一值，因為同一 session 可能切換 Opus/Sonnet/Haiku）
  primaryModel: string | null     // 出現次數最多的 model（UI 顯示用）

  /** 逐 turn 明細（面積圖用） */
  turns: Array<{
    sequence: number
    timestamp: string | null
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    contextTotal: number          // 累計 context 大小
    hasToolUse: boolean
    toolNames: string[]
    model: string | null          // 該 turn 使用的 model
  }>
}
```

### 6.2 查詢實作

```sql
-- 逐 turn 資料
SELECT sequence, timestamp,
       input_tokens, output_tokens,
       cache_read_tokens, cache_creation_tokens,
       has_tool_use, tool_names
FROM messages
WHERE session_id = ? AND input_tokens IS NOT NULL
ORDER BY sequence;
```

`contextTotal` 直接取每個 turn 的 `input_tokens`（已是累計值，因為每次 API call 都送完整 context）。

---

## 7. 前端設計

### 7.1 新增依賴

```
recharts  （~180KB gzipped，React 生態最成熟的圖表庫）
```

### 7.2 元件結構

```
src/renderer/components/TokenBudget/
├── TokenBudgetPanel.tsx    ← 主面板（可展開/收合）
├── ContextGrowthChart.tsx  ← 面積圖：context 隨 turn 的成長
├── TokenBreakdown.tsx      ← 圓餅圖：input/output/cache 佔比
├── CostHeatBar.tsx         ← 水平熱力條：每個 turn 的 token 增量
├── TokenSummaryCard.tsx    ← 數字卡片：total tokens、cache hit rate
└── TokenHeatGutter.tsx     ← 訊息列表旁的色碼條（嵌入 ChatView）
```

### 7.3 Context 成長面積圖（主視覺）

```
Token
200K ┤
     │            ╭───────── cache_read（淡藍）
150K ┤        ╭───╯
     │    ╭───╯
100K ┤ ╭──╯           ╭── cache_creation（藍）
     │╭╯          ╭───╯
 50K ┤│       ╭───╯
     ││   ╭───╯ ← new_input（深藍，通常很薄）
  0K ┼┴───┴───┴───┴───┴───┴───┴───┴───┴───
     1   10   20   30   40   50   60   70
                    Turn
```

- **X 軸**：對話 turn 序號
- **Y 軸**：token 數量
- **堆疊區域**：`input_tokens`（深藍）/ `cache_creation`（藍）/ `cache_read`（淡藍）
- **Tooltip**：hover 顯示該 turn 的詳細數字 + tool 名稱
- **Spike 標記**：`context_delta` 超過前一 turn 的 2 倍時，在 X 軸標記紅點
- **Context Limit 參考線**：水平虛線標示 context window 上限，可切換 200K / 1M。視覺化「桶子滿了多少」，幫助使用者一眼看出離上限還有多遠

### 7.4 Token 佔比圓餅圖

整個 session 的彙總佔比：
- Cache Read（佔比越高越省錢）
- Cache Creation
- New Input
- Output

### 7.5 成本熱力條

水平長條，每個 turn 一格，顏色深淺代表該 turn 的 `output_tokens`。快速識別「哪個 turn 讓 Claude 寫最多東西」。

### 7.6 Token 摘要卡片

```
┌─────────────────────────────────────┐
│  Total Input    │  Total Output     │
│  1.2M tokens    │  64K tokens       │
│                 │                   │
│  Cache Hit Rate │  Model(s)         │
│  87.3%          │  opus-4-6 (98%)   │
│                 │  sonnet-4-6 (2%)  │
└─────────────────────────────────────┘
```

> Model 顯示邏輯：只有一個 model 時直接顯示名稱；多個 model 時顯示各自佔比（依 turn 數計算）。同一 session 切換 model 是常見行為（Opus 規劃 + Sonnet 執行），不應簡化為單一值。

### 7.7 Heatmap Gutter（訊息列表色碼條）

在 ChatView 訊息列表的左側或右側邊緣，嵌入一條垂直色碼條：
- 每個 assistant 訊息對應一格
- 顏色深淺代表該 turn 的 token 增量（`context_delta`）
- 紅色 = 高成本（大量新 context 灌入）、綠色 = cache 命中良好
- 使用者滾動對話時就能直覺發現「預算殺手」，不需切換到獨立面板
- 點擊色碼格可跳轉到對應的 TokenBudgetPanel 詳情

> 與既有的 `@tanstack/react-virtual` 虛擬滾動整合，不影響效能。

### 7.8 進入點

- ChatView 頂部（session 標題旁）新增「Token Budget」切換按鈕
- 點擊後在 ChatView 上方展開面板，再次點擊收合
- Heatmap Gutter 預設顯示（可在設定中關閉）
- Session 列表中顯示 total token 小標籤（可選）

### 7.9 效能防護

- **Recharts 動畫**：超過 100 turn 的 session 自動關閉動畫（`isAnimationActive={false}`），避免 SVG 渲染卡頓
- **資料降採樣**：超過 500 turn 時，面積圖每 N 個 turn 取一個點，保留 spike 極值不丟失

---

## 8. 實作順序

| Step | 範圍 | 預估改動 |
|------|------|----------|
| 1 | Parser + Types：解析 usage 欄位 | parser.ts, types.ts |
| 2 | Migration v7 + DB 寫入 | database.ts |
| 3 | IPC API：getSessionTokenStats | ipc-handlers.ts, preload.ts |
| 4 | 前端：TokenSummaryCard（純數字） | 新元件，驗證資料流通 |
| 5 | 前端：ContextGrowthChart（面積圖 + context limit 參考線） | recharts 引入 |
| 6 | 前端：TokenBreakdown + CostHeatBar | 補齊視覺化 |
| 7 | 前端：TokenHeatGutter（訊息列表色碼條） | 嵌入 ChatView |
| 8 | Session 列表：total token 排序/標籤 | SessionList.tsx |

建議逐步交付：Step 1-3 為資料層，可先合併；Step 4-8 為 UI 層，逐一加入。
**最小可交付版本（MVP）**：Step 1-5，只要 Summary Cards + 面積圖就能提供核心價值。

---

## 9. 測試策略

| 層級 | 測試項目 |
|------|----------|
| Parser | 有 usage 的行正確提取 5 個欄位；無 usage 的行回傳 null |
| Parser | usage 欄位為非數字時不 crash（寬容模式） |
| Migration | v7 migration 在既有 DB 上成功執行，舊資料 token 欄位為 NULL |
| DB | indexSession 正確寫入 token + 彙總值 |
| IPC | getSessionTokenStats 回傳正確結構 |
| 前端 | Token panel 展開/收合、圖表渲染、空資料 fallback |

---

## 10. 不做的事

- **不做成本估算（美元）**：Anthropic 價格會變，計算規則複雜（cache 有不同定價），做了容易誤導
- **不做跨 session 比較**：Phase 4 統計儀表板的範疇
- **不做即時 token 監控**：ccRewind 是離線回放工具，不 hook 進執行中的 Claude Code
- **不做 token 預測**：不預測「還剩多少 context」，因為我們沒有 system prompt 的完整資訊
