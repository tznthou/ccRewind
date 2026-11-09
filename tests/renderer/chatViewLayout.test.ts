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

/** 第一個行首 `selector {` 區塊裡的宣告（去掉註解；不處理 @media 與巢狀）；沒有這個區塊時回 null */
function findDeclarations(css: string, selector: string): Record<string, string> | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const block = new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css)
  if (!block) return null
  const body = block[1].replace(/\/\*[\s\S]*?\*\//g, '')
  return Object.fromEntries([...body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map(d => [d[1], d[2].trim()]))
}

/** 黑板粉筆槽（App.module.css 的 .main::after）的 height 用的變數；不是單一個 var() 或沒有這個區塊時回 undefined */
function boardTroughVar(): string | undefined {
  const trough = findDeclarations(APP_CSS, ':global([data-theme="board"]) .main::after')
  return /^var\(\s*(--[\w-]+)\s*\)$/.exec(trough?.height ?? '')?.[1]
}

function declarations(css: string, selector: string): Record<string, string> {
  const found = findDeclarations(css, selector)
  if (!found) throw new Error(`找不到 ${selector} 區塊`)
  return found
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

  /**
   * 黑板（2026-11-06 盲審 r1 #7）：.main 最後一個 flex 子項是 sticky 貼底的粉筆槽（App.module.css 的 .main::after），它佔版面高度。
   * .chatView 的 min-height: 100% 再加上槽高，內容塞得進視窗的短對話也能往下捲一個槽高（1 則訊息的對話多捲 22px）；
   * 載入中、錯誤、空對話也一樣，它們包在 .chatView 裡。黑板的 .chatView 要扣掉槽高，兩邊用同一個變數：改槽高的人不會漏改這邊。
   * 找不到區塊時用 expect 報（不 throw），失敗才是 AssertionError。
   */
  it('黑板的 .chatView 最小高度扣掉粉筆槽的高度，兩邊用同一個變數（短對話不多捲）', () => {
    const trough = findDeclarations(APP_CSS, ':global([data-theme="board"]) .main::after')
    expect(trough, 'App.module.css 沒有黑板的 .main::after（粉筆槽）區塊').not.toBeNull()
    const troughVar = /^var\(\s*(--[\w-]+)\s*\)$/.exec(trough?.height ?? '')?.[1]
    expect(troughVar, `粉筆槽的 height 要寫成一個變數（現在是 ${trough?.height}），.chatView 才扣得到同一個值`).toBeDefined()

    const chatView = findDeclarations(CHAT_CSS, ':global([data-theme="board"]) .chatView')
    expect(chatView, 'ChatView.module.css 沒有黑板的 .chatView 區塊：短對話會多捲一個粉筆槽高（盲審 r1 #7）').not.toBeNull()
    const minus = /^calc\(\s*100%\s*-\s*var\(\s*(--[\w-]+)\s*\)\s*\)$/.exec(chatView?.['min-height'] ?? '')?.[1]
    expect(minus, `黑板 .chatView 的 min-height 要是 calc(100% - var(--…))（現在是 ${chatView?.['min-height']}）`).toBeDefined()
    expect(minus, '黑板 .chatView 扣掉的變數要跟粉筆槽的 height 是同一個').toBe(troughVar)
  })

  /**
   * 黑板的跳頂／跳底鍵（.jumpButtons）墊高到粉筆槽上面：墊的就是槽高，也用同一個變數（2026-11-09 盲審 r2 #1：槽高變數一開始只統一了
   * 槽本身與 .chatView，鍵還寫死 22px；槽高一改，鍵就壓到槽上，或離槽不再是 --space-lg）。
   */
  it('黑板的跳頂／跳底鍵墊高的高度也用粉筆槽的變數', () => {
    const troughVar = boardTroughVar()
    expect(troughVar, '粉筆槽的 height 不是單一個變數（見上一條）').toBeDefined()
    const buttons = findDeclarations(CHAT_CSS, ':global([data-theme="board"]) .jumpButtons')
    expect(buttons, 'ChatView.module.css 沒有黑板的 .jumpButtons 區塊').not.toBeNull()
    expect(buttons?.bottom, `黑板跳頂／跳底鍵的 bottom 要用槽高的變數 ${troughVar}（現在是 ${buttons?.bottom}）：寫死的話，`
      + '槽高一改，鍵就壓到槽上或離槽太遠（盲審 r2 #1）').toMatch(new RegExp(`var\\(\\s*${troughVar}\\s*\\)`))
  })
})
