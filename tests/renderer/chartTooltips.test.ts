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
 * 用 TypeScript 的 parser 找元素、不用正則：Tooltip 的 props 常常跨行，content 裡還會再包一個 JSX 元素。
 */

const RENDERER_DIR = fileURLToPath(new URL('../../src/renderer', import.meta.url))

interface Scan {
  /** 找到的 recharts Tooltip（file:line） */
  found: string[]
  /** 其中沒有 content 也沒有 itemStyle 的 */
  defaultColoured: string[]
}

function scanTooltips(file: string, source: string): Scan {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  // 從 recharts 匯入的 Tooltip 在這個檔案裡叫什麼（可能用 as 改名）
  const localNames = new Set<string>()
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier) || stmt.moduleSpecifier.text !== 'recharts') continue
    const bindings = stmt.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const el of bindings.elements) {
      if ((el.propertyName ?? el.name).text === 'Tooltip') localNames.add(el.name.text)
    }
  }

  const scan: Scan = { found: [], defaultColoured: [] }
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && localNames.has(node.tagName.getText(sf))) {
      const where = `${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`
      const props = node.attributes.properties.flatMap(p => (ts.isJsxAttribute(p) ? [p.name.getText(sf)] : []))
      scan.found.push(where)
      if (!props.includes('content') && !props.includes('itemStyle')) scan.defaultColoured.push(where)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return scan
}

describe('recharts 的 tooltip 不用系列色畫字', () => {
  it('每個 Tooltip 都有 content 或 itemStyle', async () => {
    const found: string[] = []
    const defaultColoured: string[] = []
    for (const entry of await readdir(RENDERER_DIR, { withFileTypes: true, recursive: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.tsx')) continue
      const full = path.join(entry.parentPath, entry.name)
      const scan = scanTooltips(path.relative(RENDERER_DIR, full), await readFile(full, 'utf-8'))
      found.push(...scan.found)
      defaultColoured.push(...scan.defaultColoured)
    }
    // 走訪或 import 判斷壞掉時會「一個都沒找到」而空著通過：先確認回報問題的那個圓餅有被找到
    expect(found.some(f => f.startsWith(path.join('components', 'TokenBudget', 'TokenBreakdown.tsx')))).toBe(true)
    expect(defaultColoured, `tooltip 的字會是系列色：\n${defaultColoured.join('\n')}`).toEqual([])
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
    expect(scanTooltips('x.tsx', src)).toEqual({
      found: ['x.tsx:3', 'x.tsx:4', 'x.tsx:5', 'x.tsx:6'],
      defaultColoured: ['x.tsx:3', 'x.tsx:6'],
    })
  })
})
