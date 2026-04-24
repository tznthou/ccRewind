# ccRewind 5 分鐘上手

> 返回 [README](../README.md) · 功能細節見 [USER-GUIDE](USER-GUIDE.md)

這份指南帶你從安裝到完成第一次瀏覽、搜尋與匯出。預期時間 5 分鐘。

---

## 開始前

| 項目 | 需求 |
|------|------|
| 作業系統 | macOS 11+（arm64） / Windows 10+（x64） |
| 先決條件 | 曾經使用過 Claude Code，`~/.claude/projects/` 下已有 JSONL 紀錄 |
| 時間 | 5 分鐘 |

ccRewind 只讀取你的對話歷史，不會修改 `~/.claude/` 下任何檔案，也不會上傳資料。索引建在本地的 `~/.ccrewind/index.db`。

---

## 1. 下載安裝（1 分鐘）

到 [Releases](https://github.com/tznthou/ccRewind/releases) 下載對應平台的版本：

- **macOS**：`ccRewind-<version>-arm64.dmg` 拖曳到 Applications，或 `arm64.zip` 解壓後直接執行
- **Windows**：`ccRewind-Setup-<version>-x64.exe` 安裝，或 `win-x64.zip` 解壓後執行

### 首次啟動會看到系統警告

ccRewind 目前未購買 Apple Developer ID / Microsoft 程式碼簽章，第一次開啟作業系統會顯示未簽章警告，這是正常行為：

- **macOS**：出現「無法驗證開發者」時，打開「系統設定 → 隱私與安全性」，滑到底部找到 ccRewind，點擊「仍要打開」
- **Windows**：SmartScreen 顯示「Windows 已保護您的電腦」時，點「其他資訊」→「仍要執行」

---

## 2. 首次啟動與索引（1–2 分鐘）

啟動後 ccRewind 自動掃描 `~/.claude/projects/` 並建立索引。Sidebar 底部會顯示進度條，依序跑三個階段：

| 階段 | 意思 |
|------|------|
| 掃描中 | 列出所有 JSONL 檔案 |
| 解析中 | 讀入訊息、抽工具使用、算 token 統計 |
| 索引中 | 寫入 SQLite + FTS5 全文索引 |

典型速度：**500 sessions 首次索引約 30 秒**，大型資料庫可能一兩分鐘。你不用等它跑完才開始用——專案清單會即時浮現，已索引完的 session 立刻可瀏覽。

之後每次啟動只處理新增/修改的 JSONL（增量索引），秒開。

---

## 3. 打開第一個 Session（1 分鐘）

介面分兩欄：

- **左側 Sidebar**：專案清單 + 某專案下的 Sessions 清單 + 搜尋列
- **主畫面**：選中 Session 的對話內容

操作流程：

1. Sidebar「專案」區點選一個專案，下方 Sessions 清單會列出該專案所有對話（日期倒序）
2. 每個 Session 列表項目直接顯示：日期、推導標題、outcome badge（committed / tested / in-progress / quick-qa）、時長、涉及檔案數、標籤、token 總量
3. 點任一筆打開 ChatView：
   - user / assistant 氣泡介面
   - Markdown 與程式碼語法高亮
   - tool_use / tool_result 預設摺疊，點擊展開
   - assistant 訊息左側有 token 熱力色碼條（綠=cache 命中佳、紅=高成本）

### 把對話存成 Markdown

ChatView 工具列點「匯出」會開系統儲存對話框，存成 `.md` 檔；tool 內容用 `<details>` 標籤摺疊，metadata 寫在檔頭。

### 打開 Token Budget 面板

對話頂部的 **Show Token Budget** 按鈕會展開 Context Budget 面板，包含 Summary Cards、Context Growth 面積圖、Token Breakdown 圓餅圖、Output Intensity 熱力條，以及自動解讀的 Insights。第一次打開可以直接看 Insights，它會用白話告訴你「這個 Session 的 token 怎麼燒的、cache 有沒有命中」。

---

## 4. 第一次搜尋（1 分鐘）

Sidebar 最上方的搜尋列支援兩種模式（右側 radio 切換）：

| 模式 | 搜什麼 | 適合 |
|------|--------|------|
| **對話**（預設） | 訊息內容 | 「我上次怎麼解釋 FTS5？」 |
| **標籤/檔案** | Session 標題、標籤、檔案路徑、摘要、意圖 | 「我上次改 auth.ts 是哪個 Session？」 |

搜尋列下方還有兩個篩選：

- **日期範圍**：不限 / 7 天 / 30 天 / 90 天
- **排序**：相關性（FTS5 rank） / 最新優先

對話模式下每筆結果左側的 **▸** 按鈕可展開前後 2 則訊息的上下文，不跳轉就能判斷相關性。點擊結果會直接跳到該 Session 並捲動到匹配位置。

> **Tip**：檔名、函式名、路徑這類含 `.-/` 的關鍵字，ccRewind 會自動加引號精確搜。

---

## 5. 切換主題 · Dashboard · Storage

右上角標題列有三個按鈕：

- **Dashboard**（四格方塊圖示）：跨 Session 分析儀表板——使用趨勢、專案健康度、浪費偵測、工具/標籤分佈、工作模式熱力圖
- **Storage**（圓柱圖示）：索引資料庫管理——DB 大小、專案佔用、排除規則、資料庫壓縮
- **ThemeSwitcher**：三種主題一鍵切換——檔案室 Archive / 時間線 Timeline / 終端回憶 Terminal

---

## 下一步

- **每個功能的詳細用法** → [USER-GUIDE.md](USER-GUIDE.md)
- **跨 Session 考古**：ChatView 工具列的 File Chips 點檔案看它在哪些 Session 出現過；對話底部 Related Sessions 基於檔案交集推薦相關對話
- **儲存佔用大了想清理** → USER-GUIDE 的「儲存管理」章節

---

## 常見疑問

**會不會改到我的 Claude Code 資料？**
不會。ccRewind 是純唯讀應用，絕不修改 `~/.claude/` 下任何檔案。所有索引寫在 `~/.ccrewind/index.db`。

**索引要多久？**
首次約 30 秒 / 500 sessions。後續啟動只處理新增/修改檔案，通常秒完。

**Claude Code 刪掉的 Session 還看得到嗎？**
看得到。JSONL 被刪時 ccRewind 會自動封存該筆對話，所有訊息、標籤、摘要都留在索引裡，不會隨原始檔案消失。

**資料存哪裡？想整個重來怎麼做？**
索引資料庫在 `~/.ccrewind/index.db`（macOS / Linux）或對應的 home 目錄。刪掉整個 `~/.ccrewind/` 資料夾，下次啟動會從零重建。

**沒有 API Key 可以用嗎？**
可以。所有核心功能（瀏覽、搜尋、摘要、標籤、Dashboard、匯出）都是本地規則引擎生成，零 API 成本。未來 BYOK 模式會是可選的加值選項。
