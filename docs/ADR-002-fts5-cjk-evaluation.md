# ADR-002: FTS5 CJK Tokenizer 強化方案評估

> **Status**: Rejected（現階段不做；dogfood evidence-driven 觀察）
> **Date**: 2026-05-08
> **Evaluators**: Claude Opus 4.7（with web research on prior art）
> **Decision**: 維持 `unicode61` tokenizer，不引入 CJK 強化方案
> **Scope**: 本 ADR 結論僅適用 ccRewind；ccRecall 場景需獨立評估（見 §ccRecall 場景考量）

## Context

ccRewind 內部討論「FTS5 強化 POC」是否該推進，特別是 CJK 搜尋體驗。觸發點有三：

1. ccRewind v1.10~v1.12 已完成多項 FTS5 周邊改善（empty state syntax hints、auto-quote、markdown / tool block highlight、aria-live SR 廣播），下一步該往哪？
2. 2026-04-09 與 Codex 共同拍板「FTS5 周邊優先，semantic search 暫緩」，但「周邊」做到哪算夠？
3. ccFamily 主場是繁中圈，子超提問「中文搜尋體驗會不會是 distribution 阻力」

關鍵問題：**ccRewind 的搜尋對象是 Claude Code 對話 JSONL**，不是純中文文本。對話內容混雜大量英文 token（function 名、檔名、error message、log fragment、SDK API、技術術語），中文比例相對低。這跟典型「中文搜尋 app」（記事、商品搜尋、聊天 app）的 corpus 結構不同——本評估的核心 framing。

## 現有技術現狀

### FTS5 schema（v17）

| 表 | 欄位 | Tokenizer | 說明 |
|---|---|---|---|
| `messages_fts` | `content_text` | `unicode61` | message 全文 |
| `sessions_fts` | `title`, `tags`, `files_touched`, `summary_text`, `intent_text` | `unicode61` | session-level 反向索引 |

### 過去 1 個月已做的 FTS5 周邊改善

