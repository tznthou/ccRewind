/**
 * 閒置偵測：target 上出現任一指定事件就回報 active，之後 idleMs 內沒有新事件就回報 idle。
 * 只在狀態翻轉時呼叫 onChange——捲動時每秒幾十個事件不會各自觸發一次，呼叫端可以直接接 setState。
 *
 * 只依賴 EventTarget 與計時器、不碰 DOM 或 React，所以能在 node 環境用 fake timers 測。
 * 回傳 dispose：移除監聽並取消尚未到期的 idle 回報。
 */
export function watchIdle(
  target: EventTarget,
  events: readonly string[],
  idleMs: number,
  onChange: (active: boolean) => void,
): () => void {
  let active = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const onActivity = () => {
    if (!active) {
      active = true
      onChange(true)
    }
    clearTimeout(timer)
    timer = setTimeout(() => {
      active = false
      onChange(false)
    }, idleMs)
  }

  for (const type of events) target.addEventListener(type, onActivity, { passive: true })

  return () => {
    for (const type of events) target.removeEventListener(type, onActivity)
    clearTimeout(timer)
  }
}
