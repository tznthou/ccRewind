#!/usr/bin/env bash
# 從 CHANGELOG.md 抽出指定版本的段落，組成 GitHub Release 的說明文字。
#
# 為什麼要有這支：release.yml 原本的 notes 是寫死的模板，只有安裝說明，
# 完全不含這一版改了什麼。v1.21.3 含安全更新，使用者在 Release 頁卻看不出來，
# 兩次都靠事後 `gh release edit --notes-file` 手動補。
#
# 為什麼是獨立檔案而不是寫在 workflow 裡：inline 的 shell 只能靠發版當下驗證，
# 而發版當下正是最不想除錯的時刻。抽出來才能在本地跑正向與負向測試。
#
# 用法: release-notes.sh <version> [changelog-path]
#   version 可帶或不帶 v 前綴（v1.22.0 與 1.22.0 等價）
#
# 抽不到內容時以 exit 1 結束，不會輸出空的說明——靜默產生空 notes 會讓
# 「CHANGELOG 忘了寫」看起來跟成功一模一樣。

set -euo pipefail

VERSION_RAW="${1:-}"
CHANGELOG="${2:-CHANGELOG.md}"

if [ -z "$VERSION_RAW" ]; then
  echo "用法: $0 <version> [changelog-path]" >&2
  exit 2
fi

if [ ! -f "$CHANGELOG" ]; then
  echo "ERROR: 找不到 $CHANGELOG" >&2
  exit 1
fi

# v1.22.0 → 1.22.0。CHANGELOG 的標題不帶 v，tag 帶。
VERSION_NUM="${VERSION_RAW#v}"
# 顯示用的版本一律補回 v，否則傳入不帶 v 時標題會與 tag 名不一致。
DISPLAY_VERSION="v${VERSION_NUM}"

# 抽出 `## [X.Y.Z]` 到下一個 `## [` 之間的內容（不含這兩行標題本身）。
#
# 這裡刻意用字串前綴比對而不是 regex：版本號含 `.`，而反斜線要穿過
# shell 引號、awk -v 的跳脫序列處理、再到 regex 引擎，中間 awk -v 那層會把
# `\.` 還原成 `.`——實測 1.0.0 因此匹配到 1x0y0。index() 沒有這個問題。
# `## [1.0.0]` 不會是 `## [1.0.0-beta]` 的前綴（第 10 個字元一個是 `]` 一個是 `-`），
# 所以前綴比對對預發布版號一樣安全。
SECTION="$(awk -v hdr="## [${VERSION_NUM}]" '
  index($0, hdr) == 1 { found = 1; next }
  found && /^## \[/ { exit }
  found { print }
' "$CHANGELOG")"

# 只有空白字元也算沒抽到——標題存在但底下是空的，一樣不該發出去。
if [ -z "$(printf '%s' "$SECTION" | tr -d '[:space:]')" ]; then
  echo "ERROR: $CHANGELOG 裡沒有 [$VERSION_NUM] 的內容。發版前請先補上該版本的段落。" >&2
  exit 1
fi

cat <<HEADER
## ccRewind ${DISPLAY_VERSION}

Claude Code 對話回放與考古工具

### 本版變更
HEADER

printf '%s\n' "$SECTION"

cat <<'FOOTER'
完整記錄：[CHANGELOG.md](https://github.com/tznthou/ccRewind/blob/main/CHANGELOG.md)（中文）／[CHANGELOG_EN.md](https://github.com/tznthou/ccRewind/blob/main/CHANGELOG_EN.md)（English）

---

### 安裝

**macOS**

- **DMG**（建議）：拖曳至 Applications 即可
- **ZIP**：解壓後直接執行

**Windows**

- **EXE**：安裝程式
- **ZIP**：解壓後直接執行

> ⚠️ **macOS**：首次開啟時可能顯示「無法驗證開發者」警告。
> 請至「系統設定 → 隱私與安全性」，找到 ccRewind 並點擊「仍要打開」即可。
>
> ⚠️ **Windows**：首次執行時會顯示 SmartScreen「Windows 已保護您的電腦」警告。
> 請點擊「其他資訊」→「仍要執行」即可。

System requirements: macOS 11+ / Windows 10+
FOOTER
