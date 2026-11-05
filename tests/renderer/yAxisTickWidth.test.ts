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
 * 字距調整也量了：兩種字型的 13 × 13 個字對，刻度裡會出現的字對沒有一個是正的（Plus Jakarta Sans 縮最多的是 "74"，
 * −1.09px；IBM Plex Sans 唯一正的是 "K." +0.12px，刻度裡 K 後面不會再有字），所以逐字加總是上界；
 * 每個字型的最大值記在 TICK_PAIR_KERN_MAX_12PX，正的會加進上界。換字型或加主題時「每個主題的內文字型都在字寬表裡」
 * 會紅：用同樣的方法量新字型，補進字寬、字對、整串三張表（系統字型在每個平台不一樣，每個平台都量、取最寬的）。
 * 同名字型換了檔案也要重量：字型檔的 SHA-256 由 fontLicenses.test.ts 守著，那邊紅的時候順便重量這裡。
 *
 * 已知抓不到：svg 外層的元素設了字型相關的屬性（font-family、font-weight、letter-spacing…都會繼承到刻度字）；
 * tickFormatter 只比名稱，同名但印法不同的函式也會過；只認具名匯入的 YAxis 與圖表元件（同 chartTooltips.test.ts）。
 * <YAxis> 只能用 AXIS_PROPS_OK 裡的屬性，width、刻度字級、tickSize／tickMargin、圖表 margin 要寫成數字，
 * 其他寫法看不出能放多寬，直接列成問題。
 */

const RENDERER_DIR = fileURLToPath(new URL('../../src/renderer', import.meta.url))

// recharts 的預設值與刻度產生器從套件讀，升版改了這裡跟著算（3.10.1 的值釘在「從 recharts 讀到的預設值」那條）
const requireCjs = createRequire(import.meta.url)
const AXIS_DEFAULTS = (requireCjs('recharts/lib/cartesian/CartesianAxis') as {
  defaultCartesianAxisProps: { tickSize: number; tickMargin: number }
}).defaultCartesianAxisProps
const YAXIS_DEFAULTS = (requireCjs('recharts/lib/cartesian/YAxis') as {
  yAxisDefaultProps: { width: number; tickCount: number; allowDecimals: boolean }
}).yAxisDefaultProps
const CHART_DEFAULT_MARGIN = (requireCjs('recharts/lib/chart/CartesianChart') as {
  defaultCartesianChartProps: { margin: { left: number; right: number } }
}).defaultCartesianChartProps.margin
// 數字軸的 domain 有 'auto'（YAxis 預設 [0, 'auto']）時，刻度由它產生（recharts 的 state/selectors/axisSelectors.js）
const { getNiceTickValues } = requireCjs('recharts/lib/util/scale/getNiceTickValues') as {
  getNiceTickValues: (domain: [number, number], tickCount: number, allowDecimals: boolean, mode: string) => unknown[]
}
/** 資料從 0 到 max 時 recharts 畫的刻度 */
const ticks = (max: number): number[] =>
  getNiceTickValues([0, max], YAXIS_DEFAULTS.tickCount, YAXIS_DEFAULTS.allowDecimals, 'adaptive').map(Number)
const top = (max: number): number => Math.max(...ticks(max))

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

/**
 * 刻度裡會出現的字對（數字後面接數字、小數點、K、M；小數點後面接數字）字距最大的值（px，12px），同一天在 app 裡量。
 * 量不到正的記 0；正的會加到每個字對上，逐字加總才仍是上界
 */
const TICK_PAIR_KERN_MAX_12PX: Record<string, number> = { 'Plus Jakarta Sans': 0, 'IBM Plex Sans': 0 }

/**
 * 同一次量的整串寬度：逐字加總不能比它窄（上界），寬太多就是表抄錯了。
 * 寬多少看字距調整：含 "74" 的 "740.0K" 寬 1.10px，其他幾串不到 0.27px
 */
const MEASURED_WHOLE_12PX: Record<string, Record<string, number>> = {
  'Plus Jakarta Sans': { '500.0K': 45.031, '240.0K': 43.492, '740.0K': 41.852, '750.0K': 42.523, '1400.0M': 51.828 },
  'IBM Plex Sans': { '500.0K': 39.68, '1400.0M': 49.016 },
}

