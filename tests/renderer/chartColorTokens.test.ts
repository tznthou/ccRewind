import { describe, it, expect } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { heatmapCellBackground } from '../../src/renderer/components/Dashboard/heatmapCell'
import { costHeatCellBackground } from '../../src/renderer/components/TokenBudget/costHeatCell'

/**
 * 儀表板與 Token Budget 的圖表色走 CSS 變數（--chart-*，只定義在 global.css 的 :root 與黑板區塊）。寫死在元件裡的顏色換主題不會跟著變：
 * 主題要給圖表另一組顏色，就得改得到元件裡的每一處。:root 的值是改前寫死的值（= 時間線）；黑板逐一明寫每個圖表 token
 * （黑板計畫 PR2 改動 10 ⑨：各主題要刻意定義，別處不准 —— 沒寫的會悄悄沿用時間線的圖表色）。
 * 熱度格、成本熱度格與建議清單的淡底改用 color-mix()：改前的 rgba() 透明度在 Chromium 裡量化成 1/255 一階，color-mix() 保留精確值，
 * 這三處畫出來最多差 1 個色階（2026-11-04 截圖實測；其他地方逐像素相同）。
 *
 * 掃法：.ts／.tsx 看程式裡的每個字串（引號、樣板字串的每一段、JSX 屬性值；註解與 JSX 文字不是字串，ProjectHealth 的 &#9650; 在 JSX 文字裡），
 * .css 看每個宣告的值（註解先剝掉）。值裡的每個字面色都抓，不只第一個：border: 1.5px solid rgba(…) 的顏色在第三個。
 * 字面色 = #hex 與顏色函式（同 textColorTokens.test.ts 的 LITERAL），加上 CSS 具名色清單。具名色不用 textColorTokens 的「單字都算」：
 * 那條只看值的第一個字，套到每個字會把 var、flex、none、solid 都當成顏色。
 * var()、color-mix(… var(--x) …)、transparent、currentColor 不算；var(--x, #fff) 的後備值算（這裡不用後備值，要換色就寫成 token）。
 *
 * 看不到的：recharts 自己的預設色（元件沒傳時，圓餅每片的白框、軸線與刻度線、hover 游標線、active dot 外圈都是它的字面色）；
 * 系統色（Canvas、Field、Mark 這類常見單字，不列）；url() 或字串裡的分號（會把宣告切斷）與字串裡的註解開頭；JSX 屬性裡 &#35; 這種字元參照。
 * CSS nesting（樣式規則裡再包規則）直接報錯：這裡只讀最內層的區塊，外層規則自己的宣告會被靜默跳過。
 */

const RENDERER_DIR = fileURLToPath(new URL('../../src/renderer', import.meta.url))
const CHART_DIRS = ['Dashboard', 'TokenBudget'].map(dir => path.join('components', dir))
const GLOBAL_CSS = readFileSync(path.join(RENDERER_DIR, 'styles', 'global.css'), 'utf-8')

/** CSS Color 4 的 148 個具名色 */
const NAMED_COLORS = new Set(`
  aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue
  chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey
  darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray
  darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen
  fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki
  lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen
  lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime
  limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue
  mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive
  olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum
  powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver
  skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white
  whitesmoke yellow yellowgreen
`.trim().split(/\s+/))

/**
 * 可能是顏色的片段：#hex（前面接 & 的是 HTML 字元參照）、顏色函式（color-mix 不是）、單字。單字前面不能接連字號、字母數字、點或 #
 * （--chart-cat-1、i18n 鍵的 a.b.red），後面不能接連字號、字母數字或左括號（var(）；前面接左括號、後面接點的照算
 * （light-dark(red, …) 抓得到，'red.png' 會被報）。單字再拿具名色清單過濾。
 */
const COLOR_CANDIDATE = /(?<![&\w])#[0-9a-f]{3,8}\b|(?<![-\w])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)?|(?<![-\w.#])[a-z]+(?![-\w(])/gi

interface Source {
  file: string
  text: string
}

