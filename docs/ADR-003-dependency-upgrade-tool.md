# ADR-003: GitHub 依賴升級工具選型

> **Status**: Accepted（決策已下，待動工）
> **Date**: 2026-05-19
> **Evaluators**: Claude Opus 4.7 + Codex（GPT-5）+ Gemini 2.5 Pro（多模型平行徵詢）
> **Decision**: 採 **Renovate**（hosted GitHub App），不採 Dependabot version PRs，不做 Hybrid 雙 bot
> **動工時機**: 2026-05-21 後（等 v1.13.0 Tasks Panel dogfood 滿）

## Context

ccRewind 至今沒有自動依賴升級工具。`.github/workflows/` 只有 `release.yml`（tag 觸發 build mac+win artifacts）。

觸發點：

1. 依賴老化 — 約 25 個 deps（9 direct + 16 devDeps），solo maintainer 沒餘力手動巡邏
2. 安全 CVE — 沒有自動 patch 通道，要靠人眼追 GitHub Advisory
3. pnpm-lock.yaml 自然漂移 — 沒有定期 refresh 機制
4. **Electron 33 + better-sqlite3 native module 高風險** — major 升級會動 Chromium + Node ABI，是「絕對不能 auto-merge」的特殊類別

關鍵問題：**通用建議「裝 Dependabot 就好」對 Electron + native module 場景不夠用**——需要把 Electron stack 跟其他 deps 區分對待。

## 評估對象

### 三條路盤點

| 方案 | 機制 | 維護方 |
|---|---|---|
| **GitHub Dependabot** | GitHub 原生，免安裝，`.github/dependabot.yml` 配置 | GitHub |
| **Renovate** | 第三方 GitHub App，`renovate.json` 配置 | Mend.io（前 WhiteSource） |
| **Hybrid（Dependabot 安全 + Renovate 例行）** | 兩個 bot 並存，分工 | — |

### 評估方法

2026-05-19 透過多模型平行徵詢（`/pi-askall` 同時問 Codex + Gemini，Claude 綜合）。三家對 ccRewind 場景做完整分析後綜合結論。完整對話可從 ccRecall 查 `2026-05-19` session。

### 對比矩陣

| 維度 | Dependabot | Renovate | Hybrid |
|---|---|---|---|
| GitHub 整合 | 原生免安裝 | 安裝 App | 雙重 |
| Grouping 粒度 | v2 有，但弱 | packageRules 細到 packageName-level | — |
| 排程 | 簡單（daily/weekly） | timezone-aware + minimumReleaseAge + prHourlyLimit | — |
| `lockFileMaintenance` 原生 | ❌（要 workaround） | ✅ 內建 | — |
| Dashboard approval 半擋機制 | ❌ | ✅ 對 Electron 這種「絕對不能自動 merge」群完美 | — |
| Security CVE fast-track | ✅（內建） | ✅（vulnerabilityAlerts + osvVulnerabilityAlerts） | ✅ |
| Auto-merge 規則彈性 | matchUpdateTypes 級 | matchUpdateTypes + matchPackageNames + matchManagers 多維 | — |
| Lockfile contention 風險 | 單 bot 無風險 | 單 bot 無風險 | **高**（兩個 bot 改 pnpm-lock.yaml） |
| 設定成本 | 5 分鐘 | 30 分鐘 | 兩者相加 + 協調 |

### Codex 與 Gemini 共識

兩家獨立分析後**完全共識**選 Renovate，理由收斂在四點：

1. Electron + better-sqlite3 必須走 `dependencyDashboardApproval` 機制，Dependabot 沒有對等功能
2. 25 個 deps × solo maintainer → 需要細粒度 grouping + weekly schedule 控洪水，Renovate packageRules 比 Dependabot 強
3. pnpm-lock.yaml 維護 → Renovate 原生 `lockFileMaintenance`
4. Hybrid 會踩 lockfile contention（兩家都明確反對）

