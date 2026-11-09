import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 黑板的粉筆質感套在圖表的資料線上（2026-11-06 盲審 r1 #4）。SVG 濾鏡沒寫 filterUnits 時是 objectBoundingBox：濾鏡區域是元素
 * 幾何外框的百分比。資料是平的時候，recharts 的線（path）外框高 0 → 區域高 0 → 整條線不畫（dev app 實測：儀表板的線改平就整條不見）。
 * 所以圖表元素（.recharts-…）用的濾鏡要寫 filterUnits="userSpaceOnUse"，區域用圖表座標的固定數字蓋住整張圖（recharts 的 <svg>
 * 的 viewBox 等於它的大小，1 單位 = 1 CSS px）。不用百分比：百分比對哪個 viewport 算是瀏覽器的行為，2026-11-09 量過 Electron
 * 44.10.2 是對圖表的 <svg>（x 0%、寬 50% 的區域在 1127／517／300 寬的圖上都切在正中間）；要是改成對 <filter> 所在的 0×0 <svg>
 * 算，每條線都不畫，而 node 裡的測試看不到。固定數字不看 viewport，這裡驗得到。
 *
 * 掃描的限制：只認選擇器含 `.recharts-` 的規則；var() 間接引用與 TSX 的 inline style 看不到。recharts 的圖例文字與 tooltip 是
 * HTML 元素（外框不會是 0），以後替它們加粉筆濾鏡時，這裡會誤要求 userSpaceOnUse：到時把那個選擇器排除掉。
 */

const RENDERER_DIR = fileURLToPath(new URL('../../src/renderer', import.meta.url))
const INDEX_HTML = readFileSync(path.join(RENDERER_DIR, 'index.html'), 'utf-8').replace(/<!--[\s\S]*?-->/g, '')
const FILTER_DECL = /(?<![-\w])filter\s*:\s*([^;}]+)/g
const URL_REF = /url\(\s*(['"]?)#([\w-]+)\1\s*\)/g
const REGION_KEYS = ['x', 'y', 'width', 'height'] as const
/** 區域至少要蓋到的範圍（圖表座標，1 單位 = 1 CSS px）：左上往外留線寬與粉筆的位移，右下比 8K 螢幕的寬（7680 px）還遠 */
const REGION_NEAR = -10
const REGION_FAR = 8000

interface Source {
  file: string
  text: string
}

interface FilterRef {
  file: string
  line: number
  selector: string
  id: string
}

interface SvgFilter {
  attrs: Record<string, string>
  body: string
}

/** CSS 註解換成等長的空白（保留換行，行號不變）：註解裡寫到的 url(#…) 不算 */
function stripCssComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
}

/**
 * 選擇器含 `.recharts-` 的規則裡，filter 值引用到的每個 `url(#id)`（url 不必是第一個函式；不帶引號、單引號、雙引號都認）。
 * 選擇器 = 宣告前最近的 `{` 往回到上一個 `}`／`{`／`;` 之間的字（逗號接起來的多行、@media 裡的規則都算得到）。只看 .css
 */
export function chartFilterRefs(sources: Source[]): FilterRef[] {
  const refs: FilterRef[] = []
  for (const { file, text } of sources) {
    if (!file.endsWith('.css')) continue
    const css = stripCssComments(text)
    for (const decl of css.matchAll(FILTER_DECL)) {
      const at = decl.index ?? 0
      const open = css.lastIndexOf('{', at)
      if (open < 0) continue
      const start = Math.max(css.lastIndexOf('}', open), css.lastIndexOf('{', open - 1), css.lastIndexOf(';', open)) + 1
      const selector = css.slice(start, open).replace(/\s+/g, ' ').trim()
      if (!selector.includes('.recharts-')) continue
      const line = css.slice(0, at).split('\n').length
      for (const u of decl[1].matchAll(URL_REF)) refs.push({ file, line, selector, id: u[2] })
    }
  }
  return refs
}

/** index.html 裡 `<filter id="…">` 的屬性與內容（primitive 子元素）；HTML 註解先拿掉 */
function svgFilter(html: string, id: string): SvgFilter | null {
  const m = new RegExp(`<filter\\b([^>]*\\bid="${id}"[^>]*)>([\\s\\S]*?)</filter>`).exec(html)
  if (!m) return null
  return { attrs: Object.fromEntries([...m[1].matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)].map(a => [a[1], a[2]])), body: m[2] }
}

/** 不帶單位的數字（使用者單位）：`-100` → -100；百分比、帶單位或沒寫 → null */
function userUnits(value: string | undefined): number | null {
  return value !== undefined && /^\s*-?\d*\.?\d+\s*$/.test(value) ? Number.parseFloat(value) : null
}

async function collect(dir: string): Promise<Source[]> {
  const sources: Source[] = []
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.css')) continue
    const full = path.join(entry.parentPath, entry.name)
    sources.push({ file: path.relative(dir, full), text: await readFile(full, 'utf-8') })
  }
  return sources
}

