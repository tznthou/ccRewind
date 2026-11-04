import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { resolveTheme } from '../../src/renderer/context/resolveTheme'

/**
 * 主題遷移（黑板計畫 PR2 改動 1、裁決 19）：檔案室 → 時間線、終端機 → 黑板，時間線與黑板原樣，其他一律時間線。
 *
 * 同一張表有兩份：React 的 resolveTheme（getInitialTheme 用，第一次 render 後寫回 localStorage）與
 * public/scripts/theme-init.js（React 之前就寫 <html data-theme>）。後者不能省：:root 就是時間線，所以檔案室 → 時間線不會閃，
 * 會閃的是終端機 → 黑板與所有黑板用戶 —— theme-init 要是沒有這張表，開窗那一幀會先畫存著的舊值或時間線。
 * 兩份都拿下面的 EXPECTED 比：表改了兩份一起紅，不會只改到一份。theme-init 在 node:vm 跑，只給它
 * document.documentElement.dataset 與 localStorage 兩樣（它是 React 之前的同步腳本，用不到別的）。
 */
const EXPECTED: [string | null, string][] = [
  ['archive', 'timeline'],
  ['terminal', 'board'],
  ['timeline', 'timeline'],
  ['board', 'board'],
  ['nosuch', 'timeline'],
  ['', 'timeline'],
  [null, 'timeline'],
]

const THEME_INIT = readFileSync(fileURLToPath(new URL('../../src/renderer/public/scripts/theme-init.js', import.meta.url)), 'utf-8')

function runThemeInit(stored: string | null): string | undefined {
  const dataset: Record<string, string> = {}
  const store = new Map<string, string>(stored === null ? [] : [['ccrewind-theme', stored]])
  vm.runInNewContext(THEME_INIT, {
    document: { documentElement: { dataset } },
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
    },
  })
  return dataset.theme
}

describe('主題遷移', () => {
  it.each(EXPECTED)('resolveTheme(%j) = %s', (stored, theme) => {
    expect(resolveTheme(stored)).toBe(theme)
  })

  it.each(EXPECTED)('theme-init.js 讀到 %j 時把 data-theme 寫成 %s', (stored, theme) => {
    expect(runThemeInit(stored)).toBe(theme)
  })

  it('vm 裡的 theme-init 真的讀了 localStorage：存的值不同，寫出來的就不同', () => {
    // 這條守的是測試自己：假的 localStorage 沒接上的話，上面每一列都會變成同一個值，時間線那幾列照樣綠
    expect(runThemeInit('board')).not.toBe(runThemeInit(null))
  })
})
