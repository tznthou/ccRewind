import { useCallback, useId, useState, type KeyboardEvent } from 'react'
import { buildOptionId, clampActiveIndex, resolveKeyAction } from './listboxKeyNav'

interface Options<T> {
  items: T[]
  getItemId: (item: T) => string
  onActivate: (item: T, index: number) => void
  /** true: ↑↓ 立即 onActivate；false: ↑↓ 只改 active，Enter/Space 才 onActivate */
  dispatchOnArrow: boolean
  /** active 改變的 side effect（SessionList 用來呼叫 virtualizer.scrollToIndex） */
  onActiveChange?: (index: number) => void
}

interface OptionProps {
  id: string
  role: 'option'
  tabIndex: -1
}

interface ListboxProps {
  role: 'listbox'
  tabIndex: 0
  'aria-activedescendant': string | undefined
  onKeyDown: (e: KeyboardEvent) => void
}

interface Result<T> {
  activeIndex: number
  setActiveIndex: (i: number) => void
  listboxId: string
  listboxProps: ListboxProps
  /** 套到每個 option 元素上：id（給 aria-activedescendant）+ role + tabIndex=-1 */
  getOptionProps: (item: T) => OptionProps
  /** index === activeIndex（caller 用來決定 .optionActive class） */
  isActive: (index: number) => boolean
}

/**
 * Listbox keyboard navigation hook（aria-activedescendant pattern）。
 *
 * Pattern：listbox container `tabIndex=0`、所有 options `tabIndex=-1`，
 * focus 永遠在 container 上，aria-activedescendant 指向 active option id。
 * 對虛擬化列表穩定（active item unmount 不會丟 focus）。
 *
 * Edge：stop at top/bottom（W3C listbox 標準，不 loop）。
 *
 * Items 變化時（reference 不同）active reset 到 0，配合 caller useMemo。
 */
export function useListboxKeyNav<T>({
  items,
  getItemId,
  onActivate,
  dispatchOnArrow,
  onActiveChange,
}: Options<T>): Result<T> {
  const baseId = useId()
  const listboxId = `listbox-${baseId}`
  const [activeIndex, setActiveIndex] = useState(0)

  // items reference 變化時 render-phase reset active to 0
  // React 官方 "Storing previous state during render" pattern：用 useState 存
  // 上次的 items，render 中比對發現改變就 setState。React 會立即重 render，
  // 下一次 render 就拿到正確的 activeIndex（比 useEffect 早一拍）。
  const [prevItems, setPrevItems] = useState(items)
  if (prevItems !== items) {
    setPrevItems(items)
    if (activeIndex !== 0) setActiveIndex(0)
  }

  const safeActiveIndex = clampActiveIndex(activeIndex, items.length)

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const { preventDefault, effect } = resolveKeyAction({
      key: e.key,
      activeIndex: safeActiveIndex,
      itemCount: items.length,
      dispatchOnArrow,
    })
    if (preventDefault) e.preventDefault()

    if (effect.type === 'move') {
      setActiveIndex(effect.index)
      onActiveChange?.(effect.index)
      if (effect.activate) onActivate(items[effect.index], effect.index)
    } else if (effect.type === 'activate') {
      onActivate(items[effect.index], effect.index)
    }
  }, [items, safeActiveIndex, dispatchOnArrow, onActivate, onActiveChange])

  const activeDescendant = items.length > 0
    ? buildOptionId(listboxId, getItemId(items[safeActiveIndex]))
    : undefined

  const getOptionProps = useCallback((item: T): OptionProps => ({
    id: buildOptionId(listboxId, getItemId(item)),
    role: 'option',
    tabIndex: -1,
  }), [listboxId, getItemId])

  return {
    activeIndex: safeActiveIndex,
    setActiveIndex,
    listboxId,
    listboxProps: {
      role: 'listbox',
      tabIndex: 0,
      'aria-activedescendant': activeDescendant,
      onKeyDown: handleKeyDown,
    },
    getOptionProps,
    isActive: (index: number) => index === safeActiveIndex,
  }
}
