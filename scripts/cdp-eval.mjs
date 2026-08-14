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
// 零外部依賴：Node 22 起 WebSocket 是全域內建，不需要 ws 套件。

const CDP_PORT = process.env.CDP_PORT || '9222'
const EVAL_TIMEOUT_MS = 15_000

const expression = process.argv[2]
if (!expression) {
  console.error('用法: node scripts/cdp-eval.mjs \'<javascript expression>\'')
  process.exit(1)
}

let targets
try {
  targets = await (await fetch(`http://localhost:${CDP_PORT}/json`)).json()
} catch {
  console.error(`連不上 CDP (localhost:${CDP_PORT})。dev server 開著嗎？參數有沒有踩到上面那個 \`--\` 陷阱？`)
  process.exit(1)
}

const page = targets.find(t => t.type === 'page')
if (!page) {
  console.error('CDP 有回應但找不到 page target（renderer 還沒載入？）')
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)

const result = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`CDP 逾時 ${EVAL_TIMEOUT_MS}ms`)), EVAL_TIMEOUT_MS)
  const finish = (fn, arg) => { clearTimeout(timer); fn(arg); ws.close() }

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      // returnByValue 讓回傳值直接序列化過來，省去再查 objectId 的往返。
      // awaitPromise 讓 expression 可以是 async，呼叫端不必自己輪詢。
      params: { expression, returnByValue: true, awaitPromise: true },
    }))
  })

  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data)
    if (msg.id !== 1) return
    const thrown = msg.result?.exceptionDetails
    if (thrown) finish(reject, new Error(thrown.exception?.description || '頁面內 JS 例外'))
    else finish(resolve, msg.result?.result?.value)
  })

  ws.addEventListener('error', () => finish(reject, new Error('WebSocket 連線失敗')))
})

try {
  const value = await result
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
} catch (e) {
  console.error('FAILED:', e.message)
  process.exit(1)
}