interface Value {
  line: number
  text: string
}

interface Finding {
  file: string
  line: number
  color: string
  value: string
}

/** .ts／.tsx 裡的每個字串：引號、樣板字串的每一段、JSX 屬性值 */
function stringsIn(file: string, text: string): Value[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  const values: Value[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      values.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: node.text })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return values
}

/** 註解換成等長的空白（保留換行，位置與行號不變） */
function stripCssComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
}

/**
 * .css 每個宣告的值。只讀最內層的區塊，所以 CSS nesting（樣式規則裡再包規則）會讓外層規則自己的宣告被跳過 → 遇到就報錯，
 * 不靜默放過。@media、@supports、@keyframes 這類 at-rule 裡包規則是正常的。
 */
function declarationValuesIn(file: string, text: string): Value[] {
  const css = stripCssComments(text)
  const styleRule: boolean[] = []
  let boundary = 0
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') {
      if (styleRule[styleRule.length - 1]) throw new Error(`${file}:${css.slice(0, i).split('\n').length} 是 CSS nesting，外層規則的宣告這裡讀不到`)
      styleRule.push(!css.slice(boundary, i).trim().startsWith('@'))
      boundary = i + 1
    } else if (css[i] === '}') {
      styleRule.pop()
      boundary = i + 1
    } else if (css[i] === ';') {
      boundary = i + 1
    }
  }
  const values: Value[] = []
  for (const block of css.matchAll(/\{([^{}]*)\}/g)) {
    let at = block.index + 1
    for (const declaration of block[1].split(';')) {
      const colon = declaration.indexOf(':')
      if (colon !== -1) {
        values.push({ line: css.slice(0, at + colon).split('\n').length, text: declaration.slice(colon + 1).trim() })
      }
      at += declaration.length + 1
    }
  }
  return values
}

function hardCodedColors(sources: Source[]): Finding[] {
  const findings: Finding[] = []
  for (const { file, text } of sources) {
    const values = file.endsWith('.css') ? declarationValuesIn(file, text) : stringsIn(file, text)
    for (const { line, text: value } of values) {
      for (const [hit] of value.matchAll(COLOR_CANDIDATE)) {
        if (hit.startsWith('#') || hit.includes('(') || NAMED_COLORS.has(hit.toLowerCase())) {
          findings.push({ file, line, color: hit, value })
        }
      }
    }
  }
  return findings
}

async function collect(): Promise<Source[]> {
  const sources: Source[] = []
  for (const dir of CHART_DIRS) {
    for (const entry of await readdir(path.join(RENDERER_DIR, dir), { withFileTypes: true, recursive: true })) {
      if (!entry.isFile() || !/\.(css|tsx?)$/.test(entry.name) || entry.name.includes('.test.')) continue
      const full = path.join(entry.parentPath, entry.name)
      sources.push({ file: path.relative(RENDERER_DIR, full), text: await readFile(full, 'utf-8') })
    }
  }
  return sources
}

