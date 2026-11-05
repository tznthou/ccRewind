import { describe, it, expect } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { formatTokens } from '../../src/renderer/utils/formatTokens'

/**
 * 縱軸的刻度字要整個畫得出來。
 *
 * recharts 把刻度字貼著軸線排：左軸的字靠右對齊在「軸寬 − tickSize − tickMargin」，右軸的字從 tickSize + tickMargin
 * 往右寫；超出圖表 svg 的部分直接被切掉（svg 的 overflow 是 hidden）。圖表在那一側的 margin 也在 svg 裡，
 * 所以一個縱軸放得下的字寬 = width − tickSize − tickMargin + 那一側的 margin。
 *
 * v1.29.0 把刻度字從 11px 放大到 12px，軸寬沒跟著改：時間線主題的對話長度圖，"500.0K" 寬 45px，48px 的軸只放得下
 * 40px，左邊被切掉 5px。時間線的字型每個數字寬度不同（"1" 4.5px、"0" 8.8px），刻度多寬要看剛好是哪些數字，
 * 一場對話量不出最寬的情況：這裡把最長的刻度每一位都換成最寬的數字來算。
 *
 * 字寬是事實：各主題刻度字型在 12px 的字寬，2026-11-05 在 app 裡量（複製一個縱軸刻度的 <text>、逐字換文字，
 * 量 getBoundingClientRect 的寬度）。刻度字型就是內文字型（--font-body），當天三個主題實測都是。
 * 整串比逐字加總窄一點（字距調整，最多 0.27px），所以逐字加總是上界。換字型或加主題時「每個主題的內文字型都在
 * 字寬表裡」會紅：用同樣的方法量新字型補進來（系統字型在每個平台不一樣，每個平台都量、取最寬的）。
 *
 * 已知抓不到：圖表外層的元素另外設 font-family（刻度字會繼承它，不是 --font-body）；只認具名匯入的 YAxis 與
 * 圖表元件（同 chartTooltips.test.ts）。width、刻度字級、tickSize／tickMargin、圖表 margin 要寫成數字，
 * 其他寫法看不出能放多寬，直接列成問題。
 */

const RENDERER_DIR = fileURLToPath(new URL('../../src/renderer', import.meta.url))

// recharts 的預設值從套件讀（3.10.1：tickSize 6、tickMargin 2、YAxis width 60、圖表 margin 四邊 5），升版改了這裡跟著算
const requireCjs = createRequire(import.meta.url)
const AXIS_DEFAULTS = (requireCjs('recharts/lib/cartesian/CartesianAxis') as {
  defaultCartesianAxisProps: { tickSize: number; tickMargin: number }
}).defaultCartesianAxisProps
const YAXIS_DEFAULT_WIDTH = (requireCjs('recharts/lib/cartesian/YAxis') as { yAxisDefaultProps: { width: number } })
  .yAxisDefaultProps.width
const CHART_DEFAULT_MARGIN = (requireCjs('recharts/lib/chart/CartesianChart') as {
  defaultCartesianChartProps: { margin: { left: number; right: number } }
}).defaultCartesianChartProps.margin

/** 各主題刻度字型 12px 的字寬（px），2026-11-05 在 app 裡量 */
const GLYPH_WIDTH_12PX: Record<string, Record<string, number>> = {
  // 時間線
  'Plus Jakarta Sans': {
    0: 8.789, 1: 4.453, 2: 7.203, 3: 7.313, 4: 7.563, 5: 7.398, 6: 7.164, 7: 6.523, 8: 7.539, 9: 7.164,
    '.': 3.438, K: 7.852, M: 10.039,
  },
  // 終端機、檔案室
  'IBM Plex Sans': {
    0: 7.203, 1: 7.203, 2: 7.203, 3: 7.203, 4: 7.203, 5: 7.203, 6: 7.203, 7: 7.203, 8: 7.203, 9: 7.203,
    '.': 3.266, K: 7.609, M: 9.75,
  },
}

