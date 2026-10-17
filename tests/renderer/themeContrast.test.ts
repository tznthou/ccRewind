import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * 錯誤色（--color-error）的字在每個主題、每種會出現的底色上都要讀得清楚：WCAG AA 對一般大小的字要求 4.5:1。
 * timeline 原本的 #dc3545 在下面三種底色上只有 4.07–4.37。
 *
 * 底色取錯誤色的字實際出現的地方：對話區的錯誤（--color-bg）、側欄（--color-bg-sidebar）、錯誤畫面的說明框（--color-bubble-system）。
 * 主題只寫跟 :root 不同的 token，其餘沿用 :root；半透明的底色疊在該主題的 --color-bg 上算。
 *
 * 泡泡上的「已捨棄分支」徽章不在這裡：整個泡泡刻意淡化成 opacity 0.7，徽章的字與泡泡底色一起疊在頁面底色上，
 * 實際對比約 3:1（timeline 3.25–3.39）。把它當成畫在不透明泡泡上算，會在一個畫面上不存在的組合報綠。
 */

const GLOBAL_CSS = readFileSync(fileURLToPath(new URL('../../src/renderer/styles/global.css', import.meta.url)), 'utf-8')
const SURFACES = ['--color-bg', '--color-bg-sidebar', '--color-bubble-system']
const AA_NORMAL_TEXT = 4.5

type Rgba = [number, number, number, number]

function tokens(selector: string): Record<string, string> {
  const start = GLOBAL_CSS.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`global.css 沒有 ${selector}`)
  const body = GLOBAL_CSS.slice(start, GLOBAL_CSS.indexOf('\n}', start))
  return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]))
}

function parseColor(value: string): Rgba {
  if (value === 'transparent') return [0, 0, 0, 0]
  const hex = value.match(/^#([0-9a-f]{6})$/i)
  if (hex) return [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16), 1]
  const fn = value.match(/^rgba?\(([^)]+)\)$/)
  if (fn) {
    const [r, g, b, a = 1] = fn[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    // 百分比之類的寫法會變成 NaN，而 NaN < 4.5 是 false：那個底色會被默默略過、照樣報綠
    if ([r, g, b, a].every(Number.isFinite)) return [r, g, b, a]
  }
  throw new Error(`認不得的顏色：${value}`)
}

/** 半透明的顏色疊在不透明的底上 */
function over([r, g, b, a]: Rgba, [br, bg, bb]: Rgba): Rgba {
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a), 1]
}

function luminance([r, g, b]: Rgba): number {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// timeline 用 :root；其他主題從 global.css 的 [data-theme="…"] 區塊找，之後加的主題也會被檢查到
const ROOT = tokens(':root')
const THEME_NAMES = [...GLOBAL_CSS.matchAll(/^\[data-theme="([\w-]+)"\] \{/gm)].map(m => m[1])
const THEMES: Record<string, Record<string, string>> = {
  timeline: ROOT,
  ...Object.fromEntries(THEME_NAMES.map(name => [name, { ...ROOT, ...tokens(`[data-theme="${name}"]`) }])),
}

describe('主題的錯誤色對比', () => {
  // 公式或解析壞掉時，下面的主題檢查可能全部「通過」：先用已知的參考值確認它算得對
  it('對比與疊色算得出 WCAG 的參考值', () => {
    expect(contrast(parseColor('#000000'), parseColor('#FFFFFF'))).toBeCloseTo(21, 5)
    expect(contrast(parseColor('#767676'), parseColor('#FFFFFF'))).toBeCloseTo(4.54, 2)
    expect(over(parseColor('rgba(0, 0, 0, 0.5)'), parseColor('#FFFFFF'))).toEqual([127.5, 127.5, 127.5, 1])
    expect(over(parseColor('transparent'), parseColor('#1B1D23'))).toEqual(parseColor('#1B1D23'))
  })

  it('認不得的顏色寫法直接報錯，不會變成 NaN 被略過；主題都有找到', () => {
    expect(() => parseColor('rgb(10% 20% 30%)')).toThrow()
    expect(() => parseColor('var(--color-bg)')).toThrow()
    expect(Object.keys(THEMES)).toEqual(expect.arrayContaining(['timeline', 'archive', 'terminal']))
  })

  it.each(Object.keys(THEMES))('%s：錯誤色在每種底色上都至少 4.5:1', theme => {
    const t = THEMES[theme]
    const bg = parseColor(t['--color-bg'])
    expect(bg[3], '--color-bg 要是不透明的，半透明的底色才有東西可以疊').toBe(1)
    const error = parseColor(t['--color-error'])
    const low = SURFACES
      .map(surface => ({ surface, ratio: contrast(error, over(parseColor(t[surface]), bg)) }))
      .filter(({ ratio }) => ratio < AA_NORMAL_TEXT)
      .map(({ surface, ratio }) => `${surface} ${ratio.toFixed(2)}`)
    expect(low, `${theme} 的 --color-error（${t['--color-error']}）對比不足：\n${low.join('\n')}`).toEqual([])
  })
})
