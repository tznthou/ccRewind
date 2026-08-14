// Electron renderer 的 CDP 共用連線層，給 scripts/cdp-*.mjs 使用。
//
// 抽出來的理由：cdp-eval 與 cdp-screenshot 原本各有一份「讀 CDP_PORT → fetch /json →
// 找 page target → 開 WebSocket」的開場白，兩份已經開始各自漂移（一邊有逾時一邊沒有、
// 一邊查 exceptionDetails 一邊不查、連錯誤訊息都不同步）。驗證工具漂移的代價特別高：
// 它壞掉的樣子是「回報成功」，不是「噴錯」。
//
// 零外部依賴：Node 22 起 WebSocket 是全域內建。

import { realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, sep, dirname } from 'node:path'

const DEFAULT_TIMEOUT_MS = 15_000

/**
 * 拒絕任何會寫進受保護目錄（預設 ~/.claude/）的輸出路徑。
 *
 * 這不是一般 CLI 的 path traversal 防護（呼叫者本來就有權指定輸出位置），而是守住本專案
 * 最硬的架構承諾：ccRewind 絕不修改 ~/.claude/ 底下任何檔案。writeFileSync 預設會截斷
 * 既有檔案，一個打錯的路徑就足以把 session JSONL 換成 PNG bytes——而依專案自己的量測，
 * 那些對話原檔有 83.5% 已經不存在於別處，覆寫即不可逆。
 *
 * ⚠️ 威脅模型講明白：這裡防的是**打錯路徑**，不是防有人主動攻擊本機檔案系統。
 * 兩層防護各自的實際涵蓋範圍——
 * - 本函式做路徑名比對，擋得住「明顯指到 ~/.claude/」與「經由既存 symlink 指過去」。
 * - `flag: 'wx'`（見 writeFileNoClobber）由核心原子判定，擋得住任何形式的**覆寫**，
 *   包含 hard link 這種 realpath 看不出來的別名。
 * 擋不住的：檢查與開檔之間有時間差，若祖先目錄在那段空窗被換成指向 ~/.claude/ 的
 * symlink，wx 仍會在那底下**建立新檔**（不是覆寫，所以 O_EXCL 不會攔）。要連這個都封死
 * 得用 openat2 之類的 no-follow 開檔，對一支本機除錯工具是過度工程。
 * 別把這兩層描述成「絕對保證」——它們合起來的實際強度就是上面這段。
 *
 * protectedRoot 可注入，讓測試能用 mkdtemp 造假的家目錄，不必碰真實的 ~/.claude/。
 */
export function defaultProtectedRoot(home = homedir()) {
  return resolve(home, '.claude')
}

export function assertSafeOutputPath(outPath, protectedRoot = defaultProtectedRoot()) {
  const guarded = realPathOrSelf(protectedRoot)
  const target = realPathOrSelf(resolve(outPath))
  if (target === guarded || target.startsWith(guarded + sep)) {
    throw new Error(`拒絕寫入 ~/.claude/ 底下的路徑（ccRewind 的唯讀承諾）: ${outPath}`)
  }
  return target
}

/**
 * 寫檔，且絕不覆寫既有檔案。
 *
 * `wx` 是這裡真正承載保證的部分：O_EXCL 由核心在開檔當下判定，沒有檢查與使用之間的空窗，
 * 而且對 hard link、symlink 最終節點一視同仁——目標已經存在就是失敗。assertSafeOutputPath
 * 擋的是「明顯打錯路徑」，這行擋的是「任何形式的覆寫」。
 */
export function writeFileNoClobber(path, data) {
  try {
    writeFileSync(path, data, { flag: 'wx' })
  } catch (e) {
    if (e.code === 'EEXIST') {
      throw new Error(`目標檔案已存在，拒絕覆寫（換個檔名或先自行刪除）: ${path}`, { cause: e })
    }
    throw e
  }
}

// 路徑可能還不存在（要寫的新檔），往上找到第一個存在的祖先再解析，
// 這樣 symlink 目錄也會被還原成真實路徑。
function realPathOrSelf(p) {
  let cur = p
  const segments = []
  for (;;) {
    try {
      const real = realpathSync(cur)
      return segments.length ? resolve(real, ...segments.reverse()) : real
    } catch {
      const parent = dirname(cur)
      if (parent === cur) return p
      segments.push(cur.slice(parent.length + 1))
      cur = parent
    }
  }
}

/**
 * 判斷 getBoundingClientRect 取回的矩形能不能拿來截圖。
 *
 * 零尺寸（display:none、還沒 layout）必須擋下來，否則 captureScreenshot 會回傳一張
 * 0x0 的圖，而工具照樣印「已存檔」——驗證工具最糟的失效模式就是對著垃圾截圖回報成功。
 */
export function isUsableRect(rect) {
  return Boolean(rect) && rect.width > 0 && rect.height > 0
}