/** 同一次量的整串寬度：逐字加總要比它寬一點點（上界），差太多就是表抄錯了 */
const MEASURED_WHOLE_12PX: Record<string, Record<string, number>> = {
  'Plus Jakarta Sans': { '500.0K': 45.031, '240.0K': 43.492, '750.0K': 42.523, '1400.0M': 51.828 },
  'IBM Plex Sans': { '500.0K': 39.68, '1400.0M': 49.016 },
}

/**
 * 每個縱軸最長的刻度長什麼樣（key：src/renderer 底下的路徑#yAxisId，沒給 yAxisId 是 recharts 預設的 0）。
 * 刻度是 recharts 挑的整齊數字（250K、350M 這類），不會是 999,999 這種被 formatTokens 進位成 "1000.0K" 的值，
 * 所以 K 最多三位整數。寫兩個以上就取最寬的。
 */
const LONGEST_TICKS: Record<string, string[]> = {
  // 對話長度：一次呼叫的 context 最多 1M
  'components/TokenBudget/ContextGrowthChart.tsx#0': [formatTokens(999_900), formatTokens(9_900_000)],
  // 每天的 session 數：當作少於 1000；session 少的時候 recharts 會挑 0.25、0.75、2.25 這種小數刻度
  'components/Dashboard/UsageTrendChart.tsx#sessions': [String(999), String(2.25)],
  // 每天的 token 數：當作少於 100 億（formatTokens 沒有 B，再多就是 8 個字的 "10000.0M"）
  'components/Dashboard/UsageTrendChart.tsx#tokens': [formatTokens(999_900), formatTokens(9_999_900_000)],
  // 每則訊息平均的 token：一次呼叫的 context 最多 1M
  'components/Dashboard/EfficiencyTrendChart.tsx#0': [formatTokens(999_900), formatTokens(9_900_000)],
}

const CHART_KINDS = ['AreaChart', 'BarChart', 'ComposedChart', 'LineChart', 'ScatterChart']
/** tick 物件裡不影響字寬的屬性；其他（fontFamily、fontWeight、letterSpacing…）會讓字寬表不準 */
const TICK_KEYS_OK = ['fontSize', 'fill']

interface YAxisFacts {
  where: string
  key: string
  /** 能放多寬（px）；看不出來是 null，原因在 problems */
  room: number | null
  fontSize: number | null
  problems: string[]
}

/** 每一位數字都換成最寬的數字，算這個刻度最寬會到多少（12px） */
function widestWidth(sample: string, glyphs: Record<string, number>): number {
  const widestDigit = Math.max(...[...'0123456789'].map(d => glyphs[d]))
  let sum = 0
  for (const c of sample) {
    const w = /\d/.test(c) ? widestDigit : glyphs[c]
    if (w === undefined) throw new Error(`字寬表沒有「${c}」`)
    sum += w
  }
  return sum
}

const num = (e: ts.Expression | null | undefined): number | null => (e && ts.isNumericLiteral(e) ? Number(e.text) : null)
const text = (e: ts.Expression | null | undefined): string | null =>
  e && (ts.isStringLiteral(e) || ts.isNumericLiteral(e)) ? e.text : null

/** 物件字面值的屬性；有展開或計算出來的名稱就看不出來，回 null */
function objectLiteral(e: ts.Expression | null | undefined): Map<string, ts.Expression> | null {
  if (!e || !ts.isObjectLiteralExpression(e)) return null
  const props = new Map<string, ts.Expression>()
  for (const p of e.properties) {
    if (!ts.isPropertyAssignment(p) || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) return null
    props.set(p.name.text, p.initializer)
  }
  return props
}

/** JSX 元素的屬性：名稱 → 值（布林屬性與看不懂的值是 null）；有 {...展開} 時 spread 為 true */
function attributes(el: ts.JsxOpeningLikeElement, sf: ts.SourceFile) {
  const attrs = new Map<string, ts.Expression | null>()
  let spread = false
  for (const p of el.attributes.properties) {
    if (!ts.isJsxAttribute(p)) { spread = true; continue }
    const init = p.initializer
    attrs.set(p.name.getText(sf), !init ? null : ts.isStringLiteral(init) ? init : ts.isJsxExpression(init) ? init.expression ?? null : null)
  }
  return { attrs, spread }
}

