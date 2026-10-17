import { describe, it, expect } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOCALES, messages } from '../../src/renderer/i18n/messages'

/**
 * Token Budget 面板不用 emoji：emoji 不跟著主題變色，各平台的字型也畫得不一樣。面板的圖示一律用 EventIcon 的 SVG。
 *
 * emoji 進得了面板的路有兩條，都要擋：
 *   1. 元件原始碼裡的字面（含 CSS 的 `content`）
 *   2. 經 `t()` 回來的 catalog 值：掃元件原始碼永遠看不到它（儲存空間的警告符號就是走這條顯示的）
 *
 * 註解不算：repo 習慣在註解裡寫警告符號。
 * 用 `\p{Extended_Pictographic}`：手寫 Unicode 區段會漏鬧鐘（U+23F0 在 Misc Technical），
 * `\p{Emoji_Presentation}` 會漏警告符號（U+26A0 預設是文字樣式），`\p{Emoji}` 會把數字與 `#`、`*` 都算進去。
 *
 * 已知抓不到：字串裡的 `//`（例如網址）會被當成註解開頭，同一行後面的內容不掃；這個目錄沒有網址。
 */

const TOKEN_BUDGET_DIR = fileURLToPath(new URL('../../src/renderer/components/TokenBudget', import.meta.url))

const PICTOGRAPHIC = /\p{Extended_Pictographic}/u

interface Hit {
  line: number
  text: string
}

/** 逐行去掉 `/* … *\/` 與 `//` 註解後找 emoji；CSS 沒有 `//` 註解，關掉免得把 `url(https://…)` 當註解 */
function findPictographs(src: string, lineComments = true): Hit[] {
  const hits: Hit[] = []
  let inBlock = false
  src.split('\n').forEach((raw, i) => {
    let code = ''
    let j = 0
    while (j < raw.length) {
      if (inBlock) {
        const end = raw.indexOf('*/', j)
        if (end === -1) break
        inBlock = false
        j = end + 2
      } else if (raw.startsWith('/*', j)) {
        inBlock = true
        j += 2
      } else if (lineComments && raw.startsWith('//', j)) {
        break
      } else {
        code += raw[j]
        j += 1
      }
    }
    if (PICTOGRAPHIC.test(code)) hits.push({ line: i + 1, text: raw.trim() })
  })
  return hits
}

/** catalog 裡 `tokenBudget.*` 的值；其他區塊（例如儲存空間）不歸這個面板 */
function catalogHits(catalog: Record<string, string>): string[] {
  return Object.entries(catalog)
    .filter(([key, value]) => key.startsWith('tokenBudget.') && PICTOGRAPHIC.test(value))
    .map(([key, value]) => `${key}: ${value}`)
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (/\.(tsx?|css)$/.test(entry.name)) yield full
  }
}

// 面板原本用的四種，用跳脫序列寫：工具或編輯器弄丟 U+FE0F 也不會讓 fixture 悄悄變樣
const PACKAGE = '\u{1F4E6}'
const ALARM_CLOCK = '⏰'
const ARROWS = '\u{1F504}'
const WARNING = '⚠️'

describe('Token Budget 面板不用 emoji', () => {
  it('元件原始碼（註解以外）沒有 emoji', async () => {
    const found: string[] = []
    for await (const file of walk(TOKEN_BUDGET_DIR)) {
      const src = await readFile(file, 'utf-8')
      for (const hit of findPictographs(src, !file.endsWith('.css'))) {
        found.push(`  ${path.relative(TOKEN_BUDGET_DIR, file)}:${hit.line}  ${hit.text}`)
      }
    }
    expect(found, `面板的圖示請用 EventIcon：\n${found.join('\n')}`).toEqual([])
  })

  it('兩份 catalog 的 tokenBudget.* 文案沒有 emoji', () => {
    const found = LOCALES.flatMap(locale => catalogHits(messages[locale]).map(hit => `  ${locale} ${hit}`))
    expect(found, `經 t() 回來的文案也會顯示在面板上：\n${found.join('\n')}`).toEqual([])
  })

  it.each([PACKAGE, ALARM_CLOCK, ARROWS, WARNING, '⚠'])('抓得到程式碼裡的 %s', emoji => {
    expect(findPictographs(`const icon = '${emoji}'`)).toEqual([{ line: 1, text: `const icon = '${emoji}'` }])
  })

  it('註解裡的不算，註解結束後同一行的程式碼照掃', () => {
    const src = [
      `// ${WARNING} 行註解`,
      `/** ${WARNING} doc comment */`,
      `{/* ${PACKAGE} JSX 註解 */}`,
      '/*',
      ` * ${ALARM_CLOCK} 跨行的區塊註解`,
      ' */',
      `const label = 'x' // ${ARROWS}`,
      `/* 註解 */ const icon = '${PACKAGE}'`,
    ].join('\n')
    expect(findPictographs(src)).toEqual([{ line: 8, text: `/* 註解 */ const icon = '${PACKAGE}'` }])
  })

  it('CSS 的 content 抓得到，網址不會讓同一行後面的內容被略過', () => {
    expect(findPictographs(`.x { background: url(https://a.b/c.svg); content: '${WARNING}'; }`, false)).toHaveLength(1)
  })

  it('面板文案在用的符號不算 emoji', () => {
    expect(findPictographs("const s = '412.6K → 85.5K · 開始後 − … ▸ ≥ ≤ —'")).toEqual([])
  })

  it('catalog 只看 tokenBudget.*', () => {
    expect(catalogHits({
      'tokenBudget.events.unknown.title': `${WARNING} 快取中斷`,
      'storage.confirm.warningHighImpact': `${WARNING} 此操作將刪除超過一半的資料`,
      'tokenBudget.events.idle.title': '離開約 2 小時',
    })).toEqual([`tokenBudget.events.unknown.title: ${WARNING} 快取中斷`])
  })
})