### 兩家都點到的關鍵 gotcha

**「CI 綠 ≠ packaged app 能跑」**：

- vitest 已經跑在 Electron Node binary 下（`ELECTRON_RUN_AS_NODE=1`），native ABI 對齊比一般專案好（見 `feedback_native_module_abi` memory）
- 但 vitest 沒涵蓋 `electron-builder` packaging + asar + macOS ad-hoc codesign（見 `feedback_macos_codesign` memory）
- → 必須加 `electron-smoke.yml` workflow，對 Electron stack PR 跑 `pnpm dist` mac+win

## Decision

採 Renovate（hosted GitHub App），配置原則：

### `renovate.json` 骨架

```jsonc
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended", ":semanticCommits"],
  "timezone": "Asia/Taipei",
  "schedule": ["before 10am on monday"],
  "minimumReleaseAge": "3 days",
  "prHourlyLimit": 1,
  "prConcurrentLimit": 3,
  "rangeStrategy": "bump",
  "platformAutomerge": true,

  "major": { "dependencyDashboardApproval": true },

  "lockFileMaintenance": {
    "enabled": true,
    "schedule": ["before 6am on monday"],
    "automerge": true
  },

  "vulnerabilityAlerts": {
    "labels": ["security", "dependencies"],
    "vulnerabilityFixStrategy": "lowest"
  },
  "osvVulnerabilityAlerts": true,

  "packageRules": [
    {
      "description": "Electron/native stack 永遠手動",
      "matchPackageNames": [
        "electron", "better-sqlite3",
        "electron-builder", "electron-vite"
      ],
      "groupName": "Electron/native stack",
      "dependencyDashboardApproval": true,
      "automerge": false
    },
    {
      "description": "TypeScript / @types 拉出單獨手動 review（雙 typecheck 對 type literal 變動敏感）",
      "matchPackageNames": ["typescript", "/^@types\\//"],
      "groupName": "TypeScript 生態",
      "automerge": false
    },
    {
      "description": "低風險 patch 可 automerge",
      "matchUpdateTypes": ["patch"],
      "matchPackageNames": [
        "@tanstack/react-virtual", "highlight.js",
        "react-markdown", "recharts",
        "rehype-highlight", "rehype-sanitize", "remark-gfm",
        "react", "react-dom",
        "vite", "vitest",
        "eslint", "/^@eslint\\//", "/^@typescript-eslint\\//"
      ],
      "groupName": "safe patch dependencies",
      "automerge": true
    },
    {
      "description": "Minor 先 group 不 automerge（觀察一個月後再放寬）",
      "matchUpdateTypes": ["minor"],
      "groupName": "safe minor dependencies",
      "automerge": false
    },
    {
      "description": "GitHub Actions 獨立",
      "matchManagers": ["github-actions"],
      "matchUpdateTypes": ["minor", "patch"],
      "groupName": "GitHub Actions",
      "automerge": false
    }
  ]
}
```

### 配套工程改動

1. **`package.json` 加 `"packageManager": "pnpm@<current-version>"`** — 鎖定 pnpm 版本，降低 lockfile churn
2. **新增 `.github/workflows/electron-smoke.yml`** — 對 Electron stack PR 跑：
   - `pnpm install --frozen-lockfile`
   - `pnpm exec electron-rebuild -f -o better-sqlite3`
   - Electron in-memory better-sqlite3 query 驗 native binding
   - `pnpm dist`（mac + win）驗 packaging
3. **GitHub branch protection 設 required status checks**：vitest / node typecheck / web typecheck / electron-smoke
4. **啟用 GitHub Dependency Graph + Dependabot alerts**（不啟用 Dependabot version PRs）— Renovate 從這裡讀 CVE 訊號

### 動工順序（2026-05-21 後）

