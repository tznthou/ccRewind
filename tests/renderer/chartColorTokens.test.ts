import { describe, it, expect } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { heatmapCellBackground } from '../../src/renderer/components/Dashboard/heatmapCell'
import { costHeatCellBackground } from '../../src/renderer/components/TokenBudget/costHeatCell'

/**
 * 儀表板與 Token Budget 的圖表色走 CSS 變數（--chart-*，定義在 global.css 的 :root）。寫死在元件裡的顏色換主題不會跟著變：
 * 黑板（深色板面）要給圖表另一組顏色，就得改得到每一處。這一步只把顏色搬進 token、畫面不變 —— :root 的值就是改前寫死的值，
 * 檔案室與終端機不寫圖表 token，照舊沿用 :root。
 *
 * 掃法：.ts／.tsx 看程式裡的每個字串（引號、樣板字串的每一段、JSX 屬性值；註解與 JSX 文字不是字串，ProjectHealth 的 &#9650; 在 JSX 文字裡），
 * .css 看每個宣告的值（註解先剝掉）。值裡的每個字面色都抓，不只第一個：border: 1.5px solid rgba(…) 的顏色在第三個。
 * 字面色 = #hex 與顏色函式（同 textColorTokens.test.ts 的 LITERAL），加上 CSS 具名色清單。具名色不用 textColorTokens 的「單字都算」：
 * 那條只看值的第一個字，套到每個字會把 var、flex、none、solid 都當成顏色。
 * var()、color-mix(… var(--x) …)、transparent、currentColor 不算；var(--x, #fff) 的後備值算（這裡不用後備值，要換色就寫成 token）。
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
 * 可能是顏色的片段：#hex（前面接 & 的是 HTML 字元參照）、顏色函式（color-mix 不是）、單字（前後接連字號、字母數字、點、# 或括號的不算：
 * --chart-cat-1、var(、i18n 鍵的 a.b.red）。單字再拿具名色清單過濾。
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

/** .css 每個宣告的值（註解換成等長的空白，行號不變） */
function declarationValuesIn(text: string): Value[] {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
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
    const values = file.endsWith('.css') ? declarationValuesIn(text) : stringsIn(file, text)
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

/** global.css 第一個 `:root {` 區塊裡的 token（註解先剝掉） */
function rootTokens(): Record<string, string> {
  const start = GLOBAL_CSS.indexOf(':root {')
  if (start === -1) throw new Error('global.css 沒有 :root')
  const body = GLOBAL_CSS.slice(start, GLOBAL_CSS.indexOf('\n}', start)).replace(/\/\*[\s\S]*?\*\//g, '')
  return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]))
}

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

  it(':root 的圖表 token 是改前寫死的值（畫面不變）', () => {
    const root = rootTokens()
    expect(Object.keys(root).length, '讀不到 :root 的 token').toBeGreaterThan(20)
    const chart = Object.entries(root).filter(([name]) => name.startsWith('--chart-'))
    expect(Object.fromEntries(chart.map(([name, value]) => [name, value.toLowerCase()]))).toEqual(BEFORE)
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
})

/**
 * 熱度底色：color-mix(in srgb, X p%, transparent) = X 透明度 p（themeContrast.test.ts 用的同一個等式），所以 p 要等於改前的透明度 × 100、不四捨五入。
 * 截圖抓不到這種差：spike 用了 Math.round，截圖照樣 0 差異。0.25 讓兩支都落在 32.5（四捨五入成 33 會紅）；成本熱度條的 1/3 剛好是整數 40。
 */
describe('熱度底色', () => {
  it('工作時段熱度圖：熱度色透明度 15% + 強度 × 70%', () => {
    for (const [intensity, percent] of [[0, 15], [1, 85], [1 / 3, 15 + 70 / 3], [0.25, 32.5]]) {
      expect(mixPercent(heatmapCellBackground(intensity), '--chart-heat'), `強度 ${intensity}`).toBeCloseTo(percent, 9)
    }
  })

  it('成本熱度條：成本熱度色透明度 10% + 強度 × 90%', () => {
    for (const [intensity, percent] of [[0, 10], [1, 100], [1 / 3, 40], [0.25, 32.5]]) {
      expect(mixPercent(costHeatCellBackground(intensity), '--chart-cost-heat'), `強度 ${intensity}`).toBeCloseTo(percent, 9)
    }
  })
})
