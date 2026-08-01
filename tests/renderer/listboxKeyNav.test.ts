import { describe, it, expect } from 'vitest'
import {
  sanitizeId,
  clampActiveIndex,
  resolveKeyAction,
  buildOptionId,
} from '../../src/renderer/hooks/listboxKeyNav'

describe('sanitizeId', () => {
  it('保留實際 caller 會傳入的 id 格式', () => {
    // 四個 caller 分別傳 session UUID、project 目錄名、messageId 數字字串
    expect(sanitizeId('9f3c1a2e-4b5d-6789-abcd-ef0123456789')).toBe('9f3c1a2e-4b5d-6789-abcd-ef0123456789')
    expect(sanitizeId('-Users-tznthou-Documents-ccRwind')).toBe('-Users-tznthou-Documents-ccRwind')
    expect(sanitizeId('42')).toBe('42')
  })

  it('把會破壞 CSS selector 語意的字元編碼掉', () => {
    // . # [ ] 在 selector 裡有語意，不能原樣進 id
    expect(sanitizeId('a#b')).not.toContain('#')
    expect(sanitizeId('a[b]')).not.toContain('[')
    expect(sanitizeId('a b')).not.toContain(' ')
  })

  it('是單射：只差特殊字元的 id 不會塌成同一個', () => {
    // 舊實作把所有非法字元一律換成 '_'，這三個輸入全部變成 'a_b' —
    // aria-activedescendant 會指到錯的 option，螢幕閱讀器唸錯項目。
    const collisionCandidates = ['a b', 'a#b', 'a/b', 'a?b', 'a_b']
    const encoded = collisionCandidates.map(sanitizeId)
    expect(new Set(encoded).size).toBe(collisionCandidates.length)
  })

  it('底線本身也被編碼，否則編碼結果會與原文碰撞', () => {
    // 'a_20_b' 的原文若原樣輸出，就會撞上 'a b' 的編碼結果
    expect(sanitizeId('a b')).not.toBe(sanitizeId('a_20_b'))
  })

  it('輸出只含合法 HTML id 字元', () => {
    const messy = 'a b#c[d]e/f?g"h\'i<j>k'
    expect(sanitizeId(messy)).toMatch(/^[a-zA-Z0-9\-_:.]+$/)
  })

  it('CJK 與 emoji 各自編碼成不同輸出', () => {
    expect(sanitizeId('專案')).not.toBe(sanitizeId('回放'))
    // surrogate pair 要當一個 code point 處理，不是兩個 code unit
    expect(sanitizeId('🎬')).not.toBe(sanitizeId('🎭'))
  })

  it('空字串原樣回傳', () => {
    expect(sanitizeId('')).toBe('')
  })
})

describe('clampActiveIndex', () => {
  it('空列表一律回 0', () => {
    expect(clampActiveIndex(0, 0)).toBe(0)
    expect(clampActiveIndex(5, 0)).toBe(0)
  })

  it('超出上界時夾到最後一項', () => {
    expect(clampActiveIndex(99, 3)).toBe(2)
  })

  it('範圍內原值回傳', () => {
    expect(clampActiveIndex(1, 3)).toBe(1)
  })

  it('負數夾到 0：setActiveIndex 是 public API，負值會讓 items[i] 變 undefined 而爆炸', () => {
    expect(clampActiveIndex(-1, 3)).toBe(0)
    expect(clampActiveIndex(-99, 3)).toBe(0)
  })
})

