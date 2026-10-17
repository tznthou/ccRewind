import { describe, it, expect } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/**
 * recharts 預設的 tooltip 把每一項的字畫成該系列的顏色（圓餅那一塊、那條線的顏色）。系列色是寫死的，不跟主題：
 * 淺青與橘色在亮色主題的底上只有 1.3–2:1，深藍在 terminal 只有 1.8:1。
 * 所以每個 recharts 的 <Tooltip> 都要自己畫內容（content），或用 itemStyle 把字換成主題的文字色。
 *
 * 字不再是系列色之後，tooltip 就不能拿來對照「哪個顏色是哪個系列」：有兩個以上系列的圖（或圓餅的多個類別）
 * 要有圖例。使用量趨勢的藍、橘兩塊原本只靠 tooltip 的字色對照，沒有圖例。
 *
 * 用 TypeScript 的 parser 找元素、不用正則：Tooltip 的 props 常常跨行，content 裡還會再包一個 JSX 元素。
 *
 * 已知抓不到：只認具名匯入的元件（`import * as R` 再寫 `<R.Tooltip>`、或自己包一層再匯出的都看不到）；
 * 只看有沒有 itemStyle，不看裡面有沒有設 color；有 content 就當它自己用主題色畫（ContextGrowthChart 是這樣）。
 * 系列與圖例以檔案為單位計算，一個檔案一張圖；系列數的是 JSX 標籤，`keys.map(k => <Line />)` 只算一個。
 */

const RENDERER_DIR = fileURLToPath(new URL('../../src/renderer', import.meta.url))
const SERIES = ['Area', 'Line', 'Bar']

interface Scan {
  /** 找到的 recharts Tooltip（file:line） */
  found: string[]
  /** 其中沒有 content 也沒有 itemStyle 的 */
  defaultColoured: string[]
  /** 有 Tooltip 用 itemStyle 把字換成主題色 */
  itemStyled: boolean
  /** Area／Line／Bar 的個數 */
  series: number
  pie: boolean
  legend: boolean
}

function scanChart(file: string, source: string): Scan {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  // 從 recharts 匯入的元件在這個檔案裡叫什麼（可能用 as 改名）：本地名稱 → recharts 的名稱
  const recharts = new Map<string, string>()
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier) || stmt.moduleSpecifier.text !== 'recharts') continue
    const bindings = stmt.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const el of bindings.elements) recharts.set(el.name.text, (el.propertyName ?? el.name).text)
  }

  const scan: Scan = { found: [], defaultColoured: [], itemStyled: false, series: 0, pie: false, legend: false }
  const visit = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const kind = recharts.get(node.tagName.getText(sf))
      if (kind === 'Tooltip') {
        const where = `${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`
        const props = node.attributes.properties.flatMap(p => (ts.isJsxAttribute(p) ? [p.name.getText(sf)] : []))
        scan.found.push(where)
        if (props.includes('itemStyle')) scan.itemStyled = true
        if (!props.includes('content') && !props.includes('itemStyle')) scan.defaultColoured.push(where)
      }
      if (kind && SERIES.includes(kind)) scan.series++
      if (kind === 'Pie') scan.pie = true
      if (kind === 'Legend') scan.legend = true
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return scan
}

async function scanRenderer(): Promise<Map<string, Scan>> {
  const scans = new Map<string, Scan>()
  for (const entry of await readdir(RENDERER_DIR, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.tsx')) continue
    const full = path.join(entry.parentPath, entry.name)
    const file = path.relative(RENDERER_DIR, full)
    scans.set(file, scanChart(file, await readFile(full, 'utf-8')))
  }
  return scans
}

/** tooltip 字是主題色、圖上又有兩個以上系列或圓餅、卻沒有圖例：顏色對不回系列 */
function missingColourKey(scan: Scan): boolean {
  return scan.itemStyled && (scan.series >= 2 || scan.pie) && !scan.legend
}

describe('recharts 的 tooltip 不用系列色畫字', () => {
  it('每個 Tooltip 都有 content 或 itemStyle', async () => {
    const scans = [...(await scanRenderer()).values()]
    const found = scans.flatMap(s => s.found)
    // 走訪或 import 判斷壞掉時會「一個都沒找到」而空著通過：先確認回報問題的那個圓餅有被找到
    expect(found.some(f => f.startsWith(path.join('components', 'TokenBudget', 'TokenBreakdown.tsx')))).toBe(true)
    const defaultColoured = scans.flatMap(s => s.defaultColoured)
    expect(defaultColoured, `tooltip 的字會是系列色：\n${defaultColoured.join('\n')}`).toEqual([])
  })

  it('字改成主題色的圖，有兩個以上系列或是圓餅時要有圖例', async () => {
    const scans = await scanRenderer()
    const missing = [...scans].filter(([, s]) => missingColourKey(s)).map(([file]) => file)
    expect(missing, `看不出哪個顏色是哪個系列：\n${missing.join('\n')}`).toEqual([])
  })

  it('抓得到只設 contentStyle 的，也認得改名的 import；有 content、itemStyle 或不是 recharts 的不算', () => {
    const src = [
      "import { Tooltip, Tooltip as Tip } from 'recharts'",
      "import Hint from './Hint'",
      'const a = <Tooltip contentStyle={s} />',
      'const b = <Tooltip contentStyle={s} itemStyle={i} />',
      'const c = <Tooltip content={p => <Box {...p} />} />',
      'const d = <Tip',
      '  formatter={f}',
      '/>',
      'const e = <Hint />',
    ].join('\n')
    const scan = scanChart('x.tsx', src)
    expect(scan.found).toEqual(['x.tsx:3', 'x.tsx:4', 'x.tsx:5', 'x.tsx:6'])
    expect(scan.defaultColoured).toEqual(['x.tsx:3', 'x.tsx:6'])
  })

  it('圖例規則：兩個系列或圓餅要有圖例，單一系列或字仍是系列色的不要求', () => {
    const chart = (body: string) => scanChart('x.tsx', `import { Area, Pie, Tooltip, Legend } from 'recharts'\n${body}`)
    expect(missingColourKey(chart('<><Area /><Area /><Tooltip itemStyle={i} /></>'))).toBe(true)
    expect(missingColourKey(chart('<><Area /><Area /><Tooltip itemStyle={i} /><Legend /></>'))).toBe(false)
    expect(missingColourKey(chart('<><Pie /><Tooltip itemStyle={i} /></>'))).toBe(true)
    expect(missingColourKey(chart('<><Area /><Tooltip itemStyle={i} /></>'))).toBe(false)
    expect(missingColourKey(chart('<><Area /><Area /><Tooltip /></>'))).toBe(false)
  })
})
