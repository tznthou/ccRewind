import { EventEmitter } from 'node:events'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isFocusFromShowing, showWhenReady, SHOW_FOCUS_GRACE_MS } from '../src/main/showWhenReady'

// BrowserWindow 的替身：只模擬 showWhenReady 用到的部分
class FakeWindow extends EventEmitter {
  showCalls = 0
  private visible = false
  private destroyed = false

  show(): void {
    // 真的 BrowserWindow 銷毀後再呼叫方法會丟錯；在主程序的計時器裡丟出來，Electron 會跳錯誤對話框
    if (this.destroyed) throw new TypeError('Object has been destroyed')
    this.showCalls++
    this.visible = true
  }

  isVisible(): boolean {
    return this.visible
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  /** 使用者把視窗藏起來（Cmd+H、縮到 Dock）之後 isVisible() 是 false */
  hide(): void {
    this.visible = false
  }

  destroy(): void {
    this.destroyed = true
    this.removeAllListeners()
  }

  /** 視窗被別的程式碼顯示了（不是 showWhenReady 顯示的） */
  revealElsewhere(): void {
    this.visible = true
  }
}

const FALLBACK_MS = 3000

describe('showWhenReady', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the window hidden until the renderer has painted', () => {
    const win = new FakeWindow()
    showWhenReady(win, FALLBACK_MS)
    vi.advanceTimersByTime(FALLBACK_MS - 1)
    expect(win.showCalls).toBe(0)
  })

  it('shows the window on ready-to-show', () => {
    const win = new FakeWindow()
    showWhenReady(win, FALLBACK_MS)
    win.emit('ready-to-show')
    expect(win.showCalls).toBe(1)
  })

  it('still shows the window after the fallback delay when ready-to-show never comes', () => {
    const win = new FakeWindow()
    showWhenReady(win, FALLBACK_MS)
    vi.advanceTimersByTime(FALLBACK_MS)
    expect(win.showCalls).toBe(1)
  })

  // show() 會把視窗拉到最前面、搶走焦點：多呼叫一次會把已經切到別的 app 的人拉回來
  it('does not show the window again when the fallback delay passes after ready-to-show', () => {
    const win = new FakeWindow()
    showWhenReady(win, FALLBACK_MS)
    win.emit('ready-to-show')
    win.hide() // 保底計時到之前使用者就把視窗藏起來了
    vi.advanceTimersByTime(FALLBACK_MS * 3)
    expect(win.showCalls).toBe(1)
  })

  it('does not show the window again when ready-to-show arrives after the fallback', () => {
    const win = new FakeWindow()
    showWhenReady(win, FALLBACK_MS)
    vi.advanceTimersByTime(FALLBACK_MS)
    win.emit('ready-to-show')
    expect(win.showCalls).toBe(1)
  })

  // 保底先顯示、使用者隨即把視窗藏起來，之後才來的 ready-to-show 不能再把視窗拉回來
  it('does not bring back a window the user hid when ready-to-show arrives after the fallback', () => {
    const win = new FakeWindow()
    showWhenReady(win, FALLBACK_MS)
    vi.advanceTimersByTime(FALLBACK_MS)
    win.hide()
    win.emit('ready-to-show')
    expect(win.showCalls).toBe(1)
  })

  it('clears the fallback timer once the window is shown', () => {
    const win = new FakeWindow()
    showWhenReady(win, FALLBACK_MS)
    win.emit('ready-to-show')
    expect(win.showCalls).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  // mainWindow.ts 用預設的保底：短到正常的第一次繪製之前就到，白閃就回來了（2026-11-04 在 macOS 打包版量到建立後 75–128 ms 才顯示）；
  // 長到幾秒都沒出現，看起來又像 app 沒開
  it('by default waits well past a normal first paint, and still shows the window within 5 s', () => {
    const win = new FakeWindow()
    showWhenReady(win)
    vi.advanceTimersByTime(1000)
    expect(win.showCalls).toBe(0)
    vi.advanceTimersByTime(4000)
    expect(win.showCalls).toBe(1)
  })

  it('leaves a window closed before the fallback fires alone', () => {
    const win = new FakeWindow()
    showWhenReady(win, FALLBACK_MS)
    win.destroy()
    expect(() => vi.advanceTimersByTime(FALLBACK_MS)).not.toThrow()
    expect(win.showCalls).toBe(0)
  })

  it('does not show a window that something else already showed', () => {
    const win = new FakeWindow()
    showWhenReady(win, FALLBACK_MS)
    win.revealElsewhere()
    vi.advanceTimersByTime(FALLBACK_MS)
    expect(win.showCalls).toBe(0)
  })
})

// 視窗顯示出來時帶來的 focus 不是使用者切回來：did-finish-load 才剛索引過，不必再跑一輪
describe('isFocusFromShowing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is false before showWhenReady has shown the window', () => {
    const win = new FakeWindow()
    showWhenReady(win, FALLBACK_MS)
    expect(isFocusFromShowing(win)).toBe(false)
  })

  // 用預設寬限：要蓋過顯示到 focus 的延遲（2026-11-04 在 macOS 打包版量到最長 62 ms），不然顯示帶來的 focus 又會多掃一輪
  it('is true for the focus that arrives right after showWhenReady showed the window', () => {
    const win = new FakeWindow()
    showWhenReady(win, FALLBACK_MS)
    win.emit('ready-to-show')
    vi.advanceTimersByTime(100)
    expect(isFocusFromShowing(win)).toBe(true)
  })

  it('stops counting a focus as the one from showing once the grace period has passed', () => {
    const win = new FakeWindow()
    showWhenReady(win, FALLBACK_MS)
    win.emit('ready-to-show')
    vi.advanceTimersByTime(SHOW_FOCUS_GRACE_MS - 1)
    expect(isFocusFromShowing(win)).toBe(true)
    vi.advanceTimersByTime(1)
    expect(isFocusFromShowing(win)).toBe(false)
  })

  it('also counts the focus right after the fallback timer showed the window', () => {
    const win = new FakeWindow()
    showWhenReady(win, FALLBACK_MS)
    vi.advanceTimersByTime(FALLBACK_MS)
    expect(isFocusFromShowing(win)).toBe(true)
  })

  it('is false when showWhenReady did not show the window itself', () => {
    const win = new FakeWindow()
    showWhenReady(win, FALLBACK_MS)
    win.revealElsewhere()
    win.emit('ready-to-show')
    expect(isFocusFromShowing(win)).toBe(false)
  })

  // 時鐘被調回去（手動改時間、校時）：負的經過時間不能算成「剛顯示」，不然切回視窗要等時鐘追上才會索引
  it('is false after the clock is set back past the time the window was shown', () => {
    const win = new FakeWindow()
    showWhenReady(win, FALLBACK_MS)
    win.emit('ready-to-show')
    vi.advanceTimersByTime(60_000)
    vi.setSystemTime(Date.now() - 3_600_000)
    expect(isFocusFromShowing(win)).toBe(false)
  })

  it('is false for a window showWhenReady never handled', () => {
    expect(isFocusFromShowing(new FakeWindow())).toBe(false)
  })
})
