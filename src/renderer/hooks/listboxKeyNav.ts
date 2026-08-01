/**
 * useListboxKeyNav 的純邏輯層。
 *
 * 抽出來的理由：renderer 刻意不建 jsdom / component test 基建，
 * 邏輯留在 hook 裡就等於不可測。狀態機（按鍵 → 效果）與 id 生成都是純函數，
 * 抽到隔壁 .ts 就能在 node 測試裡直接驗證。
 */

/** 合法 HTML id 字元集。刻意不含 `_`——`_` 被保留給 sanitizeId 當跳脫前綴，
 *  否則編碼結果會與「原文本來就有底線」的 id 碰撞。 */
const ID_SAFE_CHARS = /[^a-zA-Z0-9\-:.]/gu

/**
 * 把 caller 提供的 itemId 消毒成合法 HTML id 字元集。
 *
 * 動機：React 會 escape attribute value 不會 XSS，但若有 code 用此 id 走 selector
 * 路徑（如 `#foo.bar`），特殊字元（`.` `#` `[` `]` 等）會破壞 selector 語意。
 *
 * 編碼方式是單射的：每個非法 code point 換成 `_<hex>_`。因為合法字元集不含 `_`，
 * 輸出中的每個 `_` 都必然是編碼序列的邊界，不同輸入不可能得到同一個輸出。
 * 一律換成 `_` 的作法會讓 `a b` / `a#b` / `a_b` 全部塌成 `a_b`，
 * aria-activedescendant 就會指向錯的 option。
 */
export function sanitizeId(raw: string): string {
  return raw.replace(ID_SAFE_CHARS, (c) => `_${c.codePointAt(0)!.toString(16)}_`)
}

/** 組出 option 的 DOM id（給 aria-activedescendant 指向）。 */
export function buildOptionId(listboxId: string, itemId: string): string {
  return `${listboxId}-${sanitizeId(itemId)}`
}

/**
 * 把 activeIndex 夾進 [0, itemCount-1]。
 *
 * 上界：items 縮短後 activeIndex 可能還停在舊位置。
 * 下界：setActiveIndex 是對外開放的 API，負值會讓 `items[i]` 變 undefined，
 * 後續 getItemId(undefined) 直接爆炸。
 */
export function clampActiveIndex(activeIndex: number, itemCount: number): number {
  if (itemCount <= 0) return 0
  return Math.min(Math.max(activeIndex, 0), itemCount - 1)
}

/** 按鍵造成的效果。`move` 帶 activate 是因為 dispatchOnArrow 模式下移動即選取。 */
export type ListboxKeyEffect =
  | { type: 'none' }
  | { type: 'move'; index: number; activate: boolean }
  | { type: 'activate'; index: number }

export interface ListboxKeyAction {
  /** 與 effect 分開：邊界上不移動，但仍要擋掉瀏覽器的捲動預設行為。 */
  preventDefault: boolean
  effect: ListboxKeyEffect
}

const NO_ACTION: ListboxKeyAction = { preventDefault: false, effect: { type: 'none' } }
const CONSUMED: ListboxKeyAction = { preventDefault: true, effect: { type: 'none' } }

interface ResolveParams {
  key: string
  activeIndex: number
  itemCount: number
  /** true: ↑↓ 立即 activate；false: ↑↓ 只改 active，Enter/Space 才 activate */
  dispatchOnArrow: boolean
}

/**
 * listbox 鍵盤狀態機。
 *
 * Edge：stop at top/bottom（W3C listbox 標準，不 loop）。
 * 未處理的按鍵一律不 preventDefault，Tab 才跳得出 listbox。
 */
export function resolveKeyAction({ key, activeIndex, itemCount, dispatchOnArrow }: ResolveParams): ListboxKeyAction {
  if (itemCount <= 0) return NO_ACTION

  const current = clampActiveIndex(activeIndex, itemCount)

  if (key === 'ArrowDown' || key === 'ArrowUp') {
    const next = key === 'ArrowDown'
      ? Math.min(current + 1, itemCount - 1)
      : Math.max(current - 1, 0)
    if (next === current) return CONSUMED
    return { preventDefault: true, effect: { type: 'move', index: next, activate: dispatchOnArrow } }
  }

  if (key === 'Enter' || key === ' ') {
    return { preventDefault: true, effect: { type: 'activate', index: current } }
  }

  return NO_ACTION
}