| 版本 | 改善 |
|---|---|
| v1.9.3 | Search keyword highlight in Markdown + Tool blocks（rehypeSearchHighlight）|
| v1.10.0 | Sidebar 搜尋結果 ArrowUp/Down 鍵盤導覽 |
| v1.11.0 | FTS5 search syntax hints empty state（exact phrase / prefix / OR / NOT chips）|
| v1.11.0 | Live region for SR announcements（searchEmpty / searchError / sync done）|
| v1.11.0 | Auto-quote 特殊字元（`/`、`.`、`-`、`\`），feedback memory `feedback_fts5_autoquote.md` |
| v1.12.0 | Search-related sessions group by Jaccard similarity |

### Dogfood 觀察（2026-05-08 子超口頭確認）

- 中文搜尋目前未踩到具體痛點
- 全功能 dogfood 期間沒有「搜不到」「搜出來太雜」的記錄
- distribution 才是當前 bottleneck，不是 feature 深度

## 評估對象：CJK FTS5 強化的主流方案

### 四條路盤點

| 方案 | 機制 | 代表 repo | 維護活躍度 |
|---|---|---|---|
| **A. SQLite 內建 trigram** | 三字滑動窗，CJK 字也適用 | SQLite 3.34+ 內建 | N/A（內建）|
| **B. wangfenjin/simple** | 字 token + simple_query 重組 + 拼音 + 可選 cppjieba 分詞 | [wangfenjin/simple](https://github.com/wangfenjin/simple) | 高（中文圈最有名）|
| **C. lindera-sqlite** | Rust morphological analyzer | [lindera/lindera-sqlite](https://github.com/lindera/lindera-sqlite) | 中 |
| **D. Signal fork better-sqlite3** | 自 build tokenizer 進 binary | Signal app 開源 fork | 高（Signal 自用）|
| **E. 維持 unicode61**（baseline）| 每 CJK 字一 token | SQLite 內建 | N/A |

### 對 ccRewind 的適用性矩陣

| 方案 | CJK 體驗提升 | Native ext？ | macOS Electron SIGTRAP 風險 | 維護成本 | 對 ccRewind 結論 |
|---|---|---|---|---|---|
| A. SQLite trigram | 略好；但 < 3 字英文 token 失效 | 否（內建） | 0 | 低 | 🟡 trade-off，不是 strict upgrade |
| B. simple（不啟 jieba）| 中 | ✅ C ext | ⚠ 雷 | 中 | ❌ 不對等 |
| B+. simple + cppjieba | 高 | ✅ C ext + 字典 | ⚠ 雷 | 高 | ❌ 殺雞用牛刀 |
| C. lindera | 高 | ✅ Rust ext | ⚠ 雷 | 高 | ❌ |
| D. Signal fork | 中-高 | 內建（不走 loadExtension） | 0 | 高（fork 維護） | ❌ |
| E. 維持 unicode61 | baseline | 否 | 0 | 0 | ✅ 現狀 |

## 兩個關鍵 fact-check

### Fact 1：unicode61 對 CJK 已不是 silent drop（SQLite 3.34+）

部分早期討論（narkive sqlite-users mailing list 2018 前後）會說「unicode61 silently drops CJK characters」。這在現代 SQLite 已修正：

- 現行 unicode61 對 CJK 是「每字一 token」（character-by-character tokenization）
- 並非 drop，而是 recall 高 / precision 低（搜「除錯」會 match 任何含「除」或「錯」的文本）
- 對程式碼對話這種「天然高辨識度 token」corpus 的 recall 已足夠

**對 ccRewind 的意義**：dogfood「中文搜尋沒問題」的主觀感受跟現代 SQLite 行為一致，並非僥倖。

### Fact 2：better-sqlite3 + Electron + loadExtension 是雷區

2026-04 我們踩過 `loadExtension` 在 macOS Electron GUI 環境 SIGTRAP（即 Apple library validation 拒絕載入未簽章 dylib），詳見 memory `feedback_loadextension_macos.md`。後來改用 BLOB 表 + JS-side 處理繞過。

**對本 ADR 的意義**：任何走 C/Rust extension 的方案（B / B+ / C）都要重新踩這個雷或重新 build SQLite binary。Signal 路線（D）繞過 loadExtension（編進 better-sqlite3 fork），代價是維護 fork。

## Decision

**ccRewind 維持 unicode61 tokenizer，不引入任何 CJK 強化方案。**

### 主要理由

1. **場景不對等**：wangfenjin/simple 等中文 FTS5 強化方案是為「中文文本為主」場景設計（記事 / 商品 / 聊天），ccRewind 的 corpus 是 Claude Code 對話（混雜大量英文程式碼 token），受益面有限
2. **dogfood 無實證痛點**：自用情境未踩到 CJK 搜尋失效；無 evidence 不動手
3. **C 系列方案 macOS Electron 風險高**：loadExtension SIGTRAP 已踩過，引入 native ext 要重新付這個成本
4. **Signal fork 路線維護負擔過大**：自己 fork better-sqlite3 跟 release 同步是長期工程
5. **內建 trigram（方案 A）非 strict upgrade**：對 < 3 字英文 token 失效（如 `FTS5` / `IPC` / `TS`），是 trade-off
6. **bottleneck 不是 feature 深度**：當前 distribution 為零用戶階段，FTS5 再強沒有人受惠

### 已封箱範圍

下列項目本評估後**正式封箱**，不再列為 follow-up：

- 引入 wangfenjin/simple-tokenizer
- 引入 lindera-sqlite
- 走 Signal fork 路線
- 切換到 SQLite 內建 trigram tokenizer

## ccRecall 場景考量（待獨立評估）

ccRecall 的 corpus 跟 ccRewind 結構**顯著不同**：

| 維度 | ccRewind | ccRecall |
|---|---|---|
| Corpus 主體 | Claude Code 對話 JSONL（混雜英中）| 使用者手動儲存的記憶 / ADR / 中文筆記 |
| 中文比例 | 低-中（dev 場景多英文 token）| 高（個人記憶系統，繁中為主）|
| Token 高辨識度 | 高（function 名 / 檔名 / error）| 視內容；ADR / 筆記可能全段中文 |
| 搜尋場景 | 「找回某次討論的關鍵字」 | 「按需召回相關記憶」 |
| Recall vs Precision 偏好 | recall 優先（找到就好，多無妨）| precision 重要（注入給 Claude，雜訊有成本）|

**因此**：本 ADR 對 ccRewind 的「不做」結論**不應自動套用到 ccRecall**。建議 ccRecall 獨立評估，至少思考：

1. 中文 corpus 比例是否高到 unicode61 precision 不堪用？
2. recall 過高在 LLM context injection 場景下是否反而有害（雜訊放大）？
3. ccRecall 的部署形態（npm 套件 + MCP server vs Electron app）是否避開 loadExtension 雷？
4. 若選 wangfenjin/simple，pinyin 搜尋對 ccRecall 的價值（「我記得有個關於 zhoujielun 的記憶」這種用例）是否成立？

→ 此 ADR 提供 ccRecall 評估時的 prior art baseline，但不預設結論。

## Trigger conditions for re-evaluation（重啟此討論的條件）

下列情境出現任一時，本 ADR 應重啟評估，不要當成永久封箱：

1. **dogfood 真實踩到 CJK 搜尋失效**：例如連續 3 次以上「我記得搜過某個中文關鍵字但沒找到」的記錄
2. **用戶反饋**：GitHub issue / Discussion 出現具體中文搜尋體驗問題
3. **生態出現純 JS / WASM 路線**：避開 native ext SIGTRAP 雷的 tokenizer 方案成熟
4. **ccRewind corpus 結構顯著變化**：例如未來支援 import 純中文筆記 / Notion export，corpus 中文比例顯著上升
5. **ccRecall 評估後採用某方案**：若 ccRecall 走 wangfenjin/simple 等路線且運作良好，ccRewind 可重新評估「同一方案能否複用」

## Related references

### Memory

- `~/.claude/projects/-Users-tznthou-Documents-ccRwind/memory/project_semantic_search_poc.md` — 2026-04-09 拍板「FTS5 周邊優先」原始決策
- `~/.claude/projects/-Users-tznthou-Documents-ccRwind/memory/feedback_fts5_autoquote.md` — Auto-quote 特殊字元的 feedback
- `~/.claude/projects/-Users-tznthou-Documents-ccRwind/memory/feedback_loadextension_macos.md` — loadExtension macOS SIGTRAP 踩雷紀錄
- `~/.claude/projects/-Users-tznthou-Documents-ccRwind/memory/project_cchv_strategy.md` — depth-not-breadth 差異化策略

### 主流方案 GitHub repos

- [wangfenjin/simple](https://github.com/wangfenjin/simple) — 中文 + 拼音 SQLite FTS5 tokenizer，中文圈最知名
- [streetwriters/sqlite-better-trigram](https://github.com/streetwriters/sqlite-better-trigram) — Trigram 改進版（短 token 處理）
- [simonw/sqlite-fts5-trigram](https://github.com/simonw/sqlite-fts5-trigram) — Simon Willison 的 trigram 實作
- [am009/simper_fts5](https://github.com/am009/simper_fts5) — Unicode61 + CJK 字元拆 token
- [lindera/lindera-sqlite](https://github.com/lindera/lindera-sqlite) — Rust morphological analyzer 路線
- [TangXiaoLv/Android-Sqlite-Fts5-Tokenizer](https://github.com/TangXiaoLv/Android-Sqlite-Fts5-Tokenizer) — Android 端整合範例

### 文章與討論

- [Building a Search System with SQLite FTS5 and CJK Support — DEV Community](https://dev.to/ahmet_gedik778845/building-a-search-system-with-sqlite-fts5-and-cjk-support-472f)
- [GRDB.swift Issue #413: How can I use FTS5 Tokenizers to search Chinese?](https://github.com/groue/GRDB.swift/issues/413)
- [SQLite User Forum: Contentless trigram indexes and GLOB/LIKE in FTS](https://sqlite.org/forum/info/94404e99795a20fc6f3d27f4d2d5d6fb27d552bbdfcd40742258aaa6f52369f0)
- [SQLite FTS5 Extension](https://www.sqlite.org/fts5.html)
- [Signal's better-sqlite3 fork（signal_tokenizer）](https://github.com/signalapp/better-sqlite3) — Signal app 自用的 CJK tokenizer 內建路線

### Adjacent ADR

- [ADR-001: Electrobun 架構遷移評估](./ADR-001-electrobun-migration.md) — 同樣的「Status: Rejected, dogfood-driven 觀察」框架
