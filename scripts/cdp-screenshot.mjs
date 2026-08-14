// Electron renderer 的 CDP 截圖工具：整頁或指定選擇器的區域，存成 png。
//
// 存在理由：UI 改動的最後一哩驗證是「人眼看到的樣子對不對」——DOM 查詢證明得了結構，
// 證明不了排版被裁掉、顏色在深色主題下看不見這類問題。裁切到單一元件（而非整頁）
// 是因為整頁截圖縮到能看的尺寸後，一個小 badge 根本分辨不出來。
//
// 用法（前置條件與 `--` 陷阱見 cdp-eval.mjs 檔頭）：
//   node scripts/cdp-screenshot.mjs out.png                        # 整頁
//   node scripts/cdp-screenshot.mjs out.png '[class*=sessionItem]' # 只截該元素
//
// 零外部依賴：Node 22 起 WebSocket 是全域內建。

import { writeFileSync } from 'node:fs'

const CDP_PORT = process.env.CDP_PORT || '9222'
// 裁切區域用 2x 取樣，否則小元件（badge、圖示）截出來糊到看不出對錯。
const CLIP_SCALE = 2

const [outPath, selector] = process.argv.slice(2)
if (!outPath) {
  console.error('用法: node scripts/cdp-screenshot.mjs <out.png> [selector]')
  process.exit(1)
}

let targets
try {
  targets = await (await fetch(`http://localhost:${CDP_PORT}/json`)).json()
} catch {
  console.error(`連不上 CDP (localhost:${CDP_PORT})。dev server 開著嗎？`)
  process.exit(1)
}

const page = targets.find(t => t.type === 'page')
if (!page) {
  console.error('CDP 有回應但找不到 page target')
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
const pending = new Map()
let nextId = 1

function send(method, params = {}) {
  const id = nextId++
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data)
  const waiter = pending.get(msg.id)
  if (!waiter) return
  pending.delete(msg.id)
  if (msg.error) waiter.reject(new Error(msg.error.message))
  else waiter.resolve(msg.result)
})

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve)
  ws.addEventListener('error', () => reject(new Error('WebSocket 連線失敗')))
})

let clip
if (selector) {
  const evaluated = await send('Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return null
      const b = el.getBoundingClientRect()
      return JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height })
    })()`,
    returnByValue: true,
  })
  const box = evaluated.result?.value
  if (!box) {
    console.error(`選擇器沒有命中任何元素: ${selector}`)
    ws.close()
    process.exit(1)
  }
  clip = { ...JSON.parse(box), scale: CLIP_SCALE }
}

const shot = await send('Page.captureScreenshot', clip ? { clip, format: 'png' } : { format: 'png' })
writeFileSync(outPath, Buffer.from(shot.data, 'base64'))
console.log(`已存檔: ${outPath}${clip ? ` (裁切 ${Math.round(clip.width)}x${Math.round(clip.height)} @${CLIP_SCALE}x)` : ' (整頁)'}`)
ws.close()