/**
 * 連上 renderer 的 page target，回傳一個能送 CDP 指令的 client。
 *
 * 所有失敗路徑都會 reject，不會靜默 resolve undefined：
 * - 連不上除錯埠 / 沒有 page target
 * - CDP 協定層錯誤（msg.error）——漏掉這個會讓 renderer reload 期間的失敗看起來像成功
 * - 單一指令逾時
 * - 連線中途斷掉（pending 的指令全部 reject，而不是永遠掛著）
 */
export async function openPageSocket({
  port = process.env.CDP_PORT || '9222',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  expectUrlPrefix = process.env.CDP_EXPECT_URL || 'http://localhost:5173',
} = {}) {
  // package.json 的 engines 開到 >=20，但 global WebSocket 要 Node 22 才預設可用
  // （Node 20 需要 --experimental-websocket）。裸的 ReferenceError 看不出這件事，
  // 所以在這裡先講清楚。專案的 .node-version 是 22.23.2，正常情況不會走到這裡。
  if (typeof WebSocket === 'undefined') {
    throw new Error(`這支工具需要內建的 global WebSocket（Node 22+），目前是 ${process.version}。請改用 .node-version 指定的版本。`)
  }

  let targets
  try {
    // 連 target discovery 也要有上限，否則對著一個「有 listen 但不回應」的埠會無限等待。
    const res = await fetch(`http://localhost:${port}/json`, { signal: AbortSignal.timeout(timeoutMs) })
    targets = await res.json()
  } catch {
    throw new Error(`連不上 CDP (localhost:${port})。dev server 開著嗎？參數有沒有踩到 \`--\` 陷阱（見 cdp-eval.mjs 檔頭）？`)
  }

  // 只認 dev server 的 target。少了這關，一個沒被殺乾淨、還佔著同一個埠的舊 Electron
  // process 會讓 evaluate 與截圖統統「成功」——對著陳舊畫面回報通過，正是這類工具最該
  // 避免的失效模式（檔頭那段「重啟前先確認埠已釋放」講的就是這個情境）。
  const pages = targets.filter(t => t.type === 'page')
  const candidates = pages.filter(t => (t.url || '').startsWith(expectUrlPrefix))
  if (candidates.length === 0) {
    const seen = pages.map(t => t.url || '(無 url)').join(', ') || '(沒有任何 page target)'
    throw new Error(`找不到符合 ${expectUrlPrefix} 的 page target。實際看到: ${seen}。埠可能被另一個 process 佔著（lsof -ti:${port}）`)
  }
  if (candidates.length > 1) {
    throw new Error(`有 ${candidates.length} 個符合的 page target，無法判斷該連哪一個: ${candidates.map(t => t.url).join(', ')}`)
  }
  const page = candidates[0]

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  const pending = new Map()
  let nextId = 1
  let closedReason = null

  const rejectAllPending = reason => {
    closedReason = reason
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer)
      reject(new Error(reason))
    }
    pending.clear()
  }

  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data)
    const waiter = pending.get(msg.id)
    if (!waiter) return
    pending.delete(msg.id)
    clearTimeout(waiter.timer)
    if (msg.error) waiter.reject(new Error(`CDP ${msg.error.code}: ${msg.error.message}`))
    else waiter.resolve(msg.result)
  })
  ws.addEventListener('close', () => rejectAllPending('CDP 連線在指令完成前關閉'))
  ws.addEventListener('error', () => rejectAllPending('CDP WebSocket 連線失敗'))

  await new Promise((resolveOpen, rejectOpen) => {
    // 逾時要主動 close：只 reject 的話，還在連線中的 socket 會繼續掛著，而呼叫端拿不到
    // client 也就無從關閉它——CLI 會印出失敗訊息卻不肯結束，直到作業系統放棄那個連線。
    const timer = setTimeout(() => {
      ws.close()
      rejectOpen(new Error(`CDP WebSocket 連線逾時 ${timeoutMs}ms`))
    }, timeoutMs)
    ws.addEventListener('open', () => { clearTimeout(timer); resolveOpen() })
    ws.addEventListener('error', () => {
      clearTimeout(timer)
      ws.close()
      rejectOpen(new Error('CDP WebSocket 連線失敗'))
    })
  })

  return {
    send(method, params = {}) {
      if (closedReason) return Promise.reject(new Error(closedReason))
      const id = nextId++
      return new Promise((resolveSend, rejectSend) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          rejectSend(new Error(`CDP 指令逾時 ${timeoutMs}ms: ${method}`))
        }, timeoutMs)
        pending.set(id, { resolve: resolveSend, reject: rejectSend, timer })
        ws.send(JSON.stringify({ id, method, params }))
      })
    },

    // 在頁面內求值。頁面端拋出的例外要跟協定層錯誤分開報，否則會指向錯誤的排查方向。
    async evaluate(expression) {
      const result = await this.send('Runtime.evaluate', {
        // returnByValue 讓回傳值直接序列化過來，省去再查 objectId 的往返。
        // awaitPromise 讓 expression 可以是 async，呼叫端不必自己輪詢。
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
      if (result?.exceptionDetails) {
        throw new Error(`頁面內 JS 例外: ${result.exceptionDetails.exception?.description || '(無描述)'}`)
      }
      return result?.result?.value
    },

    close() { ws.close() },
  }
}