/** renderer 底下所有的 .css */
async function collectCss(): Promise<Source[]> {
  const sources: Source[] = []
  for (const entry of await readdir(RENDERER_DIR, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.css')) continue
    const full = path.join(entry.parentPath, entry.name)
    sources.push({ file: path.relative(RENDERER_DIR, full), text: await readFile(full, 'utf-8') })
  }
  return sources
}

const GLOBAL_CSS_FILE = path.join('styles', 'global.css')

/** global.css 裡准定義 --chart-* 的區塊：第一個 `:root {` 與第一個 `[data-theme="board"] {`（開頭與結尾的位置） */
const ALLOWED_BLOCKS = [':root {', '[data-theme="board"] {']

/**
 * --chart-* 定義在准用區塊以外的位置。:root 的值鎖住了，但其他主題區塊、第二個 :root 或黑板區塊、@media 或元件 CSS 裡
 * 另外定義的話，那裡的圖表色就跟兩個准用區塊不同，而鎖值的那條照樣綠（前三種審查時都重現過）。
 */
function chartTokensDefinedOutsideAllowed(sources: Source[]): string[] {
  const outside: string[] = []
  for (const { file, text } of sources) {
    const css = stripCssComments(text)
    const ranges: [number, number][] = file !== GLOBAL_CSS_FILE ? [] : ALLOWED_BLOCKS.flatMap(head => {
      const start = css.indexOf(head)
      return start === -1 ? [] : [[start, css.indexOf('\n}', start)] as [number, number]]
    })
    for (const m of css.matchAll(/(?<![\w-])(--chart-[\w-]+)\s*:/g)) {
      if (ranges.some(([start, end]) => m.index > start && m.index < end)) continue
      outside.push(`${file}:${css.slice(0, m.index).split('\n').length} ${m[1]}`)
    }
  }
  return outside
}

/** global.css 第一個 `<head>` 區塊裡的 token（註解先剝掉）；沒有這個區塊回空物件 */
function blockTokens(head: string): Record<string, string> {
  const start = GLOBAL_CSS.indexOf(head)
  if (start === -1) return {}
  const body = GLOBAL_CSS.slice(start, GLOBAL_CSS.indexOf('\n}', start)).replace(/\/\*[\s\S]*?\*\//g, '')
  return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]))
}
const rootTokens = () => blockTokens(':root {')
const chartNames = (tokens: Record<string, string>) => Object.keys(tokens).filter(name => name.startsWith('--chart-')).sort()

/**
 * 改前寫死在元件裡的值。熱度圖的 rgba(59, 130, 246, …) = #3b82f6、成本熱度條的 rgba(245, 158, 11, …) = #f59e0b
 * （透明度改由 color-mix 給，見下面的熱度底色）。
 */
const BEFORE: Record<string, string> = {
  // DistributionPieChart 的 DEFAULT_COLORS，同順序；TagDistribution 是同 8 色換序（3, 1, 4, 5, 6, 7, 2, 8）
  '--chart-cat-1': '#3b82f6',
  '--chart-cat-2': '#0891b2',
  '--chart-cat-3': '#22c55e',
  '--chart-cat-4': '#f59e0b',
  '--chart-cat-5': '#ef4444',
  '--chart-cat-6': '#8b5cf6',
  '--chart-cat-7': '#ec4899',
  '--chart-cat-8': '#64748b',
  // outcomeColors 的 OUTCOME_COLORS：專案健康度的長條與圖例
  '--chart-outcome-committed': '#22c55e',
  '--chart-outcome-tested': '#3b82f6',
  '--chart-outcome-in-progress': '#f59e0b',
  '--chart-outcome-quick-qa': '#06b6d4',
  '--chart-outcome-unknown': 'var(--color-text-muted)',
  // UsageTrendChart、EfficiencyTrendChart、WorkPatternHeatmap
  '--chart-usage-sessions': '#3b82f6',
  '--chart-usage-tokens': '#f59e0b',
  '--chart-efficiency': '#10b981',
  '--chart-heat': '#3b82f6',
  // TokenBudget：chartConstants 的 TOKEN_COLORS 與 MARKER_COLORS（也是建議清單 warning／info 的左框與淡底）、CostHeatBar
  '--chart-token-cache-read': '#67e8f9',
  '--chart-token-cache-creation': '#0891b2',
  '--chart-token-new-input': '#0c4a6e',
  '--chart-token-output': '#f59e0b',
  '--chart-marker-warning': '#f59e0b',
  '--chart-marker-info': '#3b82f6',
  '--chart-cost-heat': '#f59e0b',
  // recharts 3.10.1 沒傳時自己畫的字面色（黑板計畫 PR2 改動 6）：圓餅每片的框（polar/Pie.js）、Area 的 hover 圓點外圈
  // （component/ActivePoints.js）、軸線與刻度線（cartesian/CartesianAxis.js）、Tooltip 的游標線（component/Cursor.js）
  '--chart-slice-gap': '#fff',
  '--chart-dot-ring': '#fff',
  '--chart-axis': '#666',
  '--chart-cursor': '#ccc',
}

