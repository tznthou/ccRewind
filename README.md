# ccRewind

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-3178C6.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19+-61DAFB.svg)](https://reactjs.org/)
[![Electron](https://img.shields.io/badge/Electron-33+-47848F.svg)](https://www.electronjs.org/)

[English](README_EN.md)

Claude Code 對話回放與考古工具——輕量、只讀、離線優先的桌面應用程式，讓你回顧與 Claude Code 的每一次協作對話。

<p align="center">
  <img src="docs/icon-github.png" alt="ccRewind" width="128" />
</p>

<p align="center">
  <img src="docs/preview-app.webp" alt="ccRewind 應用程式預覽" width="480" />
  <img src="docs/preview-brand.webp" alt="ccRewind 品牌形象" width="480" />
</p>

---

## 核心概念

ccRewind 讀取 `~/.claude/projects/` 下的 JSONL 對話紀錄，建立 SQLite + FTS5 索引，提供瀏覽、搜尋、匯出功能。

不做 LLM 摘要、不做 context injection、不做 RAG。Session 摘要和標籤由純規則產生，零 API 成本。

所有操作都是唯讀的——ccRewind 絕不修改 `~/.claude/` 下的任何檔案。你的對話紀錄、記憶檔案、設定檔，一個位元組都不會動。

---

## 功能特色

| 功能 | 說明 |
|------|------|
| **對話瀏覽** | user/assistant 氣泡介面，Markdown 渲染 + 程式碼語法高亮 |
| **三主題切換** | 檔案室（Archive）、時間線（Timeline）、終端回憶（Terminal），一鍵切換 |
| **Tool 摺疊** | tool_use / tool_result 預設摺疊，點擊展開查看完整內容 |
| **Session 自動摘要** | 索引時自動產生意圖摘要、標籤（bug-fix, refactor 等）、涉及檔案清單、工具使用統計 |
| **全文搜尋** | FTS5 索引，分頁載入，結果按 session 分組，支援「對話」與「標籤/檔案」兩種搜尋模式 |
| **搜尋上下文預覽** | 搜尋結果可展開顯示前後 2 則訊息，不用跳轉就能快速判斷相關性 |
| **資料保全** | JSONL 被刪除時自動封存對話，不丟失任何歷史紀錄 |
| **Markdown 匯出** | 一鍵將 session 匯出為 `.md` 檔案，含 metadata 表格 + tool 摺疊 |
| **更新通知** | 啟動時自動偵測 GitHub 新版本，一鍵開啟下載頁面 |
| **增量索引** | 首次啟動掃描所有 JSONL，後續僅處理新增/修改的檔案 |
| **DB 自動遷移** | schema 變更時自動升級，大型資料庫無痛升版 |
| **虛擬捲動** | 大量 session 不卡頓（@tanstack/react-virtual） |
| **無障礙** | WCAG 2.1 AA 對比度、ARIA 標籤、鍵盤導覽、焦點管理 |

---

## 使用說明

### Session 摘要與標籤

每個 session 在索引時會自動產生：

- **意圖摘要**：擷取首尾 user 訊息，一眼看出這次對話在做什麼
- **自動標籤**：根據對話內容關鍵字推斷——`bug-fix`、`refactor`、`testing`、`deployment`、`auth`、`ui`、`docs`、`config`
- **涉及檔案**：從 tool_use 的 Read/Edit/Write 呼叫中提取實際操作過的檔案路徑
- **工具統計**：顯示 `Read:15, Edit:8, Bash:5` 這類使用頻率

標籤和檔案數會直接顯示在 session 列表項目上，不需要點進去就能掌握每個 session 的性質。

### 搜尋

ccRewind 提供兩種搜尋模式，在搜尋列右側的 radio 按鈕切換：

- **對話**（預設）：搜尋訊息內容，結果按 session 分組顯示。每筆結果左側有 ▸ 按鈕，點擊可展開前後 2 則訊息的上下文預覽，不用跳轉就能判斷是否相關
- **標籤/檔案**：搜尋 session 的標題、標籤、涉及檔案路徑和摘要。適合「我上次改 auth.ts 是哪個 session？」或「所有標記為 bug-fix 的對話」這類查詢

兩種模式都支援「全部專案 / 目前專案」的範圍篩選。

---

## 系統架構

```mermaid
graph TB
    subgraph Main Process
        FS[檔案掃描器<br>~/.claude/projects/] --> JP[JSONL Parser]
        JP --> DB[(SQLite + FTS5)]
        DB --> IPC[IPC Handlers]
        EX[Markdown 匯出器] --> IPC
    end

    subgraph Renderer Process
        SB[Sidebar<br>專案選擇 + Session 清單 + 搜尋]
        CV[ChatView<br>對話閱讀器 + 匯出按鈕]
    end

    IPC <-->|invoke / handle| SB
    IPC <-->|invoke / handle| CV
```

---

## 技術棧

| 技術 | 用途 | 備註 |
|------|------|------|
| Electron 33 | 桌面應用框架 | macOS hiddenInset title bar |
| React 19 | UI 框架 | 函式元件 + hooks |
| TypeScript 5.9 | 型別安全 | strict mode |
| better-sqlite3 11 | SQLite binding | 含 FTS5 全文搜尋 |
| electron-vite 5 | 建構工具 | main + preload + renderer 三路建構 |
| Vitest 3 | 測試框架 | 118 個測試，透過 Electron 執行 |

---

## 快速開始

### 環境需求

- Node.js >= 20, < 23
- pnpm >= 9

### 安裝與啟動

```bash
git clone https://github.com/tznthou/ccRewind.git
cd ccRewind
pnpm install
pnpm dev
```

### 建構發布

```bash
pnpm build
pnpm dist
```

### 其他指令

```bash
pnpm test        # 執行測試（透過 Electron 跑 Vitest）
pnpm typecheck   # TypeScript 型別檢查
pnpm lint        # ESLint 修正
```

---

## 專案結構

```
ccRewind/
├── src/
│   ├── main/                  # Electron main process
│   │   ├── index.ts           # 應用程式入口
│   │   ├── scanner.ts         # 專案 / session 檔案掃描
│   │   ├── parser.ts          # JSONL 解析器
│   │   ├── database.ts        # SQLite + FTS5 管理（含 sessions_fts）
│   │   ├── indexer.ts         # 增量索引器
│   │   ├── summarizer.ts      # Session 自動摘要（heuristic）
│   │   ├── exporter.ts        # Markdown 匯出
│   │   ├── updater.ts         # GitHub Release 更新偵測
│   │   └── ipc-handlers.ts    # IPC 通訊處理
│   ├── preload/               # contextBridge 安全橋接
│   │   └── index.ts
│   ├── renderer/              # React 前端
│   │   ├── App.tsx            # 根元件
│   │   ├── components/
│   │   │   ├── Sidebar/       # 專案選擇 + Session 清單 + 搜尋
│   │   │   ├── ChatView/      # 對話閱讀器 + 匯出按鈕
│   │   │   ├── ThemeSwitcher/ # 三主題切換按鈕
│   │   │   └── UpdateBanner/  # 更新通知橫幅
│   │   ├── hooks/             # useSession, useSessions, useProjects
│   │   └── context/           # AppContext + ThemeContext（主題持久化）
│   └── shared/
│       └── types.ts           # 主程序與渲染程序共用型別
├── tests/                     # Vitest 測試（118 個）
├── docs/                      # PRD / SPEC / PLAN
├── electron-builder.yml
└── package.json
```

---

## 隨想

### 為什麼做這個

跟 Claude Code 協作的對話散落在 `~/.claude/projects/` 底下，每個 session 是一個 JSONL 檔案。想回頭看三天前的設計決策？得記得是哪個 session、手動 `cat` JSONL、在密密麻麻的 JSON 裡找到那段對話。

現有的方案要嘛太重（RAG、向量搜尋），要嘛方向不對（記憶注入、context 管理）。我只是想安靜地回顧過去的對話，像翻閱考古現場的筆記本一樣。

所以 ccRewind 就是這個：一本有索引的考古筆記本。

### Non-goals

ccRewind 刻意不做這些事：

- **不呼叫 LLM**——摘要和標籤全部由規則產生，零 API 成本、零隱私風險
- **不做 context injection**——不干預未來的對話，只回顧過去的
- **不做雲端同步**——所有資料來自本地 `~/.claude/`，不上傳任何東西
- **不修改任何檔案**——純唯讀應用，連 `~/.claude/` 的 mtime 都不會動
- **不做即時監控**——不是 tail -f，是考古學

如果你需要的是「讓 Claude 記住之前說過什麼」，去看 claude-mem 之類的記憶系統。ccRewind 解決的是不同的問題：讓人類回顧與 AI 的協作歷史。

---

## 授權

本專案採用 [AGPL-3.0](LICENSE) 授權。

---

## 作者

子超 (tznthou) — [tznthou.com](https://tznthou.com)
