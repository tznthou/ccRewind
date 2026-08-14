/**
 * remote-control 連線的 bridgeSessionId → claude.ai 網址。
 *
 * 規律：JSONL 的 bridge-session entry 帶 `cse_<id>`，同一場對話在 claude.ai 上的網址是
 * `https://claude.ai/code/session_<同一個 id>`。2026-08-14 以兩個 session 驗證，其中一個
 * 是先由 bridgeSessionId 推導出網址、再實際開啟確認內容相符。
 *
 * ⚠️ 只有原檔還在的 session 拿得到這個值。DB 裡既有的 bridge-session 訊息內容全是 NULL，
 * 沒有回填來源；而 Claude Code 預設 30 天清理 JSONL，所以歷史 session 多半永遠是 null。
 */

/** id 主體：claude.ai 的 session id 是 24 碼英數字，這裡放寬到 16–64 容納未來變動。 */
const BRIDGE_ID_RE = /^cse_([A-Za-z0-9]{16,64})$/

/**
 * 組出可點的 claude.ai 連結；格式不符或沒有值時回 null。
 *
 * 採白名單而非字串拼接：bridgeSessionId 讀自 JSONL，屬於外部輸入。含 `../`、`?`、`@` 或
 * 冒號的值若直接串進網址，點下去會把使用者帶到非預期的網站。
 */
export function buildRemoteControlUrl(bridgeSessionId: string | null | undefined): string | null {
  if (!bridgeSessionId) return null
  const matched = BRIDGE_ID_RE.exec(bridgeSessionId)
  if (!matched) return null
  return `https://claude.ai/code/session_${matched[1]}`
}