describe('resolveKeyAction', () => {
  const base = { activeIndex: 1, itemCount: 3, dispatchOnArrow: false }

  it('空列表不吃任何按鍵，也不擋瀏覽器預設行為', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', ' ']) {
      const action = resolveKeyAction({ ...base, key, itemCount: 0 })
      expect(action).toEqual({ preventDefault: false, effect: { type: 'none' } })
    }
  })

  it('未處理的按鍵不擋預設行為（Tab 要能跳出 listbox）', () => {
    for (const key of ['Tab', 'a', 'Escape', 'ArrowLeft']) {
      const action = resolveKeyAction({ ...base, key })
      expect(action).toEqual({ preventDefault: false, effect: { type: 'none' } })
    }
  })

  it('ArrowDown 往下移一格', () => {
    expect(resolveKeyAction({ ...base, key: 'ArrowDown' })).toEqual({
      preventDefault: true,
      effect: { type: 'move', index: 2, activate: false },
    })
  })

  it('ArrowUp 往上移一格', () => {
    expect(resolveKeyAction({ ...base, key: 'ArrowUp' })).toEqual({
      preventDefault: true,
      effect: { type: 'move', index: 0, activate: false },
    })
  })

  it('邊界不 loop，但仍擋掉預設捲動', () => {
    // W3C listbox pattern：stop at top/bottom。preventDefault 照樣要做，
    // 否則到底之後按 ↓ 會變成整頁捲動。
    const atBottom = resolveKeyAction({ ...base, key: 'ArrowDown', activeIndex: 2 })
    expect(atBottom).toEqual({ preventDefault: true, effect: { type: 'none' } })

    const atTop = resolveKeyAction({ ...base, key: 'ArrowUp', activeIndex: 0 })
    expect(atTop).toEqual({ preventDefault: true, effect: { type: 'none' } })
  })

  it('dispatchOnArrow 開啟時，方向鍵移動同時觸發 activate', () => {
    expect(resolveKeyAction({ ...base, key: 'ArrowDown', dispatchOnArrow: true })).toEqual({
      preventDefault: true,
      effect: { type: 'move', index: 2, activate: true },
    })
  })

  it('dispatchOnArrow 開啟也不會在邊界空觸發 activate', () => {
    expect(resolveKeyAction({ ...base, key: 'ArrowDown', activeIndex: 2, dispatchOnArrow: true })).toEqual({
      preventDefault: true,
      effect: { type: 'none' },
    })
  })

  it('Enter 與 Space 觸發當前項目', () => {
    for (const key of ['Enter', ' ']) {
      expect(resolveKeyAction({ ...base, key })).toEqual({
        preventDefault: true,
        effect: { type: 'activate', index: 1 },
      })
    }
  })

  it('單一項目時 activate 指向該項，方向鍵不動', () => {
    const single = { activeIndex: 0, itemCount: 1, dispatchOnArrow: true }
    expect(resolveKeyAction({ ...single, key: 'Enter' })).toEqual({
      preventDefault: true,
      effect: { type: 'activate', index: 0 },
    })
    expect(resolveKeyAction({ ...single, key: 'ArrowDown' })).toEqual({
      preventDefault: true,
      effect: { type: 'none' },
    })
  })

  it('傳入越界的 activeIndex 時先夾再算，不會回傳越界 index', () => {
    // hook 的 items 換過但 activeIndex 還沒 reset 的那一拍
    const action = resolveKeyAction({ key: 'ArrowDown', activeIndex: 99, itemCount: 3, dispatchOnArrow: false })
    expect(action).toEqual({ preventDefault: true, effect: { type: 'none' } })

    const activate = resolveKeyAction({ key: 'Enter', activeIndex: 99, itemCount: 3, dispatchOnArrow: false })
    expect(activate).toEqual({ preventDefault: true, effect: { type: 'activate', index: 2 } })
  })
})

describe('buildOptionId', () => {
  it('組出 listbox 前綴 + 消毒後的 item id', () => {
    expect(buildOptionId('listbox-:r1:', 'sess-1')).toBe('listbox-:r1:-sess-1')
  })

  it('item id 走 sanitizeId，不讓特殊字元漏進 DOM id', () => {
    expect(buildOptionId('listbox-:r1:', 'a b')).toBe(`listbox-:r1:-${sanitizeId('a b')}`)
  })
})