/**
 * recharts 沒傳就畫自己的字面色（上面 BEFORE 的最後四個）。「沒有寫死的顏色」看不到它們（不在我們的原始碼裡），
 * 主題也換不到 → 會畫的元件都要傳主題 token（時間線的 token 值就是 recharts 的預設值，畫面不變）。
 * 軸線、刻度線傳 false（不畫）也算；Tooltip 的游標線只在直角座標圖畫，圓餅圖的 Tooltip 不用傳。
 */
const RECHARTS_DEFAULT_PROPS: Record<string, string[]> = {
  Pie: ['stroke'],
  XAxis: ['axisLine', 'tickLine'],
  YAxis: ['axisLine', 'tickLine'],
  Area: ['activeDot'],
}
const CARTESIAN_CHART = /<(AreaChart|BarChart|LineChart|ComposedChart)\b/

/** 會畫 recharts 預設色、卻沒傳對應屬性的元件（`檔案:行 元件 缺的屬性`），以及掃到的元件數（防空過） */
function missingRechartsProps(sources: Source[]): { missing: string[]; seen: Record<string, number> } {
  const missing: string[] = []
  const seen: Record<string, number> = {}
  for (const { file, text } of sources) {
    if (!file.endsWith('.tsx')) continue
    const required: Record<string, string[]> = CARTESIAN_CHART.test(text) ? { ...RECHARTS_DEFAULT_PROPS, Tooltip: ['cursor'] } : RECHARTS_DEFAULT_PROPS
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = (node: ts.Node): void => {
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const tag = node.tagName.getText(sf)
        if (tag in required) {
          seen[tag] = (seen[tag] ?? 0) + 1
          const attrs = new Set(node.attributes.properties.flatMap(p => (ts.isJsxAttribute(p) ? [p.name.getText(sf)] : [])))
          const lacking = required[tag].filter(name => !attrs.has(name))
          if (lacking.length) missing.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} ${tag} ${lacking.join(',')}`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return { missing, seen }
}

/** `color-mix(in srgb, var(--x) P%, transparent)` 的 P；格式或 token 不對就紅 */
function mixPercent(background: string, token: string): number {
  const m = /^color-mix\(in srgb, var\((--[\w-]+)\) (\S+)%, transparent\)$/.exec(background)
  expect(m?.[1], `格式不對：${background}`).toBe(token)
  return Number(m?.[2])
}

const show = (f: Finding) => `${f.file}:${f.line}  ${f.color}  ← ${f.value}`

describe('圖表色走 CSS 變數', () => {
  it('儀表板與 Token Budget 的元件沒有寫死的顏色', async () => {
    const sources = await collect()
    // 路徑錯或沒掃到檔案時，「沒有發現」會空著通過：先確認 .tsx、.ts、.css 都掃到了
    expect(sources.map(s => s.file)).toEqual(expect.arrayContaining([
      path.join('components', 'Dashboard', 'DistributionPieChart.tsx'),
      path.join('components', 'Dashboard', 'outcomeColors.ts'),
      path.join('components', 'TokenBudget', 'chartConstants.ts'),
      path.join('components', 'TokenBudget', 'TokenBudget.module.css'),
    ]))
    const findings = hardCodedColors(sources)
    expect(findings.map(show), `寫死的顏色要改成 global.css 的 --chart-* token：\n${findings.map(show).join('\n')}`).toEqual([])
  })

  it(':root 的圖表 token 是改前寫死的值', () => {
    const root = rootTokens()
    expect(Object.keys(root).length, '讀不到 :root 的 token').toBeGreaterThan(20)
    const chart = Object.entries(root).filter(([name]) => name.startsWith('--chart-'))
    expect(Object.fromEntries(chart.map(([name, value]) => [name, value.toLowerCase()]))).toEqual(BEFORE)
  })

  it('--chart-* 只定義在 global.css 的 :root 與黑板區塊', async () => {
    const css = await collectCss()
    expect(css.map(s => s.file)).toContain(GLOBAL_CSS_FILE)
    expect(chartTokensDefinedOutsideAllowed(css)).toEqual([])
  })

  it('黑板區塊逐一明寫 :root 的每個 --chart-* token（缺的會沿用時間線的圖表色，多的沒人用）', () => {
    const root = chartNames(rootTokens())
    expect(root.length, '讀不到 :root 的圖表 token').toBeGreaterThan(20)
    expect(chartNames(blockTokens('[data-theme="board"] {')), '黑板區塊的圖表 token 要跟 :root 同一組').toEqual(root)
  })

  it('抓得到其他主題區塊、第二個 :root 或黑板區塊、@media 與元件裡的 --chart-* 定義；兩個准用區塊裡的、註解與引用不算', () => {
    expect(chartTokensDefinedOutsideAllowed([
      {
        file: GLOBAL_CSS_FILE,
        text: [
          ':root {',
          '  --chart-cat-1: #3b82f6;',
          '  /* --chart-x: red; */',
          '}',
          '[data-theme="board"] {',
          '  --chart-cat-1: #f2f0e7;',
          '}',
          '[data-theme="terminal"] {',
          '  --chart-cat-1: #ff0000;',
          '}',
          ':root { --chart-heat: #ff0000; }',
          '[data-theme="board"] { --chart-heat: #00ff00; }',
          '@media (prefers-contrast: more) { :root { --chart-token-output: #000000; } }',
        ].join('\n'),
      },
      { file: 'a.module.css', text: '.a { --chart-efficiency: red; fill: var(--chart-efficiency); }' },
    ])).toEqual([
      `${GLOBAL_CSS_FILE}:9 --chart-cat-1`,
      `${GLOBAL_CSS_FILE}:11 --chart-heat`,
      `${GLOBAL_CSS_FILE}:12 --chart-heat`,
      `${GLOBAL_CSS_FILE}:13 --chart-token-output`,
      'a.module.css:1 --chart-efficiency',
    ])
  })

  it('值裡每個字面色都抓；var()、color-mix(var())、關鍵字、HTML 字元參照、註解、JSX 文字與 i18n 鍵不算', () => {
    expect(NAMED_COLORS.size).toBe(148)
    const findings = hardCodedColors([
      {
        file: 'a.module.css',
        text: [
          '.a {',
          '  border: 1.5px solid rgba(0,0,0,.5);',
          '  background: #0B2A1B;',
          '}',
          '/* color: #fff */',
          '.b { border: 1px solid var(--x); background: color-mix(in srgb, var(--color-text) 45%, transparent); fill: none }',
          '.c { outline: 2px dashed white; box-shadow: 0 0 0 1px var(--y), inset 0 1px hsl(0 0% 50%) }',
          '.d { background: var(--z, #fff) }',
        ].join('\n'),
      },
      {
        file: 'B.tsx',
        text: [
          '// stroke="#fff" 是註解',
          "const up = '&#9650;'",
          'export const X = () => <Area type="monotone" stroke="#10b981" fill="var(--chart-x)" />',
          'const c = `rgba(59, 130, 246, ${0.5})`',
          "const d = ['var(--chart-cat-1)', 'transparent', 'currentColor']",
          'export const Y = () => <p>&#9660; red<path fill="none" /></p>',
        ].join('\n'),
      },
      { file: 'c.ts', text: "export const M = { warning: '#f59e0b', label: 'dashboard.outcome.red' }" },
    ])
    expect(findings.map(f => `${f.file}:${f.line} ${f.color}`)).toEqual([
      'a.module.css:2 rgba(0,0,0,.5)',
      'a.module.css:3 #0B2A1B',
      'a.module.css:7 white',
      'a.module.css:7 hsl(0 0% 50%)',
      'a.module.css:8 #fff',
      'B.tsx:3 #10b981',
      'B.tsx:4 rgba(59, 130, 246, ',
      'c.ts:1 #f59e0b',
    ])
  })

  it('recharts 會自己畫預設色的元件都傳了主題 token（圓餅的框、軸線與刻度線、直角座標圖的游標線、hover 圓點外圈）', async () => {
    const { missing, seen } = missingRechartsProps(await collect())
    // 掃不到元件時「沒有缺」會空著通過：儀表板與 Token Budget 現在有 2 個圓餅、4 個 Area、3 張直角座標圖（7 個軸）
    expect(seen.Pie, '圓餅').toBeGreaterThanOrEqual(2)
    expect(seen.Area, 'Area').toBeGreaterThanOrEqual(4)
    expect(seen.Tooltip, '直角座標圖的 Tooltip').toBeGreaterThanOrEqual(3)
    expect((seen.XAxis ?? 0) + (seen.YAxis ?? 0), '軸').toBeGreaterThanOrEqual(7)
    expect(missing, `要傳主題 token（時間線的值 = recharts 預設）：\n${missing.join('\n')}`).toEqual([])
  })

  it('抓得到沒傳的屬性；傳 false 算有傳；圓餅圖的 Tooltip 不用傳游標線', () => {
    const { missing } = missingRechartsProps([
      {
        file: 'A.tsx',
        text: [
          'export const A = () => (',
          '  <AreaChart>',
          '    <XAxis tickLine={false} />',
          '    <YAxis axisLine={false} tickLine={false} />',
          '    <Tooltip />',
          '    <Area stroke="var(--x)" />',
          '  </AreaChart>',
          ')',
        ].join('\n'),
      },
      { file: 'P.tsx', text: 'export const P = () => <PieChart><Pie data={[]} /><Tooltip /></PieChart>' },
    ])
    expect(missing).toEqual(['A.tsx:3 XAxis axisLine', 'A.tsx:5 Tooltip cursor', 'A.tsx:6 Area activeDot', 'P.tsx:1 Pie stroke'])
  })

  it('at-rule 裡包規則照常掃；CSS nesting 直接報錯，不靜默跳過外層的宣告', () => {
    const atRules = [
      '@media (max-width: 800px) {',
      '  .a { background: white }',
      '}',
      '@keyframes k { from { opacity: 0 } to { opacity: 1 } }',
    ].join('\n')
    expect(hardCodedColors([{ file: 'm.module.css', text: atRules }]).map(f => `${f.line} ${f.color}`)).toEqual(['2 white'])
    const nested = '.a {\n  color: red;\n  &:hover { opacity: 1 }\n}'
    expect(() => hardCodedColors([{ file: 'n.module.css', text: nested }])).toThrow('n.module.css:3 是 CSS nesting')
  })
})

/**
 * 熱度底色：color-mix(in srgb, X p%, transparent) = X 透明度 p（themeContrast.test.ts 用的同一個等式），p 是改前的透明度 × 100、不取整。
 * 截圖不一定看得出取整的差（最多 1 個色階），所以鎖在這裡：0.25 讓兩支都落在 32.5（四捨五入成 33 會紅）；1/3 讓熱度圖落在 38.33…、
 * 1/7 讓成本熱度條落在 22.857…（只留一兩位小數或取到 0.5 都會紅）；成本熱度條的 1/3 剛好是整數 40。
 */
describe('熱度底色', () => {
  it('工作時段熱度圖：熱度色透明度 15% + 強度 × 70%', () => {
    for (const [intensity, percent] of [[0, 15], [1, 85], [1 / 3, 15 + 70 / 3], [0.25, 32.5], [1 / 7, 25]]) {
      expect(mixPercent(heatmapCellBackground(intensity), '--chart-heat'), `強度 ${intensity}`).toBeCloseTo(percent, 9)
    }
  })

  it('成本熱度條：成本熱度色透明度 10% + 強度 × 90%', () => {
    for (const [intensity, percent] of [[0, 10], [1, 100], [1 / 3, 40], [0.25, 32.5], [1 / 7, 10 + 90 / 7]]) {
      expect(mixPercent(costHeatCellBackground(intensity), '--chart-cost-heat'), `強度 ${intensity}`).toBeCloseTo(percent, 9)
    }
  })
})
