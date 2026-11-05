import { describe, it, expect } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * renderer 裡當字色用的顏色都要走主題 token（佈景主題 A 裁決 7）。寫死的字色換主題不會跟著變、改 token 也改不到它：
 * A 之前有 20 處（outcome 標籤、op 徽章、task 狀態等，在時間線只有 1.6–4.2:1）。
 * accent（--color-accent）當字色在時間線只有 3.3–3.6:1，A 把它們都換掉，只留終端機限定的更新橫幅那一條。
 *
 * 逐個比對 `color:`，前面不能接字母、數字、底線或連字號（background-color、border-color、backgroundColor、--color-x 都不算）。
 * 不整行排除：10-31 手寫 grep 兩次漏掃，都出在整行過濾（同一行有 border 就把 color 一起刪了）。
 * CSS 的值整段看（註解先剝掉）；.ts／.tsx 只看引號裡的字串 —— 沒有引號的是 JS 運算式（例如 OUTCOME_COLORS[x]），這裡看不到值。
 * 字面色 = #hex、rgb()／rgba()／hsl()／hsla()、hwb()、lab()、lch()、oklab()、oklch()、color()、具名色（white，以及 CanvasText 這類系統色）；var()、color-mix()、
 * inherit／currentColor 等關鍵字不算。var(--x, #fff) 的後備值不算：cssCustomProperties.test.ts 保證 --x 有定義，後備值用不到。
 * 另一條守「拿 token 當字色」：清單外的 token 被當字色用就紅（11-01：「已複製」借 --color-heat-positive，見 tokenTextColors）。
 */

const RENDERER_DIR = fileURLToPath(new URL('../../src/renderer', import.meta.url))

const DECL = /(?<![-\w])color\s*:\s*(['"`]?)([^;,}'"`\n]+)/g
const LITERAL = /^(#[0-9a-f]{3,8}\b|(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\()/i
const BARE_WORD = /^[a-z]+$/i
const NOT_A_COLOR_LITERAL = new Set(['inherit', 'initial', 'unset', 'revert', 'currentcolor', 'transparent'])
const ACCENT = /^var\(\s*--color-accent\s*\)/
/** 准用 accent 當字色的地方：終端機限定的更新橫幅下載鈕（UpdateBanner.module.css），其他主題那顆鈕是主要文字色 */
const ACCENT_ALLOWED = (file: string, selector: string) =>
  file === path.join('components', 'UpdateBanner', 'UpdateBanner.module.css') && /data-theme="terminal"/.test(selector)

interface Source {
  file: string
  text: string
}

interface Finding {
  kind: 'literal' | 'accent'
  file: string
  line: number
  value: string
  selector: string
}

/** 往上找到這一行所屬規則的選擇器（含前幾行用逗號接起來的） */
function selectorOf(lines: string[], i: number): string {
  let j = i
  while (j >= 0 && !lines[j].includes('{')) j--
  if (j < 0) return '?'
  let selector = lines[j].trim()
  for (let k = j - 1; k >= 0 && lines[k].trim().endsWith(','); k--) selector = `${lines[k].trim()} ${selector}`
  return selector
}

/** CSS 註解換成等長的空白（保留換行，行號不變） */
function stripCssComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
}

function isLiteral(value: string): boolean {
  const first = value.split(/\s+/)[0]
  return LITERAL.test(first) || (BARE_WORD.test(first) && !NOT_A_COLOR_LITERAL.has(first.toLowerCase()))
}

export function scanTextColors(sources: Source[]): Finding[] {
  const findings: Finding[] = []
  for (const { file, text } of sources) {
    const css = file.endsWith('.css')
    const lines = (css ? stripCssComments(text) : text).split('\n')
    lines.forEach((line, i) => {
      for (const m of line.matchAll(DECL)) {
        const [, quote, raw] = m
        if (!css && !quote) continue
        const value = raw.trim()
        const kind = isLiteral(value) ? 'literal' : ACCENT.test(value) ? 'accent' : null
        if (kind) findings.push({ kind, file, line: i + 1, value, selector: css ? selectorOf(lines, i) : '(inline)' })
      }
    })
  }
  return findings
}

const VAR = /^var\(\s*(--[\w-]+)/

/**
 * 拿 token 當字色的地方（掃法同上：CSS 整段、.ts／.tsx 只看引號裡的；var(--x, …) 記 --x）。上面那條只抓寫死色與 accent，
 * 借別的 token 當字色它看不到：11-01 PR 查核才發現「已複製」借熱度圖的 --color-heat-positive，時間線只有 3.18:1，
 * app 量測時那 1.5 秒的狀態也沒畫出來。color-mix(…) 裡的 token 這裡看不到（逗號切斷值，同上）。
 */
export function tokenTextColors(sources: Source[]): Map<string, string[]> {
  const used = new Map<string, string[]>()
  for (const { file, text } of sources) {
    const css = file.endsWith('.css')
    const lines = (css ? stripCssComments(text) : text).split('\n')
    lines.forEach((line, i) => {
      for (const m of line.matchAll(DECL)) {
        const [, quote, raw] = m
        if (!css && !quote) continue
        const name = raw.trim().match(VAR)?.[1]
        if (name) used.set(name, [...(used.get(name) ?? []), `${file}:${i + 1}`])
      }
    })
  }
  return used
}

/**
 * 現在當字色用的 token，與它的對比由誰守。新增一個當字色的 token → 下面那條會紅 → 先在 themeContrast.test.ts 補對比，
 * 再加進來；沒人用了也會紅（清單跟程式碼雙向一致，不會留著過期的說明）。
 */
const TEXT_COLOR_TOKENS = new Map<string, string>([
  ['--color-text', '主要文字（沒有對比測試）'],
  ['--color-text-secondary', 'themeContrast：時間線灰字'],
  ['--color-text-muted', 'themeContrast：時間線灰字'],
  ['--color-error', 'themeContrast：錯誤色'],
  ['--color-outcome-committed-text', 'themeContrast：用途 token'],
  ['--color-outcome-tested-text', 'themeContrast：用途 token'],
  ['--color-outcome-in-progress-text', 'themeContrast：用途 token'],
  ['--color-outcome-quick-qa-text', 'themeContrast：用途 token'],
  ['--color-remote-text', 'themeContrast：用途 token'],
  ['--color-op-edit-text', 'themeContrast：用途 token'],
  ['--color-op-write-text', 'themeContrast：用途 token'],
  ['--color-op-read-text', 'themeContrast：用途 token'],
  ['--color-op-discovery-text', 'themeContrast：用途 token'],
  ['--color-jaccard-text', 'themeContrast：用途 token'],
  ['--color-task-in-progress-text', 'themeContrast：用途 token'],
  ['--color-task-completed-text', 'themeContrast：用途 token'],
  ['--color-subagent-text', 'themeContrast：用途 token'],
  ['--color-health-up-text', 'themeContrast：用途 token'],
  ['--color-health-down-text', 'themeContrast：用途 token'],
  ['--color-copied-text', 'themeContrast：用途 token'],
  ['--color-outcome-badge-text', 'themeContrast：徽章'],
  ['--color-system-label', '系統訊息的標籤（沒有對比測試）'],
  ['--color-code-text', 'themeContrast：程式碼區塊的本文，在深色的 --color-code-bg 上'],
  ['--color-code-comment', 'themeContrast：程式碼註解（蓋掉 highlight.js 樣式的 .hljs-comment／.hljs-quote）'],
  ['--color-bg', '危險按鈕 hover：錯誤色底配頁面底色的字，同一對顏色由錯誤色那條守'],
  ['--color-border', '搜尋篩選中間的分隔線「|」：裝飾，aria-hidden'],
  ['--color-accent', '只准終端機限定的更新橫幅（上面那條）'],
  ['--color-accent-user', '終端機限定的角色標籤（A 不調終端機配色）'],
  ['--color-accent-assistant', '終端機限定的角色標籤（A 不調終端機配色）'],
])

async function collect(dir: string): Promise<Source[]> {
  const sources: Source[] = []
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !/\.(css|tsx?)$/.test(entry.name) || entry.name.includes('.test.')) continue
    const full = path.join(entry.parentPath, entry.name)
    sources.push({ file: path.relative(dir, full), text: await readFile(full, 'utf-8') })
  }
  return sources
}

const show = (f: Finding) => `${f.file}:${f.line}  ${f.value}  ${f.selector}`

describe('字色走主題 token', () => {
  it('renderer 沒有寫死的字色；accent 當字色只剩終端機限定的更新橫幅', async () => {
    const sources = await collect(RENDERER_DIR)
    // 路徑錯或沒掃到檔案時，「沒有發現」會空著通過：先確認掃到了，而且准用的那一條找得到
    expect(sources.map(s => s.file)).toContain(path.join('components', 'Sidebar', 'Sidebar.module.css'))
    const findings = scanTextColors(sources)
    const allowed = findings.filter(f => f.kind === 'accent' && ACCENT_ALLOWED(f.file, f.selector))
    expect(allowed.map(show), '准用的終端機規則應該剛好找到一條（找不到 = 掃描壞了或規則被改掉）').toHaveLength(1)

    const literals = findings.filter(f => f.kind === 'literal')
    expect(literals.map(show), `寫死的字色要改用主題 token：\n${literals.map(show).join('\n')}`).toEqual([])
    const accents = findings.filter(f => f.kind === 'accent' && !ACCENT_ALLOWED(f.file, f.selector))
    expect(accents.map(show), `accent 當字色在時間線不到 4.5:1：\n${accents.map(show).join('\n')}`).toEqual([])
  })

  it('拿 token 當字色的都在清單裡、清單裡的都還有人用（新的要先補對比測試）', async () => {
    const used = tokenTextColors(await collect(RENDERER_DIR))
    // 掃描壞了的話「沒有清單外的」會空著通過：主要文字色到處都是，先確認數得到
    expect(used.get('--color-text')?.length ?? 0, '掃描壞了：主要文字色應該有幾十處').toBeGreaterThan(20)
    const unknown = [...used].filter(([name]) => !TEXT_COLOR_TOKENS.has(name)).map(([name, at]) => `${name}  ${at.join(', ')}`)
    expect(unknown, `這些 token 被當字色用、對比沒人守：\n${unknown.join('\n')}`).toEqual([])
    const unused = [...TEXT_COLOR_TOKENS.keys()].filter(name => !used.has(name))
    expect(unused, '清單裡這些已經沒有當字色用了').toEqual([])
  })

  it('當字色的 token：CSS 整段看、TS 只看引號裡的；後備值記前面的 token，註解、背景色、邊框色、JS 運算式不算', () => {
    const used = tokenTextColors([
      { file: 'a.module.css', text: '.a {\n  background-color: var(--color-bg);\n  color: var(--color-text, #fff);\n}\n/* color: var(--color-x) */' },
      { file: 'B.tsx', text: "<b style={{ color: 'var(--color-error)', borderColor: 'var(--color-border)' }} />\nconst c = { color: theme.x }" },
      { file: 'c.module.css', text: '.c { color: #fff }\n.d { border-color: var(--color-accent); color: var(--color-text) }' },
    ])
    expect(Object.fromEntries(used)).toEqual({
      '--color-text': ['a.module.css:3', 'c.module.css:2'],
      '--color-error': ['B.tsx:1'],
    })
  })

  it('逐個比對 color:，同一行有別的宣告也抓得到；背景色、邊框色、自訂屬性定義、關鍵字與 JS 運算式不算', () => {
    const findings = scanTextColors([
      { file: 'a.module.css', text: '.a {\n  background-color: #fff;\n  border-color: rgb(0, 0, 0);\n  --color-x: #123456;\n  color: #d97706;\n}' },
      { file: 'b.module.css', text: '.b { color: white !important }\n.c { color: inherit; }\n.d { color: currentColor }\n.e { color: hsl(0 0% 50%) }' },
      { file: 'c.module.css', text: '/* color: #fff 這是註解 */\n.f { color: var(--color-text, #fff) }\n.g { color: var(--color-accent-light) }' },
      { file: 'd.module.css', text: ':global([data-theme="x"]) .h,\n.i {\n  color: var(--color-accent);\n}' },
      { file: 'E.tsx', text: "<a style={{ border: 'none', color: 'var(--color-accent)' }} />\n<b style={{ backgroundColor: '#fff', color: '#fff' }} />" },
      { file: 'F.tsx', text: 'const s = { color: OUTCOME_COLORS[key], stopColor: "#fff" }' },
      // CSS Color 4 的寫法（11-01 PR 查核：原本只認 hex／rgb／hsl／具名色）；color-mix() 是混 token，不算
      { file: 'g.module.css', text: '.j { color: oklch(50% 0 0) }\n.k { color: lab(50% 0 0) }\n.l { color: color(srgb 0.5 0.5 0.5) }\n.m { color: hwb(0 0% 50%) }\n.n { color: color-mix(in srgb, var(--color-text) 50%, transparent) }' },
    ])
    expect(findings.map(f => `${f.kind} ${f.file}:${f.line} ${f.value} | ${f.selector}`)).toEqual([
      'literal a.module.css:5 #d97706 | .a {',
      'literal b.module.css:1 white !important | .b { color: white !important }',
      'literal b.module.css:4 hsl(0 0% 50%) | .e { color: hsl(0 0% 50%) }',
      'accent d.module.css:3 var(--color-accent) | :global([data-theme="x"]) .h, .i {',
      'accent E.tsx:1 var(--color-accent) | (inline)',
      'literal E.tsx:2 #fff | (inline)',
      'literal g.module.css:1 oklch(50% 0 0) | .j { color: oklch(50% 0 0) }',
      'literal g.module.css:2 lab(50% 0 0) | .k { color: lab(50% 0 0) }',
      'literal g.module.css:3 color(srgb 0.5 0.5 0.5) | .l { color: color(srgb 0.5 0.5 0.5) }',
      'literal g.module.css:4 hwb(0 0% 50%) | .m { color: hwb(0 0% 50%) }',
    ])
  })

  it('准用規則只認終端機限定的更新橫幅', () => {
    const banner = path.join('components', 'UpdateBanner', 'UpdateBanner.module.css')
    expect(ACCENT_ALLOWED(banner, ':global([data-theme="terminal"]) .downloadBtn {')).toBe(true)
    expect(ACCENT_ALLOWED(banner, '.downloadBtn {')).toBe(false)
    expect(ACCENT_ALLOWED(path.join('components', 'ChatView', 'ChatView.module.css'), ':global([data-theme="terminal"]) .x {')).toBe(false)
  })
})