1. 開 `feat/renovate` branch
2. 寫 `renovate.json` + `electron-smoke.yml` + 更新 `package.json`
3. PR 過 CI + 雙 typecheck + 458 tests + electron-smoke
4. branch protection 啟用 required checks
5. GitHub repo 設定安裝 Renovate App
6. 觀察第一週 PR 行為（patch automerge + minor manual + Electron dashboard approval）
7. 一個月後評估是否把 safe minor 也放 automerge

## 未選 Dependabot 的原因

- grouping v2 有但比 Renovate 弱（Renovate `matchPackageNames` + `matchUpdateTypes` + `matchManagers` 三維組合）
- 沒有 `lockFileMaintenance` 原生對應（pnpm-lock 維護要 workaround）
- 沒有 `dependencyDashboardApproval` 半擋機制（Electron major 只能靠 ignore 條目，無法「進入 review 但要審才開 PR」）
- `minimumReleaseAge` / `prHourlyLimit` / timezone-aware schedule 等細控弱
- 但**保留 Dependabot alerts**（只關 version PRs，alerts 留著餵 Renovate 的 vulnerabilityAlerts）

## 未做 Hybrid 的原因

兩家獨立評估後同時點出：

- 兩個 bot 同時改 `pnpm-lock.yaml` 會 lockfile contention
- 同一個 CVE 可能 duplicate PRs（Dependabot 開一個、Renovate 開一個）
- 兩套 grouping policy 難協調（哪個 dep 歸哪個 bot 管的邊界模糊）
- Renovate 已能透過 `vulnerabilityAlerts` + `osvVulnerabilityAlerts` 涵蓋 GitHub Advisory Database，安全層面不需要 Dependabot version PRs 補位

## Trigger conditions for re-evaluation

下列情境出現任一時重啟此 ADR：

1. **Renovate App 政策變動**：Mend.io 收費模式變更 / 開源版本停更 / 政策影響中型 OSS 使用權
2. **Lockfile contention 之外的 Hybrid 障礙解除**：例如 GitHub 提供 bot 協調 API，可以解決 duplicate PRs
3. **Dependabot 推出對等 `lockFileMaintenance` + `dependencyDashboardApproval`**：第一方優勢可能反超
4. **ccRewind 棄用 Electron 改 Tauri / Wails**：native module ABI 限制不同，整套評估前提失效

## Related references

### Memory（私人 context）

- `~/.claude/projects/-Users-tznthou-Documents-ccRwind/memory/project_renovate_decision.md` — 本決策完整 why + how，含 Codex/Gemini 共識細節
- `~/.claude/projects/-Users-tznthou-Documents-ccRwind/memory/feedback_native_module_abi.md` — `ELECTRON_RUN_AS_NODE=1` ABI 對齊機制
- `~/.claude/projects/-Users-tznthou-Documents-ccRwind/memory/feedback_macos_codesign.md` — afterPack ad-hoc codesign
- `~/.claude/projects/-Users-tznthou-Documents-ccRwind/memory/feedback_electron_rebuild.md` — pnpm add 後 electron-rebuild
- `~/.claude/projects/-Users-tznthou-Documents-ccRwind/memory/feedback_typecheck_project_references.md` — 雙 typecheck 對 type literal 敏感

### 官方文件

- [Renovate Configuration Options](https://docs.renovatebot.com/configuration-options/)
- [Renovate platform automerge](https://docs.renovatebot.com/configuration-options/#platformautomerge)
- [Renovate lockFileMaintenance](https://docs.renovatebot.com/configuration-options/#lockfilemaintenance)
- [Renovate vulnerabilityAlerts](https://docs.renovatebot.com/configuration-options/#vulnerabilityalerts)
- [GitHub Dependabot options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)

### Adjacent ADR

- [ADR-001: Electrobun 架構遷移評估](./ADR-001-electrobun-migration.md) — 同樣 dogfood-driven 評估框架
- [ADR-002: FTS5 CJK Tokenizer 強化方案評估](./ADR-002-fts5-cjk-evaluation.md) — 多模型平行徵詢的先例