/**
 * 每個縱軸最長的刻度（key：src/renderer 底下的路徑#yAxisId，沒給 yAxisId 是 recharts 預設的 0）。
 * format 是那個軸的 tickFormatter（沒寫是 null，刻度就是數字本身），values 用它印成刻度字，寫兩個以上就取最寬的。
 * 刻度是 recharts 挑的整齊數字（250K、350M 這類），不會是 999,999 這種被 formatTokens 進位成 "1000.0K" 的值，
 * 所以 K 最多三位整數。maxData 是資料上限：recharts 會把最上面一格往上取整（資料 80 億畫成 8000.0M，多 1 就是
 * 10000.0M），所以「資料上限畫出來的最上面一格」那條用 recharts 的刻度產生器檢查上限的最上面一格在宣告以內；
 * tight 的上限正好卡在刻度多一位的邊界，多 1 就要超出宣告（上限寫得比宣告保守，那條會紅）。沒有 tight 的軸，
 * maxData 只說明資料從哪來，宣告的最長刻度比它寬鬆（對話長度宣告到 "9.9M"），上限改大也不會紅。
 */
const LONGEST_TICKS: Record<string, { format: ((n: number) => string) | null; values: number[]; maxData: number; tight?: boolean }> = {
  // 對話長度：一次呼叫的 context 最多 1M，最上面一格是 "1.0M"
  'components/TokenBudget/ContextGrowthChart.tsx#0': { format: formatTokens, values: [999_900, 9_900_000], maxData: 1_000_000 },
  // 每天的 session 數：最多 800 場，刻度到 "999"（801 場最上面一格就是 1000）；
  // session 少的時候 recharts 會挑 0.25、0.75、2.25 這種小數刻度
  'components/Dashboard/UsageTrendChart.tsx#sessions': { format: null, values: [999, 2.25], maxData: 800, tight: true },
  // 每天的 token 數：最多 80 億，刻度到 "9999.9M"（再多 1，最上面一格就是 8 個字的 "10000.0M"）
  'components/Dashboard/UsageTrendChart.tsx#tokens': {
    format: formatTokens, values: [999_900, 9_999_900_000], maxData: 8_000_000_000, tight: true,
  },
  // 每則訊息平均的 token：一次呼叫的 context 最多 1M
  'components/Dashboard/EfficiencyTrendChart.tsx#0': { format: formatTokens, values: [999_900, 9_900_000], maxData: 1_000_000 },
}

/** 宣告的最長刻度印出來的字 */
const longestSamples = (key: string): string[] => LONGEST_TICKS[key].values.map(v => (LONGEST_TICKS[key].format ?? String)(v))

const CHART_KINDS = ['AreaChart', 'BarChart', 'ComposedChart', 'LineChart', 'ScatterChart']
/**
 * <YAxis> 上算得到的屬性。其他屬性 recharts 會套到每個刻度字上（字型、字距、dx、textAnchor、style、className…），
 * 或改掉刻度的字（unit、ticks、domain、allowDecimals…），這裡都算不到
 */
const AXIS_PROPS_OK = ['yAxisId', 'orientation', 'width', 'tick', 'tickFormatter', 'tickLine', 'axisLine', 'tickSize', 'tickMargin', 'hide']
/** tick 物件裡不影響字寬的屬性；其他（fontFamily、fontWeight、letterSpacing…）會讓字寬表不準 */
const TICK_KEYS_OK = ['fontSize', 'fill']

interface YAxisFacts {
  where: string
  key: string
  /** 能放多寬（px）；看不出來是 null，原因在 problems */
  room: number | null
  fontSize: number | null
  /** tickFormatter 的原始碼（沒寫是 null） */
  formatter: string | null
  problems: string[]
}

/** 每一位數字都換成最寬的數字，再加上每個字對最大的正字距，算這個刻度最寬會到多少（12px） */
function widestWidth(sample: string, glyphs: Record<string, number>, pairKernMax: number): number {
  const widestDigit = Math.max(...[...'0123456789'].map(d => glyphs[d]))
  const chars = [...sample]
  let sum = 0
  for (const c of chars) {
    const w = /\d/.test(c) ? widestDigit : glyphs[c]
    if (w === undefined) throw new Error(`字寬表沒有「${c}」`)
    sum += w
  }
  return sum + Math.max(0, pairKernMax) * Math.max(0, chars.length - 1)
}