function scanYAxes(file: string, source: string): YAxisFacts[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  // 從 recharts 匯入的元件在這個檔案裡叫什麼（可能用 as 改名）：本地名稱 → recharts 的名稱
  const recharts = new Map<string, string>()
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier) || stmt.moduleSpecifier.text !== 'recharts') continue
    const bindings = stmt.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const el of bindings.elements) recharts.set(el.name.text, (el.propertyName ?? el.name).text)
  }
  const kind = (el: ts.JsxOpeningLikeElement) => recharts.get(el.tagName.getText(sf))

  const axes: (YAxisFacts & { chart: ts.Node | undefined; side: string | null })[] = []
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && kind(node) === 'YAxis') {
      const problems: string[] = []
      const { attrs, spread } = attributes(node, sf)
      if (spread) problems.push('有 {...} 展開的屬性，看不出寫了什麼')
      const id = attrs.has('yAxisId') ? text(attrs.get('yAxisId')) : '0'
      if (id === null) problems.push('yAxisId 要寫成字串或數字')
      const side = attrs.has('orientation') ? text(attrs.get('orientation')) : 'left'
      if (side !== 'left' && side !== 'right') problems.push('orientation 要寫成 "left" 或 "right"')
      const width = attrs.has('width') ? num(attrs.get('width')) : YAXIS_DEFAULT_WIDTH
      if (width === null) problems.push('width 要寫成數字')
      const tickSize = attrs.has('tickSize') ? num(attrs.get('tickSize')) : AXIS_DEFAULTS.tickSize
      const tickMargin = attrs.has('tickMargin') ? num(attrs.get('tickMargin')) : AXIS_DEFAULTS.tickMargin
      if (tickSize === null || tickMargin === null) problems.push('tickSize／tickMargin 要寫成數字')
      for (const name of ['mirror', 'angle']) if (attrs.has(name)) problems.push(`${name} 會改刻度的位置或寬度，這裡沒算`)
      const tick = objectLiteral(attrs.get('tick'))
      let fontSize: number | null = null
      if (!tick) problems.push('tick 要寫成 { fontSize: 數字, fill } 物件（沒寫字級就跟著內文字級變）')
      else {
        fontSize = num(tick.get('fontSize'))
        if (fontSize === null) problems.push('tick.fontSize 要寫成數字')
        for (const k of tick.keys()) if (!TICK_KEYS_OK.includes(k)) problems.push(`tick 的 ${k} 會改字寬，字寬表沒算到`)
      }
      // 往上找包著它的圖表，讀那一側的 margin
      let chart: ts.Node | undefined = node.parent
      while (chart && !(ts.isJsxElement(chart) && CHART_KINDS.includes(kind(chart.openingElement) ?? ''))) chart = chart.parent
      let margin: { left: number; right: number } | null = null
      if (!chart || !ts.isJsxElement(chart)) problems.push('不在 recharts 的圖表元件裡')
      else {
        const chartAttrs = attributes(chart.openingElement, sf).attrs
        if (!chartAttrs.has('margin')) margin = CHART_DEFAULT_MARGIN
        else {
          const m = objectLiteral(chartAttrs.get('margin'))
          const left = num(m?.get('left'))
          const right = num(m?.get('right'))
          if (left === null || right === null) problems.push('圖表的 margin 要寫成有 left、right 數字的物件')
          else margin = { left, right }
        }
      }
      const room = problems.length === 0 && width !== null && tickSize !== null && tickMargin !== null && margin
        ? width - tickSize - tickMargin + (side === 'right' ? margin.right : margin.left)
        : null
      axes.push({
        where: `${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`,
        key: `${file}#${id}`,
        room,
        fontSize,
        problems,
        chart,
        side,
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  // 同一張圖同一側有兩個縱軸時，裡面那個的外側不是 margin，上面的算法不成立
  for (const a of axes) {
    if (a.chart && axes.some(b => b !== a && b.chart === a.chart && b.side === a.side)) {
      a.problems.push(`同一張圖的 ${a.side} 側有兩個以上縱軸，這裡沒算`)
      a.room = null
    }
  }
  return axes.map(a => ({ where: a.where, key: a.key, room: a.room, fontSize: a.fontSize, problems: a.problems }))
}

let scanned: Promise<YAxisFacts[]> | undefined
function scanRenderer(): Promise<YAxisFacts[]> {
  scanned ??= (async () => {
    const out: YAxisFacts[] = []
    for (const entry of await readdir(RENDERER_DIR, { withFileTypes: true, recursive: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.tsx')) continue
      const full = path.join(entry.parentPath, entry.name)
      const file = path.relative(RENDERER_DIR, full).split(path.sep).join('/')
      out.push(...scanYAxes(file, await readFile(full, 'utf-8')))
    }
    return out
  })()
  return scanned
}

/** CSS 註解換成等長的空白（保留換行，行號不變） */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
}

async function readCss(): Promise<{ file: string; css: string }[]> {
  const out: { file: string; css: string }[] = []
  for (const entry of await readdir(RENDERER_DIR, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.css')) continue
    const full = path.join(entry.parentPath, entry.name)
    out.push({ file: path.relative(RENDERER_DIR, full), css: stripCssComments(await readFile(full, 'utf-8')) })
  }
  return out
}

/** font-family 清單的第一個字型（去掉引號） */
function firstFamily(value: string): string {
  return value.split(',')[0].trim().replace(/^(['"])(.*)\1$/, '$2')
}

describe('縱軸的刻度字放得下', () => {
  it('字寬表跟同一次量的整串寬度對得上：逐字加總比整串寬一點點', () => {
    expect(Object.keys(MEASURED_WHOLE_12PX).sort()).toEqual(Object.keys(GLYPH_WIDTH_12PX).sort())
    for (const [font, strings] of Object.entries(MEASURED_WHOLE_12PX)) {
      for (const [s, whole] of Object.entries(strings)) {
        const sum = [...s].reduce((acc, c) => acc + GLYPH_WIDTH_12PX[font][c], 0)
        expect(sum - whole, `${font} "${s}"`).toBeGreaterThanOrEqual(0)
        expect(sum - whole, `${font} "${s}"`).toBeLessThan(0.3)
      }
    }
  })

  it('每個主題的內文字型（刻度字型）都在字寬表裡，表裡也沒有已經沒人用的字型', async () => {
    const families = new Set<string>()
    for (const { css } of await readCss()) {
      for (const m of css.matchAll(/--font-body\s*:\s*([^;}]+)/g)) families.add(firstFamily(m[1]))
    }
    expect([...families].sort()).toEqual(Object.keys(GLYPH_WIDTH_12PX).sort())
  })

  it('沒有樣式另外改 recharts 的字型、字級或字距（字寬表量的是內文字型）', async () => {
    const offenders: string[] = []
    const FONT_PROP = /(?<![-\w])(font|font-family|font-size|font-weight|font-style|font-stretch|font-variant(?:-[\w-]+)?|font-feature-settings|letter-spacing|word-spacing)\s*:/
    for (const { file, css } of await readCss()) {
      for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
        if (/recharts/.test(m[1]) && FONT_PROP.test(m[2])) offenders.push(`${file}: ${m[1].trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('每個 recharts 縱軸都宣告了最長的刻度，宣告的也都找得到', async () => {
    const found = (await scanRenderer()).map(a => a.key).sort()
    expect(found).toEqual(Object.keys(LONGEST_TICKS).sort())
  })

  it.each(Object.keys(LONGEST_TICKS))('%s：最長的刻度在每個主題都放得下', async key => {
    const axis = (await scanRenderer()).find(a => a.key === key)
    expect(axis, `找不到 ${key}`).toBeDefined()
    if (!axis) return
    expect(axis.problems, axis.where).toEqual([])
    const short: string[] = []
    for (const [font, glyphs] of Object.entries(GLYPH_WIDTH_12PX)) {
      for (const sample of LONGEST_TICKS[key]) {
        const need = (widestWidth(sample, glyphs) * (axis.fontSize ?? NaN)) / 12
        if (!(need <= (axis.room ?? NaN))) short.push(`${font} "${sample}" 最寬要 ${need.toFixed(2)}px，軸只放得下 ${axis.room}px`)
      }
    }
    expect(short, axis.where).toEqual([])
  })

  it('從 recharts 讀到的預設值（3.10.1；升版改了這裡會紅，核對新值後改這裡，上面的算法已經跟著用新值）', () => {
    expect({ ...AXIS_DEFAULTS, width: YAXIS_DEFAULT_WIDTH, left: CHART_DEFAULT_MARGIN.left, right: CHART_DEFAULT_MARGIN.right })
      .toMatchObject({ tickSize: 6, tickMargin: 2, width: 60, left: 5, right: 5 })
  })

  it('最寬的刻度：每一位換成最寬的數字，其他字照表', () => {
    const glyphs = GLYPH_WIDTH_12PX['Plus Jakarta Sans']
    expect(widestWidth('240.0K', glyphs)).toBeCloseTo(8.789 * 4 + 3.438 + 7.852, 6)
    expect(widestWidth('12', glyphs)).toBeCloseTo(8.789 * 2, 6)
    expect(() => widestWidth('1.0B', glyphs)).toThrow('字寬表沒有「B」')
  })

  it('掃描器：讀得到寬度、字級、預設值與那一側的 margin，看不出來的寫法列成問題', () => {
    const src = [
      "import { AreaChart, LineChart, YAxis, YAxis as Axis } from 'recharts'",
      'const a = (',
      '  <AreaChart margin={{ top: 4, right: 8, left: 3, bottom: 0 }}>',
      '    <YAxis tick={{ fontSize: 12, fill: c }} width={50} />',
      '    <Axis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} width={40} tickMargin={4} />',
      '  </AreaChart>',
      ')',
      'const b = (',
      '  <LineChart>',
      '    <YAxis yAxisId={1} tick={{ fontSize: 12 }} />',
      '    <YAxis yAxisId={2} tick={{ fontSize: 12, fontFamily: f }} width="auto" mirror />',
      '  </LineChart>',
      ')',
      'const c = <YAxis tick={t} width={40} />',
    ].join('\n')
    const axes = scanYAxes('x.tsx', src)
    expect(axes.map(a => [a.where, a.key, a.room, a.fontSize])).toEqual([
      // 50 − 6 − 2 + 左邊 margin 3
      ['x.tsx:4', 'x.tsx#0', 45, 12],
      // 40 − 6 − 4 + 右邊 margin 8
      ['x.tsx:5', 'x.tsx#r', 38, 11],
      // 沒寫 width、margin：recharts 預設 60 − 6 − 2 + 5；但同一側有兩個軸
      ['x.tsx:10', 'x.tsx#1', null, 12],
      ['x.tsx:11', 'x.tsx#2', null, 12],
      ['x.tsx:14', 'x.tsx#0', null, null],
    ])
    expect(axes[0].problems).toEqual([])
    expect(axes[1].problems).toEqual([])
    expect(axes[2].problems).toEqual(['同一張圖的 left 側有兩個以上縱軸，這裡沒算'])
    expect(axes[3].problems).toEqual([
      'width 要寫成數字',
      'mirror 會改刻度的位置或寬度，這裡沒算',
      'tick 的 fontFamily 會改字寬，字寬表沒算到',
      '同一張圖的 left 側有兩個以上縱軸，這裡沒算',
    ])
    expect(axes[4].problems).toEqual([
      'tick 要寫成 { fontSize: 數字, fill } 物件（沒寫字級就跟著內文字級變）',
      '不在 recharts 的圖表元件裡',
    ])
    // 只有一個軸、沒寫 width 與 margin 時用 recharts 的預設值：60 − 6 − 2 + 5
    const lone = scanYAxes('y.tsx', "import { AreaChart, YAxis } from 'recharts'\nconst d = <AreaChart><YAxis tick={{ fontSize: 12 }} /></AreaChart>")
    expect(lone.map(a => [a.room, a.problems])).toEqual([[57, []]])
  })
})
