# ccRewind — Claude Code 對話回放與考古工具

## 指令

- dev: `pnpm dev`
- build: `pnpm build`
- test: `pnpm vitest run`
- lint: `pnpm eslint . --fix`
- dist: `pnpm dist`（打包 Electron 應用）

## 接續

- 新 session 開始前，先讀取 `.claude/RESUME.md`

## 工作流程

- branch: `feat/xxx`, `fix/xxx`, `refactor/xxx`
- commit 前通過 typecheck + lint
- PR 需附上改動摘要

## 技術約束

- Electron main process 使用 better-sqlite3（同步 API），不用 sql.js
- React 使用函式元件 + hooks，不用 class component
- IPC 通訊一律用 invoke/handle 模式（Promise-based），不用 send/on
- 所有檔案路徑操作使用 Node.js path module，不硬編碼路徑分隔符
- 純唯讀應用——絕對不修改 `~/.claude/` 下的任何檔案
- JSONL parser 採寬容模式：未知結構保留 raw JSON，不中斷解析

## 測試誠信

- **測試紅了先修程式**：測試失敗時，先假設是程式邏輯有問題去查程式碼。只有確認是測試預期定義錯誤才改測試，且要說明為什麼改
- **禁止倒果為因**：絕不為了讓測試通過而修改測試的斷言。測試定義「什麼是正確的」，程式去符合它
- **先寫測試、後寫實作**：test 先定義預期行為，再寫程式去通過
- **測試不碰生產資料**：使用 mkdtemp 隔離，不操作真實 `~/.claude/` 或 `~/.ccrewind/`

## 參考文件（需要時再讀）

- 使用者故事與需求: `docs/PRD.md`
- 系統架構與資料模型: `docs/SPEC.md`
- 實作路線圖與 task 清單: `docs/PLAN.md`
