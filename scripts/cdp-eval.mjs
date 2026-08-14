// Electron renderer 的 CDP 求值工具：連上除錯埠，在頁面裡執行一段 JS，把結果印到 stdout。
//
// 存在理由：Electron UI 的驗證不能只看程式碼，也不該只靠肉眼看截圖——需要能直接查詢
// 真實 DOM（元素存不存在、實際量到的高度、有沒有溢出）。這支工具讓那件事變成一行指令，
// 且**不需要為了測試改動任何 production code**。
//
// 用法：
//   1. 另開一個終端機跑：pnpm exec electron-vite dev --remoteDebuggingPort=9222
//   2. node scripts/cdp-eval.mjs '<javascript expression>'
//
// ⚠️ 啟動參數別在中間加 `--`（2026-08-14 四種組合實測）：
//   electron-vite dev --remoteDebuggingPort=9222      ✅ electron-vite 會正規化成 kebab-case
//   electron-vite dev --remote-debugging-port=9222    ✅ 本來就是 kebab-case
//   electron-vite dev -- --remote-debugging-port=...  ✅ 透傳但已是 kebab-case
//   electron-vite dev -- --remoteDebuggingPort=9222   ❌ `--` 讓參數原樣透傳跳過正規化，
//                                                        而 Chromium 只認 kebab-case
//   壞掉的樣子特別會騙人：app 照常開起來、`ps` 也看得到那個參數，但埠靜默不開。
//
// ⚠️ 重啟前先確認埠已釋放（lsof -ti:9222），否則新 process 會 bind 失敗而靜默沒開 CDP。
//
// 連線層（逾時、CDP 協定錯誤、斷線處理）在 cdp-client.mjs。

import { openPageSocket } from './cdp-client.mjs'

const expression = process.argv[2]
if (!expression) {
  console.error('用法: node scripts/cdp-eval.mjs \'<javascript expression>\'')
  process.exit(1)
}

let client
try {
  client = await openPageSocket()
  const value = await client.evaluate(expression)
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
} catch (e) {
  console.error('FAILED:', e.message)
  process.exitCode = 1
} finally {
  client?.close()
}
