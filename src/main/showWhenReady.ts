// 視窗畫好再顯示：BrowserWindow 以 `show: false` 建立，等 renderer 第一次畫完（ready-to-show）才顯示。
// 一建立就顯示的話，網頁畫出來之前整個視窗是 Electron 預設的白底，深色主題每次啟動都會白閃一下。
// 主程序不知道使用者存的主題（存在 renderer 的 localStorage），所以不靠 backgroundColor。

/** ready-to-show 一直沒來（頁面載入失敗、renderer 卡住）時最晚多久還是顯示視窗，不然看起來像 app 沒開 */
export const SHOW_FALLBACK_MS = 3000

/**
 * 顯示視窗後多久內的 focus 算是顯示本身帶來的（例：2026-11-04 在 macOS 打包版量了 16 次，show() 之後 5–62 ms 才來）。
 * 放寬沒有代價：這段時間內 did-finish-load 的索引才剛跑過。
 */
export const SHOW_FOCUS_GRACE_MS = 1000

/** showWhenReady 用到的 BrowserWindow 部分 */
export interface ShowableWindow {
  once(event: 'ready-to-show', listener: () => void): unknown
  show(): void
  isVisible(): boolean
  isDestroyed(): boolean
}

const shownAt = new WeakMap<ShowableWindow, number>()

/**
 * 呼叫端要以 `show: false` 建立視窗。ready-to-show 與保底計時先到的那個顯示視窗，只顯示一次：
 * show() 會把視窗拉到最前面、搶走焦點，多呼叫一次會把已經切到別的 app 的人拉回來。
 */
export function showWhenReady(win: ShowableWindow, fallbackMs: number = SHOW_FALLBACK_MS): void {
  let settled = false
  const reveal = (): void => {
    if (settled) return
    settled = true
    clearTimeout(fallback)
    // 保底計時到的時候視窗可能已經關掉（銷毀後呼叫會丟錯），或已經由別處顯示過
    if (win.isDestroyed() || win.isVisible()) return
    shownAt.set(win, Date.now())
    win.show()
  }
  const fallback = setTimeout(reveal, fallbackMs)
  win.once('ready-to-show', reveal)
}

/**
 * 這次 focus 是不是 showWhenReady 把視窗顯示出來時帶來的。它不是使用者切回來，不用為它重新索引：
 * 改成畫好才顯示後，ready-to-show 多半在 did-finish-load 之後，顯示帶來的 focus 會落在 focus 監聽註冊之後，
 * 第一輪索引若已跑完就會整輪再掃一次。
 */
export function isFocusFromShowing(win: ShowableWindow, graceMs: number = SHOW_FOCUS_GRACE_MS): boolean {
  const at = shownAt.get(win)
  return at !== undefined && Date.now() - at < graceMs
}
