// 視窗畫好再顯示：BrowserWindow 以 `show: false` 建立，等 renderer 第一次畫完（ready-to-show）才顯示。
// 一建立就顯示的話，網頁畫出來之前整個視窗是 Electron 預設的白底，深色主題每次啟動都會白閃一下。
// 主程序不知道使用者存的主題（存在 renderer 的 localStorage），所以不靠 backgroundColor。

/** ready-to-show 一直沒來（頁面載入失敗、renderer 卡住）時最晚多久還是顯示視窗，不然看起來像 app 沒開 */
export const SHOW_FALLBACK_MS = 3000

/** showWhenReady 用到的 BrowserWindow 部分 */
export interface ShowableWindow {
  once(event: 'ready-to-show', listener: () => void): unknown
  show(): void
  isVisible(): boolean
  isDestroyed(): boolean
}

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
    win.show()
  }
  const fallback = setTimeout(reveal, fallbackMs)
  win.once('ready-to-show', reveal)
}
