/**
 * 用預設瀏覽器開啟外部連結。
 *
 * 為什麼要繞這一圈：main process 對新視窗一律 `setWindowOpenHandler → deny`，所以
 * `window.open()` 完全沒作用。真正會把連結交給系統瀏覽器的是 `will-navigate` 攔截
 * （見 src/main/index.ts，含 http/https 協定白名單），而那條路徑只有「導覽」才會觸發。
 * 因此這裡合成一次 anchor 點擊，讓既有的攔截器接手——不需要為此新增 IPC 通道。
 *
 * 使用者自己點 <a> 時不必呼叫這支；它是給鍵盤捷徑之類沒有實體 anchor 可點的情境用的。
 */
export function openExternalUrl(url: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.rel = 'noreferrer'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}