describe('黑板粉筆濾鏡', () => {
  it('圖表元素（.recharts-…）用的濾鏡是 userSpaceOnUse，區域是圖表座標的固定範圍、蓋住整張圖（資料是平的也畫得出線）', async () => {
    const refs = chartFilterRefs(await collect(RENDERER_DIR))
    // 掃描壞了的話「沒有發現」會空著通過：先確認黑板資料線那條（global.css）掃得到
    expect(refs.map(r => `${r.file} ${r.selector}`), '掃描壞了：黑板資料線的粉筆濾鏡應該掃得到')
      .toContain(`${path.join('styles', 'global.css')} [data-theme="board"] .recharts-area-curve`)
    for (const ref of refs) {
      const where = `${ref.file}:${ref.line} ${ref.selector}`
      const filter = svgFilter(INDEX_HTML, ref.id)
      expect(filter, `${where} 用的 #${ref.id}，index.html 裡沒有這個濾鏡`).not.toBeNull()
      expect(filter?.attrs.filterUnits, `${where} 用的 #${ref.id} 要寫 filterUnits="userSpaceOnUse"：預設的 objectBoundingBox `
        + '跟著線的外框，資料是平的時候外框高 0，濾鏡區域也是 0，整條線不畫（盲審 r1 #4）').toBe('userSpaceOnUse')
      const [x, y, width, height] = REGION_KEYS.map(k => userUnits(filter?.attrs[k]))
      const region = REGION_KEYS.map(k => `${k}=${filter?.attrs[k]}`).join(' ')
      expect([x, y, width, height].every(v => v !== null), `${where} 用的 #${ref.id} 的 x／y／width／height 要寫成不帶單位的數字`
        + `（圖表座標），不用百分比：百分比對哪個 viewport 算是瀏覽器的行為，這裡驗不到：${region}`).toBe(true)
      expect(x! <= REGION_NEAR && y! <= REGION_NEAR && x! + width! >= REGION_FAR && y! + height! >= REGION_FAR,
        `${where} 用的 #${ref.id} 的區域要蓋住整張圖（x、y ≤ ${REGION_NEAR}，x + width、y + height ≥ ${REGION_FAR}）：${region}`).toBe(true)
    }
  })

  it('掃描認得 module CSS 的 :global()、多行選擇器、@media 裡的規則、url 不在第一個、三種引號；註解與非圖表規則不算', () => {
    const css = [
      '.title, :global(.recharts-area-curve) { filter: url(#m1); }',
      ':global([data-theme="board"]) .chart :global(.recharts-line-curve) {',
      "  filter: drop-shadow(0 0 1px red) url('#m2');",
      '}',
      '/* :global(.recharts-area-curve) { filter: url(#in-comment) } */',
      '.recharts-bar-rectangle,',
      '.other {',
      '  filter: url("#m3");',
      '}',
      '.plain { filter: url(#not-a-chart); }',
      '@media (min-width: 1px) {',
      '  .x .recharts-area-curve { filter: url(#m4) }',
      '}',
    ].join('\n')
    const refs = chartFilterRefs([
      { file: path.join('components', 'X', 'X.module.css'), text: css },
      { file: path.join('components', 'X', 'X.tsx'), text: '.recharts-area-curve { filter: url(#in-tsx) }' },
    ])
    expect(refs.map(r => r.id)).toEqual(['m1', 'm2', 'm3', 'm4'])
    expect(refs.map(r => r.selector)).toEqual([
      '.title, :global(.recharts-area-curve)',
      ':global([data-theme="board"]) .chart :global(.recharts-line-curve)',
      '.recharts-bar-rectangle, .other',
      '.x .recharts-area-curve',
    ])
    expect(refs.map(r => r.line)).toEqual([1, 3, 8, 12])
  })

  it('#chalk-line 跟 #chalk 是同一份配方，只有區域不同（兩份別漂移）', () => {
    const chalk = svgFilter(INDEX_HTML, 'chalk')
    const line = svgFilter(INDEX_HTML, 'chalk-line')
    expect(chalk, 'index.html 沒有 #chalk').not.toBeNull()
    expect(line, 'index.html 沒有 #chalk-line（黑板資料線用的濾鏡，盲審 r1 #4）').not.toBeNull()
    const norm = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim()
    expect(norm(line?.body), '#chalk-line 的 primitive 要跟 #chalk 逐字相同').toBe(norm(chalk?.body))
    const REGION = new Set(['id', 'filterUnits', ...REGION_KEYS])
    const rest = (f: SvgFilter | null) => Object.fromEntries(Object.entries(f?.attrs ?? {}).filter(([k]) => !REGION.has(k)))
    expect(rest(line), '#chalk-line 的 id／filterUnits／區域以外的屬性要跟 #chalk 相同').toEqual(rest(chalk))
  })
})