/** 這個字型下，宣告的最長刻度最寬會到多少 */
const declaredWidest = (key: string, font: string): number =>
  Math.max(...longestSamples(key).map(s => widestWidth(s, GLYPH_WIDTH_12PX[font], TICK_PAIR_KERN_MAX_12PX[font])))

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

  const axes: (YAxisFacts & { chart: ts.Node | undefined; side: string | null; drawsTicks: boolean })[] = []
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && kind(node) === 'YAxis') {
      const problems: string[] = []
      const { attrs, spread } = attributes(node, sf)
      const isTrue = (name: string) =>
        attrs.has(name) && (attrs.get(name) === null || attrs.get(name)?.kind === ts.SyntaxKind.TrueKeyword)
      // hide、tick={false} 的軸不畫刻度字，不用算；有 {...展開} 時這兩個可能被它蓋掉，當作會畫，問題照列
      const drawsTicks = spread || (!isTrue('hide') && attrs.get('tick')?.kind !== ts.SyntaxKind.FalseKeyword)
      if (spread) problems.push('有 {...} 展開的屬性，看不出寫了什麼')
      for (const name of attrs.keys()) {
        if (!AXIS_PROPS_OK.includes(name)) problems.push(`<YAxis> 的 ${name} 會套到刻度字上或改變刻度，這裡沒算`)
      }
      const id = attrs.has('yAxisId') ? text(attrs.get('yAxisId')) : '0'
      if (id === null) problems.push('yAxisId 要寫成字串或數字')
      const side = attrs.has('orientation') ? text(attrs.get('orientation')) : 'left'
      if (side !== 'left' && side !== 'right') problems.push('orientation 要寫成 "left" 或 "right"')
      const width = attrs.has('width') ? num(attrs.get('width')) : YAXIS_DEFAULTS.width
      if (width === null) problems.push('width 要寫成數字')
      const tickSize = attrs.has('tickSize') ? num(attrs.get('tickSize')) : AXIS_DEFAULTS.tickSize
      const tickMargin = attrs.has('tickMargin') ? num(attrs.get('tickMargin')) : AXIS_DEFAULTS.tickMargin
      if (tickSize === null || tickMargin === null) problems.push('tickSize／tickMargin 要寫成數字')
      const formatter = attrs.has('tickFormatter') ? (attrs.get('tickFormatter')?.getText(sf) ?? '') : null
      let fontSize: number | null = null
      if (drawsTicks) {
        const tick = objectLiteral(attrs.get('tick'))
        if (!tick) problems.push('tick 要寫成 { fontSize: 數字, fill } 物件（沒寫字級就跟著內文字級變）')
        else {
          fontSize = num(tick.get('fontSize'))
          if (fontSize === null) problems.push('tick.fontSize 要寫成數字')
          for (const k of tick.keys()) if (!TICK_KEYS_OK.includes(k)) problems.push(`tick 的 ${k} 會改字寬，字寬表沒算到`)
        }
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
        formatter,
        problems,
        chart,
        side,
        drawsTicks,
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  // 同一張圖同一側有兩個以上縱軸時，位置要看 recharts 怎麼排，上面的算法不成立。不畫字的軸也算：
  // tick={false} 的軸照樣佔寬；hide 的軸雖然不算進圖表內框（selectChartOffsetInternal），排各軸位置時照樣算它的寬
  // （axisSelectors 的 selectAllYAxesOffsetSteps），依 yAxisId 排在它後面的軸會被推出去（recharts 照 id 排，跟 JSX 的順序無關）
  for (const a of axes) {
    if (a.chart && axes.some(b => b !== a && b.chart === a.chart && b.side === a.side)) {
      a.problems.push(`同一張圖的 ${a.side} 側有兩個以上縱軸，這裡沒算`)
      a.room = null
    }
  }
  return axes
    .filter(a => a.drawsTicks)
    .map(a => ({ where: a.where, key: a.key, room: a.room, fontSize: a.fontSize, formatter: a.formatter, problems: a.problems }))
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

/** 會改字寬的屬性。font-kerning、text-rendering 只會關掉字距調整，整串變回逐字加總，不會超過上界 */
const FONT_PROP =
  /(?<![-\w])(font|font-family|font-size|font-size-adjust|font-weight|font-style|font-stretch|font-width|font-variant(?:-[\w-]+)?|font-feature-settings|font-variation-settings|letter-spacing|word-spacing)\s*:/
/** 會選到刻度字的選擇器：recharts 的 class，或 svg 裡的元素（svg、g、text、tspan）與通用選擇器 * */
const TICK_SELECTOR = /recharts|cartesian-axis|(?:^|[\s>+~,(])(?:svg|g|text|tspan|\*)(?=$|[\s.#:[>+~,)])/
/**
 * 縱軸刻度字和它在 svg 裡各層祖先的 class（2026-11-05 在 app 裡讀的 DOM，recharts 3.10.1）：
 * 刻度字在 svg.recharts-surface 底下的 z-index 圖層裡，不在 .recharts-yAxis 底下
 */
const TICK_CLASS_CHAIN = [
  'recharts-text recharts-cartesian-axis-tick-value',
  'recharts-layer recharts-cartesian-axis-tick-label',
  'recharts-cartesian-axis-tick-labels recharts-yAxis-tick-labels',
  'recharts-zIndex-layer_2000',
  'recharts-surface',
]

/**
 * class 屬性選擇器會不會選到刻度字或它的祖先：值是任何一層 class 的一段就算（不分大小寫，^= $= ~= |= 都當 *= 看，
 * 寧可多抓）；只寫 [class] 也算
 */
function classAttributeHitsTick(selector: string): boolean {
  if (/\[\s*class\s*\]/i.test(selector)) return true
  return [...selector.matchAll(/\[\s*class\s*[~|^$*]?=\s*(["']?)([^"'\]]*?)\1(?:\s+[is])?\s*\]/gi)]
    .some(m => TICK_CLASS_CHAIN.some(cls => cls.toLowerCase().includes(m[2].trim().toLowerCase())))
}

/** 選到刻度字、又改了字寬的規則 */
function fontOverrides(file: string, css: string): string[] {
  const out: string[] = []
  for (const m of stripCssComments(css).matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    if ((TICK_SELECTOR.test(m[1]) || classAttributeHitsTick(m[1])) && FONT_PROP.test(m[2])) out.push(`${file}: ${m[1].trim()}`)
  }
  return out
}

describe('縱軸的刻度字放得下', () => {
  it('字寬表跟同一次量的整串寬度對得上：逐字加總（加上正的字距）不比整串窄，最多寬一個字距調整；每個字型都有字對的值', () => {
    expect(Object.keys(MEASURED_WHOLE_12PX).sort()).toEqual(Object.keys(GLYPH_WIDTH_12PX).sort())
    expect(Object.keys(TICK_PAIR_KERN_MAX_12PX).sort()).toEqual(Object.keys(GLYPH_WIDTH_12PX).sort())
    for (const [font, strings] of Object.entries(MEASURED_WHOLE_12PX)) {
      for (const [s, whole] of Object.entries(strings)) {
        const sum = [...s].reduce((acc, c) => acc + GLYPH_WIDTH_12PX[font][c], 0)
        const pairs = Math.max(0, TICK_PAIR_KERN_MAX_12PX[font]) * ([...s].length - 1)
        expect(sum + pairs - whole, `${font} "${s}"`).toBeGreaterThanOrEqual(0)
        // 含 "74" 的整串窄 1.10px；其他不到 0.27px，0.3 才抓得到抄錯的字寬
        expect(sum - whole, `${font} "${s}"`).toBeLessThan(s.includes('74') ? 1.2 : 0.3)
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

  it('沒有樣式另外改刻度字的字型、字級或字距（字寬表量的是內文字型）', async () => {
    const offenders = (await readCss()).flatMap(({ file, css }) => fontOverrides(file, css))
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
    // 宣告的最長刻度要用軸實際印字的方式印
    expect(axis.formatter, `${axis.where} 的 tickFormatter`).toBe(LONGEST_TICKS[key].format?.name ?? null)
    const short: string[] = []
    for (const font of Object.keys(GLYPH_WIDTH_12PX)) {
      const need = (declaredWidest(key, font) * (axis.fontSize ?? NaN)) / 12
      if (!(need <= (axis.room ?? NaN))) short.push(`${font} 最寬要 ${need.toFixed(2)}px，軸只放得下 ${axis.room}px`)
    }
    expect(short, axis.where).toEqual([])
  })

  it.each(Object.keys(LONGEST_TICKS))('%s：資料上限畫出來的最上面一格不比宣告的最長刻度寬；tight 的上限多 1 就要超出', key => {
    const { format, maxData, tight } = LONGEST_TICKS[key]
    const print = format ?? String
    for (const font of Object.keys(GLYPH_WIDTH_12PX)) {
      const width = (max: number) => widestWidth(print(top(max)), GLYPH_WIDTH_12PX[font], TICK_PAIR_KERN_MAX_12PX[font])
      expect(width(maxData), `${font}：資料 ${maxData} 的最上面一格 ${print(top(maxData))}`).toBeLessThanOrEqual(declaredWidest(key, font))
      if (tight) {
        expect(width(maxData + 1), `${font}：資料 ${maxData + 1} 的最上面一格 ${print(top(maxData + 1))}`)
          .toBeGreaterThan(declaredWidest(key, font))
      }
    }
  })

  it('刻度產生器的呼叫方式跟 app 一樣：2026-11-05 在 app 裡量的使用量趨勢，畫的就是這五個刻度', () => {
    expect(ticks(1.4e9).map(formatTokens)).toEqual(['0', '350.0M', '700.0M', '1050.0M', '1400.0M'])
    // 對話長度到 context 上限 1M，最上面一格是 "1.0M"（LONGEST_TICKS 的說明）
    expect(formatTokens(top(1_000_000))).toBe('1.0M')
  })

  it('從 recharts 讀到的預設值（3.10.1；升版改了這裡會紅，核對新值後改這裡，上面的算法已經跟著用新值）', () => {
    expect({
      ...AXIS_DEFAULTS,
      width: YAXIS_DEFAULTS.width,
      tickCount: YAXIS_DEFAULTS.tickCount,
      allowDecimals: YAXIS_DEFAULTS.allowDecimals,
      left: CHART_DEFAULT_MARGIN.left,
      right: CHART_DEFAULT_MARGIN.right,
    }).toMatchObject({ tickSize: 6, tickMargin: 2, width: 60, tickCount: 5, allowDecimals: true, left: 5, right: 5 })
  })

  it('最寬的刻度：每一位換成最寬的數字，其他字照表，正的字距加在每個字對上', () => {
    const glyphs = GLYPH_WIDTH_12PX['Plus Jakarta Sans']
    expect(widestWidth('240.0K', glyphs, 0)).toBeCloseTo(8.789 * 4 + 3.438 + 7.852, 6)
    expect(widestWidth('12', glyphs, 0)).toBeCloseTo(8.789 * 2, 6)
    expect(widestWidth('12', glyphs, 0.5)).toBeCloseTo(8.789 * 2 + 0.5, 6)
    expect(widestWidth('240.0K', glyphs, 0.5)).toBeCloseTo(8.789 * 4 + 3.438 + 7.852 + 0.5 * 5, 6)
    expect(widestWidth('12', glyphs, -1)).toBeCloseTo(8.789 * 2, 6)
    expect(() => widestWidth('1.0B', glyphs, 0)).toThrow('字寬表沒有「B」')
  })

  it('CSS 檢查：選到刻度字的規則改了字寬就算，其他不算', () => {
    const css = [
      '.recharts-text { font-family: serif }',
      '.chart svg { font-weight: 700 }',
      '.chart g { letter-spacing: 2px }',
      '.chart text { letter-spacing: 1px }',
      '.chart tspan { font-weight: 700 }',
      '.chart * { font-size: 14px }',
      '[class*="axis-tick"] { font-size: 14px }',
      '[class *= "yAxis"] { letter-spacing: 1px }',
      '[class*="yaxis" i] { font-weight: 700 }',
      '[class$=value] { font-size: 14px }',
      '[class] { font-weight: 700 }',
      '[class*="cartesian-axis-tick"] { font-size: 14px }',
      ':global(.recharts-cartesian-axis-tick-value) { font-variation-settings: "wght" 700 }',
      '@media (min-width: 1px) { .x text { font-size-adjust: 0.5 } }',
      '.recharts-surface { overflow: visible }',
      '.textMuted { font-weight: 700 }',
      '.bg { font-weight: 700 }',
      '[class*=sessionItem] { font-weight: 700 }',
      '.icon svg { width: 16px }',
      '*, *::before { box-sizing: border-box }',
      '/* .recharts-text { font-family: serif } */',
    ].join('\n')
    expect(fontOverrides('x.css', css)).toEqual([
      'x.css: .recharts-text',
      'x.css: .chart svg',
      'x.css: .chart g',
      'x.css: .chart text',
      'x.css: .chart tspan',
      'x.css: .chart *',
      'x.css: [class*="axis-tick"]',
      'x.css: [class *= "yAxis"]',
      'x.css: [class*="yaxis" i]',
      'x.css: [class$=value]',
      'x.css: [class]',
      'x.css: [class*="cartesian-axis-tick"]',
      'x.css: :global(.recharts-cartesian-axis-tick-value)',
      'x.css: .x text',
    ])
    // 檔案第一條規則從第一個字就是元素選擇器
    expect(fontOverrides('y.css', 'text { font-size: 14px }')).toEqual(['y.css: text'])
  })

  it('掃描器：讀得到寬度、字級、formatter、預設值與那一側的 margin；不畫刻度字的軸不列出但照樣佔位；看不出來的寫法列成問題', () => {
    const src = [
      "import { AreaChart, LineChart, YAxis, YAxis as Axis } from 'recharts'",
      'const a = (',
      '  <AreaChart margin={{ top: 4, right: 8, left: 3, bottom: 0 }}>',
      '    <YAxis tick={{ fontSize: 12, fill: c }} width={50} tickFormatter={formatTokens} />',
      '    <Axis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} width={40} tickMargin={4} />',
      '  </AreaChart>',
      ')',
      'const b = (',
      '  <LineChart>',
      '    <YAxis yAxisId={1} tick={{ fontSize: 12 }} />',
      '    <YAxis yAxisId={2} tick={{ fontSize: 12, fontFamily: f }} width="auto" mirror unit="/msg" />',
      '    <YAxis yAxisId="n" orientation="right" tick={false} />',
      '  </LineChart>',
      ')',
      'const c = <YAxis tick={t} width={40} letterSpacing={1} />',
      'const d = (',
      '  <AreaChart>',
      '    <YAxis yAxisId="s" hide {...p} />',
      '    <YAxis yAxisId="t" orientation="right" tick={false} {...p} />',
      '  </AreaChart>',
      ')',
      'const e = (',
      '  <AreaChart>',
      '    <YAxis yAxisId="v" tick={{ fontSize: 12 }} />',
      '    <YAxis yAxisId="aux" hide />',
      '  </AreaChart>',
      ')',
    ].join('\n')
    const axes = scanYAxes('x.tsx', src)
    expect(axes.map(a => [a.where, a.key, a.room, a.fontSize, a.formatter])).toEqual([
      // 50 − 6 − 2 + 左邊 margin 3
      ['x.tsx:4', 'x.tsx#0', 45, 12, 'formatTokens'],
      // 40 − 6 − 4 + 右邊 margin 8
      ['x.tsx:5', 'x.tsx#r', 38, 11, null],
      // 左側有兩個軸；右側 tick={false} 的 n 軸不畫刻度字，不列出
      ['x.tsx:10', 'x.tsx#1', null, 12, null],
      ['x.tsx:11', 'x.tsx#2', null, 12, null],
      ['x.tsx:15', 'x.tsx#0', null, null, null],
      // 展開的屬性可能蓋掉 hide、tick={false}：照樣列出來
      ['x.tsx:18', 'x.tsx#s', null, null, null],
      ['x.tsx:19', 'x.tsx#t', null, null, null],
      // hide 的 aux 軸不列出，但 recharts 排位置時照樣算它，v 軸可能被它推出去
      ['x.tsx:24', 'x.tsx#v', null, 12, null],
    ])
    expect(axes[0].problems).toEqual([])
    expect(axes[1].problems).toEqual([])
    expect(axes[2].problems).toEqual(['同一張圖的 left 側有兩個以上縱軸，這裡沒算'])
    expect(axes[3].problems).toEqual([
      '<YAxis> 的 mirror 會套到刻度字上或改變刻度，這裡沒算',
      '<YAxis> 的 unit 會套到刻度字上或改變刻度，這裡沒算',
      'width 要寫成數字',
      'tick 的 fontFamily 會改字寬，字寬表沒算到',
      '同一張圖的 left 側有兩個以上縱軸，這裡沒算',
    ])
    expect(axes[4].problems).toEqual([
      '<YAxis> 的 letterSpacing 會套到刻度字上或改變刻度，這裡沒算',
      'tick 要寫成 { fontSize: 數字, fill } 物件（沒寫字級就跟著內文字級變）',
      '不在 recharts 的圖表元件裡',
    ])
    for (const a of [axes[5], axes[6]]) {
      expect(a.problems).toEqual([
        '有 {...} 展開的屬性，看不出寫了什麼',
        'tick 要寫成 { fontSize: 數字, fill } 物件（沒寫字級就跟著內文字級變）',
      ])
    }
    expect(axes[7].problems).toEqual(['同一張圖的 left 側有兩個以上縱軸，這裡沒算'])
    // 只有一個軸、沒寫 width 與 margin 時用 recharts 的預設值：60 − 6 − 2 + 5
    const lone = scanYAxes('y.tsx', "import { AreaChart, YAxis } from 'recharts'\nconst d = <AreaChart><YAxis tick={{ fontSize: 12 }} /></AreaChart>")
    expect(lone.map(a => [a.room, a.problems])).toEqual([[57, []]])
  })
})
