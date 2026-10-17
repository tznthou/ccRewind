import { describe, it, expect } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * renderer 引用的 CSS 自訂屬性都要有人定義。`var(--x, 後備值)` 碰到沒定義的 `--x` 不會報錯，只會一直用後備值：
 * 儲存空間頁的 `--color-danger` 就這樣用了寫死的紅色，換主題也不會跟著變。
 *
 * 「有人定義」＝任一 .css 裡寫了 `--x:`，或程式用字串 `'--x'` 設定（style 物件、setProperty）。
 * 只查有沒有定義，不查每個主題都有；註解裡的 `var(--x)` 也會被當成引用（目前沒有）。
 */

const RENDERER_DIR = fileURLToPath(new URL('../../src/renderer', import.meta.url))

const REFERENCE = /var\(\s*(--[\w-]+)/g
const CSS_DEFINITION = /(?<![\w-])(--[\w-]+)\s*:/g
const SCRIPT_DEFINITION = /['"`](--[\w-]+)['"`]/g

interface Source {
  file: string
  text: string
}

/** 被引用卻沒有任何地方定義的名稱，各附第一個引用的位置 */
function undefinedCustomProperties(sources: Source[]): string[] {
  const defined = new Set<string>()
  const firstReference = new Map<string, string>()
  for (const { file, text } of sources) {
    const definition = file.endsWith('.css') ? CSS_DEFINITION : SCRIPT_DEFINITION
    for (const m of text.matchAll(definition)) defined.add(m[1])
    for (const m of text.matchAll(REFERENCE)) {
      const line = text.slice(0, m.index).split('\n').length
      if (!firstReference.has(m[1])) firstReference.set(m[1], `${file}:${line}`)
    }
  }
  return [...firstReference]
    .filter(([name]) => !defined.has(name))
    .map(([name, where]) => `${name}  ${where}`)
}

async function collect(dir: string): Promise<Source[]> {
  const sources: Source[] = []
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !/\.(css|tsx?|js)$/.test(entry.name)) continue
    const full = path.join(entry.parentPath, entry.name)
    sources.push({ file: path.relative(dir, full), text: await readFile(full, 'utf-8') })
  }
  return sources
}

describe('CSS 自訂屬性', () => {
  it('renderer 引用的每個 var(--x) 都有定義', async () => {
    const sources = await collect(RENDERER_DIR)
    // 路徑錯或沒掃到檔案時，「沒有未定義」會空著通過：先確認主題 token 的來源與引用都掃到了
    expect(sources.map(s => s.file)).toContain(path.join('styles', 'global.css'))
    expect(sources.some(s => s.text.includes('var(--color-error'))).toBe(true)

    const missing = undefinedCustomProperties(sources)
    expect(missing, `沒有定義，畫面會一直用後備值：\n${missing.join('\n')}`).toEqual([])
  })

  it('抓得到帶後備值的未定義引用；CSS 定義與程式設定的都算有定義', () => {
    expect(undefinedCustomProperties([
      { file: 'a.module.css', text: '.a {\n  color: var(--color-danger, #dc2626);\n}' },
      { file: 'theme.css', text: ':root { --color-error: red; }' },
      { file: 'b.module.css', text: '.b { color: var(--color-error); width: var(--fill); }' },
      { file: 'C.tsx', text: "const style = { '--fill': '10%' }" },
    ])).toEqual(['--color-danger  a.module.css:2'])
  })
})
