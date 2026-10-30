import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * ChatView 的虛擬列表靠 scrollMargin 知道列表從捲動容器的哪裡開始；scrollMargin 由 ResizeObserver 看 .chatView
 * 的外框尺寸變化時重新量（ChatView.tsx）。上方的 Token Budget、子代理、任務面板展開收合時，只有 .chatView 的外框
 * 跟著內容長高，觀察者才看得到。
 *
 * .chatView 是 App 的 .main（有固定高度、column 方向的 flex 容器）底下的 flex item。預設的 flex-shrink: 1 會把它
 * 壓回 .main 的高度（min-height: 100% 只是下限，擋不住），內容只是溢出外框：外框尺寸不變，觀察者不觸發，
 * scrollMargin 停在第一次量到的值。展開 Token Budget 後往下捲，virtualizer 以為列表從舊的位置開始，可視範圍
 * 最上面的幾則訊息沒有畫出來，變成一片空白（2026-10-30 dev app 實測：列表實際從 1332px 開始，scrollMargin 停在 73）。
 *
 * 這裡只守 CSS 這一半：.main 是 column flex 容器時，.chatView 不能被壓扁。展開後捲動有沒有空白要在真的 app 裡驗：
 * jsdom 不算版面，也沒有 ResizeObserver。
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8')
const APP_CSS = read('../../src/renderer/App.module.css')
const CHAT_CSS = read('../../src/renderer/components/ChatView/ChatView.module.css')

/** 第一個 `selector {` 區塊裡的宣告（去掉註解；不處理 @media 與巢狀） */
function declarations(css: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const block = new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css)
  if (!block) throw new Error(`找不到 ${selector} 區塊`)
  const body = block[1].replace(/\/\*[\s\S]*?\*\//g, '')
  return Object.fromEntries([...body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map(d => [d[1], d[2].trim()]))
}

describe('ChatView 版面', () => {
  it('.chatView 跟著內容長高，不被 .main 壓扁（ResizeObserver 才看得到上方面板展開）', () => {
    // 前提：.main 是 column 方向的 flex 容器。版面改了就要重新確認 .chatView 的外框會不會跟著內容長高
    const main = declarations(APP_CSS, '.main')
    expect(main.display, '.main 不再是 flex 容器：重新確認 ChatView 的 scrollMargin 量得到面板展開').toBe('flex')
    expect(main['flex-direction'], '.main 不再是 column 方向：重新確認 ChatView 的 scrollMargin 量得到面板展開').toBe('column')

    const chatView = declarations(CHAT_CSS, '.chatView')
    expect(chatView['min-height'], '找到的不是預期的 .chatView 區塊').toBe('100%')
    expect(chatView['flex-shrink']).toBe('0')
    // flex 簡寫會蓋掉 flex-shrink，寫了就得重新確認
    expect(chatView.flex).toBeUndefined()
  })
})
