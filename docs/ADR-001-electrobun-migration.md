# ADR-001: Electron → Electrobun 架構遷移評估

> **Status**: Rejected (暫緩)
> **Date**: 2026-04-02
> **Evaluators**: Claude Opus 4.6, OpenAI Codex (GPT-5.4), Google Gemini
> **Decision**: 維持 Electron，持續觀察 Electrobun 發展

## Context

ccRewind v1.4.0 基於 Electron 33 + React 19 + better-sqlite3 構建，打包體積約 180MB。[Electrobun](https://github.com/blackboardsh/electrobun) 是一個使用 Bun runtime + 系統 webview 的新興桌面框架，宣稱可將 bundle 縮小至 ~12MB，增量更新僅 ~14KB。

評估動機：bundle size 大幅縮減、啟動速度提升、Bun 原生 TypeScript 支援。

## ccRewind 現有技術棧

| 元件 | 技術 | 備註 |
|------|------|------|
| Runtime | Electron 33 (Node.js) | Chromium 內建 |
| Frontend | React 19 + react-markdown + recharts | Markdown 渲染 + 程式碼高亮 |
| Database | better-sqlite3 + FTS5 | 8 個 migration 版本、觸發器、全文搜尋 |
| Build | electron-vite + electron-builder | DMG/NSIS/AppImage 打包 |
| Test | Vitest (172 tests) | ELECTRON_RUN_AS_NODE=1 確保 ABI 一致 |
| IPC | invoke/handle 模式 | ~8 channels |
| Codebase | ~5,700 LOC TypeScript | Main ~2,600 / Renderer ~2,700 |
| UI 語言 | 全繁體中文 | — |

## Electrobun 概況 (截至 2026-04-02)

| 項目 | 數據 |
|------|------|
| Latest Release | v1.17.1-beta.0 (2026-04-01) |
| Stable Release | **無** — 所有版本皆為 beta |
| GitHub Stars | ~11,000 |
| Open Issues | 182 |
| Runtime | Bun |
| Webview | 系統原生 (macOS: WKWebView, Linux: WebKitGTK, Windows: WebView2) |
| Native Layer | Zig |
| Bundle Size | ~12MB |
| Update Mechanism | bsdiff (~14KB patches) |
| Platform | macOS 14+, Windows 11+, Ubuntu 22.04+ |
| License | MIT |

## 評估結果

### 1. better-sqlite3 → bun:sqlite 可行性

**結論：技術上可行，FTS5 需逐平台驗證。**

- bun:sqlite API 設計靈感來自 better-sqlite3，對映關係明確（`prepare().all()` → `query().all()`）
- **FTS5 未在 Bun 官方文件中明確保證**。上游 SQLite 需 `SQLITE_ENABLE_FTS5` 編譯選項
- [Bun issue #24957](https://github.com/oven-sh/bun/issues/24957) 顯示 macOS 上 bun:sqlite 可能使用系統 SQLite 3.37.0 而非 Bun 內建版本
- 驗證方式：`SELECT sqlite_version(); PRAGMA compile_options;` 確認各目標 OS 上 FTS5 是否啟用
- 遷移範圍：8 個 migration、FTS5 觸發器、所有 prepared statement 語法、Transaction API

> **AI 觀點分歧**：Gemini 認為 bun:sqlite FTS5 預設啟用；Codex 做了實際 web search 後認為未明確保證。以 Codex 的證據為準。

### 2. 系統 Webview vs Chromium

**結論：Markdown/程式碼高亮可行，但跨平台一致性是風險。**

| 平台 | Webview 引擎 | 風險 |
|------|-------------|------|
| macOS | WKWebView (WebKit) | CSS 排版差異、字體渲染不同 |
| Windows | WebView2 (Chromium-based) | 渲染接近 Electron，風險低 |
| Linux | WebKitGTK | 版本隨發行版走，最不可控 |

- highlight.js、react-markdown、recharts 均為純 JS，理論上跨引擎相容
- 但繁中 UI 的 CJK 字體 fallback、行高計算、排版在 WebKit vs Chromium 間可能不同
- Electron 的核心優勢：**所有平台渲染行為完全一致**

### 3. Windows CJK 支援 — Hard Blocker

**[Issue #335](https://github.com/blackboardsh/electrobun/issues/335): 所有非 ASCII 文字在 Windows 上亂碼。**

- 開 issue 日期：2026-03-22
- 截至 2026-04-02 **官方回應：0 comments，無標籤，無任何動靜**
- 同期間維護者：更新 README showcase、發布 v1.17.0 和 v1.17.1 兩個版本
- Root cause：Zig/C++ native layer 使用 ANSI Win32 API (`AppendMenuA`) 而非 Unicode (`AppendMenuW`)
- 修復方案已在 issue 中詳細說明（UTF-8 → UTF-16LE 轉換 + Wide API）
- **無應用層 workaround**
- 影響範圍：Application Menu、File Dialog — 涵蓋所有含非 ASCII 文字的原生 UI 元素

> 對於全繁中 UI 的 ccRewind，此 issue 為 **showstopper**。且官方對 i18n 議題的零回應態度是重要信號。

### 4. 生產就緒度

**結論：尚未達到生產級。**

- 所有 release 皆為 beta，無 stable 版本
- 基礎 UI 問題仍未修復：
  - [#355](https://github.com/blackboardsh/electrobun/issues/355): macOS traffic light insets 無法調整
  - [#357](https://github.com/blackboardsh/electrobun/issues/357): DevTools 造成 webview scroll 異常
  - [#347](https://github.com/blackboardsh/electrobun/issues/347): traffic light buttons 大小異常
  - [#340](https://github.com/blackboardsh/electrobun/issues/340): Template 建立失敗
- Codex 評語："not yet boring enough" — 對於已上線的桌面應用，框架應該是無聊而穩定的

### 5. 遷移成本估算

| 模組 | 工作量 | 說明 |
|------|--------|------|
| Database 層 | 2-3 天 | better-sqlite3 → bun:sqlite API、8 個 migration、FTS5 |
| IPC 層 | 1-2 天 | Electron invoke/handle → Electrobun typed RPC |
| Build 系統 | 1 天 | electron-vite → Electrobun bundler、打包設定 |
| 測試基礎 | 1-2 天 | vitest (ELECTRON_RUN_AS_NODE) → bun:test |
| UI 調整 | 1+ 天 | WebKit CSS 差異、CJK 排版回歸 |
| 打包分發 | 1 天 | codesign 流程重建 |
| **合計** | **7-10 天（保守）** | 不含踩 beta bug 的時間 |

對比：v1.5.0 自動更新在 Electron 生態下估計 2-3 天。

### 6. 收益 vs 風險

| 收益 | 風險 |
|------|------|
| Bundle 180MB → ~12MB | Windows CJK 亂碼，無 workaround |
| 啟動速度提升 | 全 beta，API 隨時可能 breaking change |
| bsdiff 增量更新 ~14KB | 跨平台渲染不一致 |
| Bun 原生 TS，去除 electron-vite | 172 個測試需遷移 runner |
| 統一 TS/Bun 技術棧 | 社群小，遇到問題只能等 upstream |

### 7. 替代方案

| 框架 | 評價 |
|------|------|
| **Tauri v2** | 最成熟的系統 webview 替代方案，但需 Rust backend。社群近期有多個專案回遷 Electron 的案例，系統 webview 的跨平台一致性問題是共通痛點 |
| **Neutralinojs** | 過於輕量，無深度 SQLite 整合，不適合 ccRewind |
| **Electron (維持)** | 生態成熟、CJK 零問題、渲染一致、自動更新方案完善。180MB 是代價，但對開發者工具而言可接受 |

## Decision

**維持 Electron 架構，不遷移。**

核心理由：
1. Electrobun 全 beta + Windows CJK blocker + 官方對 i18n 零回應
2. ccRewind 是低頻使用的開發者工具，bundle size 不是核心痛點
3. 遷移 7-10 天的成本換來的收益無法證明 ROI
4. Electron 正在穩定地解決我們的問題，不是需要被替換的問題

## 重新評估條件

滿足以下**全部**條件時，值得重新評估：

- [ ] Electrobun 發布第一個 non-beta stable release
- [ ] Issue #335 (Windows Unicode) 已修復並發布
- [ ] bun:sqlite FTS5 在官方文件中明確支援
- [ ] 至少 3 個月無重大 breaking change

## 附錄：如果要做 POC

開 `experiment/electrobun-poc` branch，預算 1-2 天，驗證清單：

1. `bun:sqlite` 唯讀開啟現有 ccRewind SQLite DB
2. 各目標 OS 上執行 `SELECT sqlite_version(); PRAGMA compile_options;` 確認 FTS5
3. 渲染真實的 Markdown + 程式碼高亮 view
4. **Windows 上測試繁體中文 UI**（menu、dialog、webview 內容）
5. 打包一個 signed build + 一次 bsdiff 更新流程

任一項失敗即判定 no-go。
