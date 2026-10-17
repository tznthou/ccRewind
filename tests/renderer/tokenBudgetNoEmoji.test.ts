import { describe, it, expect } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOCALES, messages } from '../../src/renderer/i18n/messages'

/**
 * Token Budget 面板不用 emoji：emoji 不跟著主題變色，各平台的字型也畫得不一樣。面板的圖示一律用 EventIcon 的 SVG。
 *
 * emoji 進得了面板的路有兩條，都要擋：
 *   1. 元件原始碼裡的字（含 CSS 的 `content`，以及寫成 JS／CSS 跳脫序列或 HTML 字元參照的）
 *   2. 經 `t()` 回來的 catalog 值：掃元件原始碼永遠看不到它（儲存空間的警告符號就是走這條顯示的）
 *
 * 註解不算：repo 習慣在註解裡寫警告符號。
 * 用 `\p{Extended_Pictographic}`：手寫 Unicode 區段會漏鬧鐘（U+23F0 在 Misc Technical），
 * `\p{Emoji_Presentation}` 會漏警告符號（U+26A0 預設是文字樣式），`\p{Emoji}` 會把數字與 `#`、`*` 都算進去。
 *
 * 它擋的是「順手寫進一個 emoji」這種最常見的漏法，不是形式驗證：逐行掃、不認得字串，所以
 *   - 已知抓不到：字串裡的 `//`（例如網址）會被當成註解開頭，同一行後面不掃；字串或正則裡的 `/*` 會被當成區塊註解
 *     開頭，一直到下一個 `*\/` 之前的行都不掃。這個目錄兩種都沒有
 *   - 已知誤報：被跳脫的反斜線（兩個反斜線再接 u 與十六進位）也會被解開、當成 emoji；這個目錄也沒有
 */

const TOKEN_BUDGET_DIR = fileURLToPath(new URL('../../src/renderer/components/TokenBudget', import.meta.url))

const PICTOGRAPHIC = /\p{Extended_Pictographic}/u

interface Hit {
  line: number
  text: string
}

/**
 * 原始碼裡用跳脫序列寫的字，畫出來一樣是 emoji，所以先解開再比：JS 的大括號與四位數兩種（代理對逐一解開後會接回同一個字）、
 * JSX 的 HTML 字元參照（十六進位與十進位）；CSS 是反斜線接 1–6 位十六進位（後面可以跟一個空白）
 */
function decodeEscapes(code: string, css: boolean): string {
  const char = (cp: number) => (cp > 0x10ffff ? '' : String.fromCodePoint(cp))
  const hex = (h: string) => char(parseInt(h, 16))
  if (css) return code.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, h: string) => hex(h))
  return code
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, h: string) => hex(h))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, h: string) => hex(h))
    .replace(/&#([0-9]+);/g, (_, d: string) => char(Number(d)))
}

/** 逐行去掉 `/* … *\/` 與 `//` 註解、解開跳脫序列後找 emoji。CSS 沒有 `//` 註解（不關掉會把 `url(https://…)` 當成註解），跳脫的寫法也跟 JS 不同 */
function findPictographs(src: string, css = false): Hit[] {
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
      } else if (!css && raw.startsWith('//', j)) {
        break
      } else {
        code += raw[j]
        j += 1
      }
    }
    if (PICTOGRAPHIC.test(decodeEscapes(code, css))) hits.push({ line: i + 1, text: raw.trim() })
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

// 面板原本用的四種，一律用大括號形式的跳脫序列寫：工具或編輯器弄丟 U+FE0F 也不會讓 fixture 悄悄變樣。
// 四位數的形式有些編輯工具會先解成字元，所以不用
const PACKAGE = '\u{1F4E6}'
const ALARM_CLOCK = '\u{23F0}'
const ARROWS = '\u{1F504}'
const WARNING = '\u{26A0}\u{FE0F}'
// 原始碼裡用跳脫序列寫的 emoji 要組出反斜線：直接寫四位數的跳脫，同樣會被那些工具解成字元，fixture 就不再是跳脫
const BS = '\\'

describe('Token Budget 面板不用 emoji', () => {
  it('元件原始碼（註解以外）沒有 emoji', async () => {
    const found: string[] = []
    for await (const file of walk(TOKEN_BUDGET_DIR)) {
      const src = await readFile(file, 'utf-8')
      for (const hit of findPictographs(src, file.endsWith('.css'))) {
        found.push(`  ${path.relative(TOKEN_BUDGET_DIR, file)}:${hit.line}  ${hit.text}`)
      }
    }
    expect(found, `面板的圖示請用 EventIcon：\n${found.join('\n')}`).toEqual([])
  })

  it('兩份 catalog 的 tokenBudget.* 文案沒有 emoji', () => {
    const found = LOCALES.flatMap(locale => catalogHits(messages[locale]).map(hit => `  ${locale} ${hit}`))
    expect(found, `經 t() 回來的文案也會顯示在面板上：\n${found.join('\n')}`).toEqual([])
  })

  it.each([PACKAGE, ALARM_CLOCK, ARROWS, WARNING, '\u{26A0}'])('抓得到程式碼裡的 %s', emoji => {
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
    expect(findPictographs(`.x { background: url(https://a.b/c.svg); content: '${WARNING}'; }`, true)).toHaveLength(1)
  })

  it.each([
    ['大括號', `const icon = '${BS}u{1F4E6}'`],
    ['四位數', `const icon = '${BS}u23F0'`],
    ['代理對', `const icon = '${BS}uD83D${BS}uDCE6'`],
  ])('跳脫序列寫的 emoji 也抓得到（%s）', (_label, line) => {
    expect(findPictographs(line)).toEqual([{ line: 1, text: line }])
  })

  // Dashboard 的 ProjectHealth.tsx 就用字元參照寫箭頭，照抄這個寫法放進面板也要擋
  it.each([
    ['十六進位', '<span aria-hidden="true">&#x23F0;</span>'],
    ['十進位', '<span aria-hidden="true">&#128230;</span>'],
  ])('JSX 的 HTML 字元參照寫的 emoji 也抓得到（%s）', (_label, line) => {
    expect(findPictographs(line)).toEqual([{ line: 1, text: line }])
    expect(findPictographs('<span>&#9650; {recent}</span>')).toEqual([])
  })

  it('CSS 跳脫寫的 emoji 也抓得到，不是 emoji 的跳脫不算', () => {
    expect(findPictographs(`.a::before { content: '${BS}23F0'; }`, true)).toHaveLength(1)
    expect(findPictographs(`.a::before { content: "${BS}1F4E6 x"; }`, true)).toHaveLength(1)
    expect(findPictographs(`.a::before { content: '${BS}25B8'; }`, true)).toEqual([])
    expect(findPictographs(`const arrow = '${BS}u2192'`)).toEqual([])
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
