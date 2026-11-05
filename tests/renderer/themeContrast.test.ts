import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/**
 * 主題顏色的對比（WCAG AA：一般大小的字 4.5:1）。
 *
 * 錯誤色（--color-error）的字在每個主題、每種會出現的底色上都要讀得清楚：timeline 原本的 #dc3545 只有 4.07–4.37。
 * 底色取錯誤色的字實際出現的地方：對話區的錯誤（--color-bg）、側欄（--color-bg-sidebar）、錯誤畫面的說明框（--color-bubble-system），
 * 以及泡泡上的「已捨棄分支」徽章（--color-bubble-user／-assistant；徽章沒有自己的底），還有強調色淡底 --color-accent-light
 * （.highlightTarget 等閃一下的起點；黑板計畫 PR2 加：spike 的黑板錯誤色對它只有 4.45）。
 * 主題只寫跟 :root 不同的 token，其餘沿用 :root；半透明的底色疊在該主題的 --color-bg 上算，半透明的字色再疊在那個底色上算。
 *
 * 主題清單取自 ThemeContext.tsx 的 ThemeId：app 選得到的主題都會檢查。timeline 是 :root；其他主題缺 CSS 區塊時直接報錯，
 * 不會被略過。只讀每個主題的第一個 `[data-theme="x"] {` 區塊，@media 裡或之後重複的覆寫不算。
 *
 * 佈景主題 A（時間線字級與對比調整）：
 * - 已捨棄分支的泡泡不再整個淡化成 opacity 0.7（以前徽章與內文跟泡泡底一起疊在頁面底色上，實際約 3:1），
 *   內文改用次要字，所以徽章就是畫在不透明泡泡上的錯誤色、內文就是下面的「時間線灰字」。
 * - 寫死的字色收進 token，每個主題的區塊都要明寫：缺了不會報錯、只會沿用 :root 的時間線值。
 * - 用途 token 與徽章的對比：時間線在下面；黑板另成一段（底色照黑板 CSS 的實際底）。
 *
 * 黑板計畫 PR2（改動 10）：檔案室與終端機移除（裁決 19），主題清單剛好是時間線與黑板；A 的「舊主題不調色」那條隨之拿掉
 * （留著的話，黑板會被當成舊主題、要求等於改版前的寫死色）。
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8')
const GLOBAL_CSS = read('../../src/renderer/styles/global.css')
const THEME_CONTEXT = read('../../src/renderer/context/ThemeContext.tsx')
const SURFACES = ['--color-bg', '--color-bg-sidebar', '--color-bubble-system', '--color-bubble-user', '--color-bubble-assistant', '--color-accent-light']
const AA_NORMAL_TEXT = 4.5

type Rgba = [number, number, number, number]

function tokens(selector: string): Record<string, string> {
  const start = GLOBAL_CSS.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`global.css 沒有 ${selector}`)
  const body = GLOBAL_CSS.slice(start, GLOBAL_CSS.indexOf('\n}', start))
  return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]))
}

/** `type ThemeId = 'a' | 'b'` 的成員 */
function themeIds(source: string): string[] {
  const sf = ts.createSourceFile('ThemeContext.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  for (const stmt of sf.statements) {
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === 'ThemeId' && ts.isUnionTypeNode(stmt.type)) {
      return stmt.type.types.flatMap(t => (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal) ? [t.literal.text] : []))
    }
  }
  throw new Error('找不到 ThemeId')
}

function parseColor(value: string): Rgba {
  if (value === 'transparent') return [0, 0, 0, 0]
  const hex = value.match(/^#([0-9a-f]{6})$/i)
  if (hex) return [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16), 1]
  const fn = value.match(/^rgba?\(([^)]+)\)$/)
  if (fn) {
    const [r, g, b, a = 1] = fn[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    // 百分比之類的寫法會變成 NaN，而 NaN < 4.5 是 false：那個底色會被默默略過、照樣報綠
    if ([r, g, b, a].every(Number.isFinite)) return [r, g, b, a]
  }
  throw new Error(`認不得的顏色：${value}`)
}

/** 半透明的顏色疊在不透明的底上 */
function over([r, g, b, a]: Rgba, [br, bg, bb]: Rgba): Rgba {
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a), 1]
}

function luminance([r, g, b]: Rgba): number {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const ROOT = tokens(':root')
const THEME_IDS = themeIds(THEME_CONTEXT)
/** 主題自己的區塊（timeline = :root），不含沿用的值：「有沒有明寫」看這個 */
const OWN: Record<string, Record<string, string>> = Object.fromEntries(
  THEME_IDS.map(id => [id, id === 'timeline' ? ROOT : tokens(`[data-theme="${id}"]`)]),
)
/** 主題實際生效的值（沒寫的沿用 :root） */
const THEMES: Record<string, Record<string, string>> = Object.fromEntries(
  THEME_IDS.map(id => [id, { ...ROOT, ...OWN[id] }]),
)

/** token 的顏色；值是 var(--x) 的話取同一個主題的 --x（:root 的 --chart-outcome-unknown 就是 var(--color-text-muted)） */
function tokenColor(t: Record<string, string>, token: string): Rgba {
  let value = t[token]
  if (value === undefined) throw new Error(`沒有 ${token}`)
  for (let depth = 0; depth < 5; depth++) {
    const ref = value.match(/^var\(\s*(--[\w-]+)\s*\)$/)
    if (!ref) return parseColor(value)
    const next = t[ref[1]]
    if (next === undefined) throw new Error(`${token} 參照的 ${ref[1]} 沒有定義`)
    value = next
  }
  throw new Error(`${token} 的 var() 參照太多層`)
}

/** 某主題的一個底色 token，半透明的話疊在該主題的 --color-bg 上 */
function surface(t: Record<string, string>, token: string): Rgba {
  return over(tokenColor(t, token), tokenColor(t, '--color-bg'))
}

/** 字色在每個底色上的對比，回傳不到 4.5 的那些（`底色說明 對比`） */
function lowContrast(fg: string, surfaces: { label: string; color: Rgba }[]): string[] {
  const text = parseColor(fg)
  return surfaces
    .map(({ label, color }) => ({ label, ratio: contrast(over(text, color), color) }))
    .filter(({ ratio }) => ratio < AA_NORMAL_TEXT)
    .map(({ label, ratio }) => `${label} ${ratio.toFixed(2)}`)
}

describe('主題的錯誤色對比', () => {
  // 公式或解析壞掉時，下面的主題檢查可能全部「通過」：先用已知的參考值確認它算得對
  it('對比與疊色算得出 WCAG 的參考值', () => {
    expect(contrast(parseColor('#000000'), parseColor('#FFFFFF'))).toBeCloseTo(21, 5)
    expect(contrast(parseColor('#767676'), parseColor('#FFFFFF'))).toBeCloseTo(4.54, 2)
    expect(over(parseColor('rgba(0, 0, 0, 0.5)'), parseColor('#FFFFFF'))).toEqual([127.5, 127.5, 127.5, 1])
    expect(over(parseColor('transparent'), parseColor('#1B1D23'))).toEqual(parseColor('#1B1D23'))
  })

  it('認不得的顏色寫法直接報錯，不會變成 NaN 被略過；主題清單讀得到', () => {
    expect(() => parseColor('rgb(10% 20% 30%)')).toThrow()
    expect(() => parseColor('var(--color-bg)')).toThrow()
    // token 的 var() 參照只取同一個主題的值；參照不到或繞圈直接報錯
    expect(tokenColor({ '--a': 'var(--b)', '--b': '#102030' }, '--a')).toEqual([16, 32, 48, 1])
    expect(() => tokenColor({ '--a': 'var(--b)' }, '--a')).toThrow()
    expect(() => tokenColor({ '--a': 'var(--a)' }, '--a')).toThrow()
    expect(themeIds("export type ThemeId = 'a' | 'b'")).toEqual(['a', 'b'])
    // 剛好這兩個：舊主題沒刪乾淨（ThemeId 還列著）也要紅，不只「有黑板」
    expect([...THEME_IDS].sort()).toEqual(['board', 'timeline'])
  })

  it.each(Object.keys(THEMES))('%s：錯誤色在每種底色上都至少 4.5:1', theme => {
    const t = THEMES[theme]
    expect(parseColor(t['--color-bg'])[3], '--color-bg 要是不透明的，半透明的底色才有東西可以疊').toBe(1)
    const low = lowContrast(t['--color-error'], SURFACES.map(s => ({ label: s, color: surface(t, s) })))
    expect(low, `${theme} 的 --color-error（${t['--color-error']}）對比不足：\n${low.join('\n')}`).toEqual([])
  })
})

// ── 佈景主題 A ──────────────────────────────────────────────

/**
 * 用途 token：原本寫死在元件 CSS 的字色（裁決 7），按用途命名 —— 同色系在不同地方有不同 hex，合併的話時間線會變色。
 * --color-copied-text 是 11-01 PR 查核補的：session id 的「已複製」原本借熱度圖的 --color-heat-positive 當字色，
 * 時間線只有 3.18:1；app 量測時那 1.5 秒沒畫出來，寫死色的掃描也看不到它（是 token），所以兩邊都沒抓到。
 */
const USAGE_TOKENS = [
  '--color-outcome-committed-text', '--color-outcome-tested-text', '--color-outcome-in-progress-text', '--color-outcome-quick-qa-text',
  '--color-remote-text',
  '--color-op-edit-text', '--color-op-write-text', '--color-op-read-text', '--color-op-discovery-text',
  '--color-jaccard-text',
  '--color-task-in-progress-text', '--color-task-completed-text',
  '--color-subagent-text',
  '--color-health-up-text', '--color-health-down-text',
  '--color-copied-text',
]
/** 儀表板「未收尾的對話」outcome 徽章：白字配實心底（裁決 13）；清單只會出現 unknown／in-progress／quick-qa */
const BADGE_BG_TOKENS = ['--color-outcome-unknown-badge-bg', '--color-outcome-in-progress-badge-bg', '--color-outcome-quick-qa-badge-bg']
const BADGE_TEXT = '--color-outcome-badge-text'
const LOGO_TOKENS = ['--logo-ring', '--logo-mark']
const A_TOKENS = [...LOGO_TOKENS, ...USAGE_TOKENS, ...BADGE_BG_TOKENS, BADGE_TEXT]

/** logo 跟主題變色（裁決 6）：圈與尾巴 / 三角，值取自比較頁；黑板是粉筆白圈 + 粉筆黃（黑板計畫 PR2 改動 8） */
const LOGO_VALUES: Record<string, [string, string]> = {
  timeline: ['#0891b2', '#1e293b'],
  board: ['#f2f0e7', '#f8e06a'],
}

/**
 * 時間線用途 token 實際的底：容器 token，加上元件自己疊的淡底（基色 + 比例；color-mix(in srgb, X p%, transparent) = X 透明度 p）。
 * ⚠️ 元件 CSS 的淡底或容器改了要同步更新這張表；真實渲染以 dev app 的 contrast_audit 為準（計畫完成條件 1）。
 * 11-01 逐一讀元件 CSS 組出來，各 token 的現況最差值跟計畫表格的審查數字逐一相同（committed 2.33、遠端 3.34、task 1.62……）。
 */
/** 底：容器 token（半透明的疊在主題的 --color-bg 上）或另一個底，上面可以再疊一層淡底（黑板的徽章淡底疊在側欄列的 hover 淡底上） */
interface Surface { container: string | Surface; tint?: { base: string; alpha: number } }
const tinted = (base: string, alpha: number, containers: (string | Surface)[]): Surface[] => containers.map(container => ({ container, tint: { base, alpha } }))
const plain = (containers: string[]): Surface[] => containers.map(container => ({ container }))
const SESSION_ROW = ['--color-bg-sidebar', '--color-bg-hover', '--color-accent-light'] // 側欄 session 列：平常（側欄底）／hover／選中
const DRAWER_ENTRY = ['--color-bg', '--color-bg-hover'] // 檔案歷史抽屜：.drawer 底／.timelineEntry:hover
const RELATED_CARD = ['--color-bg-sidebar', '--color-bg-hover'] // 相關 session 面板：.relatedPanel／.relatedCard:hover
const TASK_ITEM = ['--color-bg-hover', '--color-accent-light'] // .tasksPanel 底／.taskItemFlash 閃一下的起點
const HEALTH_ITEM = ['--color-bg-sidebar', '--color-bg-hover'] // 儀表板 .card／.healthItem:hover
const USAGE_SURFACES: Record<string, Surface[]> = {
  // Sidebar.module.css .outcomeTag[data-outcome=…]
  '--color-outcome-committed-text': tinted('#22c55e', 0.2, SESSION_ROW),
  '--color-outcome-tested-text': tinted('#3b82f6', 0.2, SESSION_ROW),
  '--color-outcome-in-progress-text': tinted('#f59e0b', 0.2, SESSION_ROW),
  '--color-outcome-quick-qa-text': tinted('#8b5cf6', 0.2, SESSION_ROW),
  // Sidebar.module.css .remoteBadge（22%）、.remoteBadgeLink:hover（38%）
  '--color-remote-text': [...tinted('#14b8a6', 0.22, SESSION_ROW), ...tinted('#14b8a6', 0.38, SESSION_ROW)],
  // Archaeology.module.css .opBadge[data-op=…]（rgba(…, 0.15)）
  '--color-op-edit-text': tinted('#f59e0b', 0.15, DRAWER_ENTRY),
  '--color-op-write-text': tinted('#22c55e', 0.15, DRAWER_ENTRY),
  '--color-op-read-text': tinted('#3b82f6', 0.15, DRAWER_ENTRY),
  '--color-op-discovery-text': tinted('#8b5cf6', 0.15, DRAWER_ENTRY),
  // Archaeology.module.css .jaccardBadge（rgba(59, 130, 246, 0.1)）
  '--color-jaccard-text': tinted('#3b82f6', 0.1, RELATED_CARD),
  // ChatView.module.css .taskStatusInProgress／.taskStatusCompleted（rgba(…, 0.12)）
  '--color-task-in-progress-text': tinted('#f59e0b', 0.12, TASK_ITEM),
  '--color-task-completed-text': tinted('#10b981', 0.12, TASK_ITEM),
  // ChatView.module.css .subagentTypeBadge（rgba(139, 92, 246, 0.1)），在 .subagentBreadcrumb（bg-hover）上
  '--color-subagent-text': tinted('#8b5cf6', 0.1, ['--color-bg-hover']),
  // Dashboard.module.css .healthTrendUp／.healthTrendDown（沒有自己的底）
  '--color-health-up-text': plain(HEALTH_ITEM),
  '--color-health-down-text': plain(HEALTH_ITEM),
  // ChatView.module.css .sessionIdChipCopied：chip 透明底、在 .chatView 的 --color-bg 上；剛點完滑鼠多半還在上面 → .sessionIdChip:hover 的 bg-hover
  '--color-copied-text': plain(['--color-bg', '--color-bg-hover']),
}

/**
 * 時間線次要字／灰字會出現的底（含 Token Budget 建議的 warning／info 6% 淡底，疊在 .insightsPanel 的 --color-bg 上）。
 * 淡底的基色跟 TokenBudget.module.css 一樣取 --chart-marker-*，不另寫一份 hex。
 */
const GRAY_SURFACES: Surface[] = [
  ...plain(['--color-bg', '--color-bg-sidebar', '--color-bg-hover', '--color-bg-selected', '--color-accent-light',
    '--color-bubble-user', '--color-bubble-assistant', '--color-bubble-system']),
  ...tinted('--chart-marker-warning', 0.06, ['--color-bg']),
  ...tinted('--chart-marker-info', 0.06, ['--color-bg']),
]

function resolveSurface(t: Record<string, string>, s: Surface): { label: string; color: Rgba } {
  const under = typeof s.container === 'string'
    ? { label: s.container, color: surface(t, s.container) }
    : resolveSurface(t, s.container)
  if (!s.tint) return under
  // 基色可以是 hex，也可以是 token 名稱（取這個主題的值）
  const [r, g, b] = s.tint.base.startsWith('--') ? tokenColor(t, s.tint.base) : parseColor(s.tint.base)
  return { label: `${s.tint.base} ${+(s.tint.alpha * 100).toFixed(1)}% over ${under.label}`, color: over([r, g, b, s.tint.alpha], under.color) }
}

describe('佈景主題 A：新增的 token', () => {
  it.each(THEME_IDS)('%s 的區塊明寫 A 新增的每個 token（沒寫會沿用 :root 的時間線值）', theme => {
    const missing = A_TOKENS.filter(name => !(name in OWN[theme]))
    expect(missing, `${theme} 缺：\n${missing.join('\n')}`).toEqual([])
  })

  it.each(THEME_IDS)('%s 的 logo 顏色照比較頁', theme => {
    expect(LOGO_TOKENS.map(name => (THEMES[theme][name] ?? '(沒有)').toLowerCase())).toEqual(LOGO_VALUES[theme])
  })

  it('底色表涵蓋每個用途 token，用途 token 都在 A 的清單裡', () => {
    expect(Object.keys(USAGE_SURFACES).sort()).toEqual([...USAGE_TOKENS].sort())
    expect(USAGE_TOKENS.every(name => A_TOKENS.includes(name))).toBe(true)
  })
})

describe('佈景主題 A：時間線的對比', () => {
  const t = THEMES.timeline

  it.each(['--color-text-secondary', '--color-text-muted'])('時間線 %s 在每種會出現的底上都至少 4.5:1', name => {
    const low = lowContrast(t[name], GRAY_SURFACES.map(s => resolveSurface(t, s)))
    expect(low, `時間線 ${name}（${t[name]}）對比不足：\n${low.join('\n')}`).toEqual([])
  })

  it.each(USAGE_TOKENS)('時間線 %s 在它所有出現處的底上都至少 4.5:1', name => {
    expect(t[name], `時間線沒有 ${name}`).toBeDefined()
    const low = lowContrast(t[name], USAGE_SURFACES[name].map(s => resolveSurface(t, s)))
    expect(low, `時間線 ${name}（${t[name]}）對比不足：\n${low.join('\n')}`).toEqual([])
  })

  it.each(BADGE_BG_TOKENS)('時間線徽章字色在 %s 上至少 4.5:1', name => {
    expect(t[name], `時間線沒有 ${name}`).toBeDefined()
    expect(t[BADGE_TEXT], `時間線沒有 ${BADGE_TEXT}`).toBeDefined()
    const low = lowContrast(t[BADGE_TEXT], [{ label: name, color: surface(t, name) }])
    expect(low, `時間線徽章（${t[BADGE_TEXT]} 配 ${t[name]}）對比不足：\n${low.join('\n')}`).toEqual([])
  })
})

/**
 * 程式碼區塊（2026-11-05）：MarkdownRenderer 對每個主題都載同一份 highlight.js 樣式（下面讀 import 那行，目前是 atom-one-dark），
 * 那份樣式是配它自己的底（atom-one-dark 的 #282c34）。用 MarkdownRenderer 的元件在包住它的那層把 <pre> 的底換成 --color-code-bg、
 * 字換成 --color-code-text，.hljs 的底改透明、字色沿用 → 程式碼區塊實際的底是主題的 --color-code-bg。
 * atom-one-dark 的註解色 #5c6370 在 --color-code-bg 上只有 2.42（時間線）、2.53（檔案室）、3.02（終端機），在 #282c34 上也只有 2.32
 * → 註解與引用改用 --color-code-comment（每個主題共用一個值，見 global.css）。樣式其餘的字色直接讀檔逐色檢查：
 * highlight.js 的 patch 會自動合併，樣式換上的顏色不到 4.5:1（或是認不得的寫法）時這裡會紅。
 * 同日盲審：思考區塊（ThinkingBlock）也用 MarkdownRenderer，原本沒有這組規則：有標語言的程式碼照 atom-one-dark 原樣畫
 * （註解 2.32），沒標語言的只是頁面上的等寬字、沒有框 → 每個畫 MarkdownRenderer 的地方都要有這組規則；
 * 引用了 MarkdownRenderer 卻認不出畫在哪裡的檔案直接紅（fail closed），主題限定或更具體的規則也不能換掉這些值。
 */
const RENDERER_DIR = fileURLToPath(new URL('../../src/renderer', import.meta.url))
const MARKDOWN_RENDERER = path.join('components', 'ChatView', 'MarkdownRenderer.tsx')
const COMMENT_TOKEN = /^var\(\s*--color-code-comment\s*(,[^)]*)?\)$/

interface CssRule { selectors: string[]; decls: [string, string][]; inAtRule: boolean }

/** 依 sep 切開，括號裡的不切（:is(a, b) 的逗號、url(data:…;…) 的分號） */
function splitTopLevel(text: string, sep: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of text) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === sep && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  parts.push(current)
  return parts.map(p => p.trim()).filter(Boolean)
}

/**
 * CSS 的每條規則（註解先剝掉）：選擇器清單（空白正規化）、依序的宣告、在不在 @media 這類區塊裡。字串裡的大括號不處理。
 * 選擇器取上一個分號之後那段：@import／@charset／@layer a, b; 這類沒有大括號的 @ 規則不會黏到下一條規則上
 */
function cssRules(source: string): CssRule[] {
  const rules: CssRule[] = []
  const open: string[] = []
  let buffer = ''
  for (const ch of source.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (ch === '{') {
      open.push(buffer.slice(buffer.lastIndexOf(';') + 1).trim())
      buffer = ''
    } else if (ch === '}') {
      const prelude = open.pop() ?? ''
      if (prelude !== '' && !prelude.startsWith('@')) {
        rules.push({
          selectors: splitTopLevel(prelude, ',').map(s => s.replace(/\s+/g, ' ')),
          decls: splitTopLevel(buffer, ';').flatMap(d => {
            const colon = d.indexOf(':')
            return colon > 0 ? [[d.slice(0, colon).trim().toLowerCase(), d.slice(colon + 1).trim()] as [string, string]] : []
          }),
          inAtRule: open.some(p => p.startsWith('@')),
        })
      }
      buffer = ''
    } else {
      buffer += ch
    }
  }
  return rules
}

/** 選擇器清單裡有 selector、不在 @media 這類區塊裡的規則中，props 最後一次的值（後寫的蓋前面；@media 裡的不一定生效，不算） */
function lastValue(rules: CssRule[], selector: string, props: string[]): string | undefined {
  let value: string | undefined
  for (const rule of rules) {
    if (rule.inAtRule || !rule.selectors.includes(selector)) continue
    for (const [prop, v] of rule.decls) if (props.includes(prop)) value = v
  }
  return value
}

/** :global(x) 換成 x（CSS module 的寫法），比的是選擇器實際選到什麼 */
function unwrapGlobal(selector: string): string {
  let out = selector
  for (let i = 0; i < 5 && out.includes(':global('); i++) out = out.replace(/:global\(((?:[^()]|\([^()]*\))*)\)/g, '$1')
  return out.replace(/\s+/g, ' ').trim()
}

/** 選擇器最右邊那段（最後一個後代、>、+、~ 之後；括號與中括號裡的不算）：規則實際套用的元素，與它左邊那段 */
function splitSubject(selector: string): { context: string; subject: string } {
  const s = unwrapGlobal(selector)
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    else if (depth === 0 && (ch === ' ' || ch === '>' || ch === '+' || ch === '~')) start = i + 1
  }
  return { context: s.slice(0, start), subject: s.slice(start).trim() }
}

/** 包住 node 的最近一層 className={styles.x} 的 x */
function wrapperClass(node: ts.Node, sf: ts.SourceFile): string | null {
  for (let p = node.parent; p; p = p.parent) {
    if (!ts.isJsxElement(p) || p.openingElement === node) continue
    for (const attr of p.openingElement.attributes.properties) {
      if (!ts.isJsxAttribute(attr) || attr.name.getText(sf) !== 'className') continue
      const expr = attr.initializer && ts.isJsxExpression(attr.initializer) ? attr.initializer.expression : undefined
      if (expr && ts.isPropertyAccessExpression(expr) && expr.expression.getText(sf) === 'styles') return expr.name.text
    }
  }
  return null
}

interface Mount { file: string; wrapper: string | null; css: string | null }

/** 指到 MarkdownRenderer 模組的字串（import、export … from、import()） */
const RENDERER_SPECIFIER = /['"`][^'"`\n]*\/MarkdownRenderer(\.tsx?)?['"`]/

/**
 * renderer 裡每個畫 MarkdownRenderer 的地方：所在檔案、包住它的 class、styles 來自哪個 CSS module。
 * 只認得 `import X from` 與 `import { default as X } from` 再寫成 <X />；refs 是所有引用到那個模組的檔案，認不出掛載點的由測試報紅
 */
function markdownMounts(): { mounts: Mount[]; refs: string[] } {
  const mounts: Mount[] = []
  const refs: string[] = []
  for (const file of readdirSync(RENDERER_DIR, { recursive: true, encoding: 'utf8' })) {
    if (!/\.tsx?$/.test(file) || file === MARKDOWN_RENDERER) continue
    const text = readFileSync(path.join(RENDERER_DIR, file), 'utf-8')
    if (!RENDERER_SPECIFIER.test(text)) continue
    refs.push(file)
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const names = new Set<string>()
    let css: string | null = null
    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue
      const clause = stmt.importClause
      if (/(^|\/)MarkdownRenderer$/.test(stmt.moduleSpecifier.text) && clause) {
        if (clause.name) names.add(clause.name.text)
        const named = clause.namedBindings
        if (named && ts.isNamedImports(named)) {
          for (const el of named.elements) if ((el.propertyName ?? el.name).getText(sf) === 'default') names.add(el.name.text)
        }
      }
      if (clause?.name?.text === 'styles' && stmt.moduleSpecifier.text.endsWith('.module.css')) css = path.join(path.dirname(file), stmt.moduleSpecifier.text)
    }
    const visit = (node: ts.Node) => {
      if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && names.has(node.tagName.getText(sf))) {
        mounts.push({ file, wrapper: wrapperClass(node, sf), css })
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return { mounts, refs }
}

/**
 * 每個掛載點在包住 MarkdownRenderer 的那層（.x）都要有的值；var() 可以帶後備值。
 * match 比選擇器最右邊那段：主題限定、更具體或寫在 @media 裡、選到同一個元素的規則也要是這個值
 */
const CODE_BLOCK_RULES: { target: string; match: RegExp; props: string[]; want: RegExp; label: string }[] = [
  { target: ':global(pre)', match: /^pre(?![\w-])/, props: ['background-color', 'background'], want: /^var\(\s*--color-code-bg\s*(,[^)]*)?\)$/, label: 'var(--color-code-bg)' },
  { target: ':global(pre)', match: /^pre(?![\w-])/, props: ['color'], want: /^var\(\s*--color-code-text\s*(,[^)]*)?\)$/, label: 'var(--color-code-text)' },
  { target: ':global(.hljs)', match: /\.hljs(?![\w-])/, props: ['background-color', 'background'], want: /^transparent$/, label: 'transparent' },
  { target: ':global(.hljs)', match: /\.hljs(?![\w-])/, props: ['color'], want: /^inherit$/, label: 'inherit' },
  { target: ':global(.hljs-comment)', match: /\.hljs-comment(?![\w-])/, props: ['color'], want: COMMENT_TOKEN, label: 'var(--color-code-comment)' },
  { target: ':global(.hljs-quote)', match: /\.hljs-quote(?![\w-])/, props: ['color'], want: COMMENT_TOKEN, label: 'var(--color-code-comment)' },
]
/** 上面蓋掉字色的 highlight.js 選擇器：樣式裡只有它們的字色不算，其餘逐色檢查 */
const OVERRIDDEN = new Set(['.hljs', '.hljs-comment', '.hljs-quote'])

/** MarkdownRenderer 載的 highlight.js 樣式（import 那行寫的那一份） */
function highlightStyle(): { spec: string; rules: CssRule[] } {
  const source = readFileSync(path.join(RENDERER_DIR, MARKDOWN_RENDERER), 'utf-8')
  const specs = [...source.matchAll(/^import\s+['"](highlight\.js\/styles\/[^'"]+\.css)['"]/gm)].map(m => m[1])
  if (specs.length !== 1) throw new Error(`MarkdownRenderer 應該只載一份 highlight.js 樣式，找到 ${specs.length} 份`)
  const file = createRequire(path.join(RENDERER_DIR, MARKDOWN_RENDERER)).resolve(specs[0])
  return { spec: specs[0], rules: cssRules(readFileSync(file, 'utf-8')) }
}
const HIGHLIGHT = highlightStyle()

describe('程式碼區塊的對比', () => {
  it.each(THEME_IDS)('%s：--color-code-comment 在程式碼底（--color-code-bg）上至少 4.5:1', theme => {
    const t = THEMES[theme]
    expect(t['--color-code-comment'], `${theme} 沒有 --color-code-comment`).toBeDefined()
    const low = lowContrast(t['--color-code-comment'], [{ label: '--color-code-bg', color: surface(t, '--color-code-bg') }])
    expect(low, `${theme} 的程式碼註解（${t['--color-code-comment']} 配 ${t['--color-code-bg']}）對比不足：\n${low.join('\n')}`).toEqual([])
  })

  it.each(THEME_IDS)('%s：程式碼本文與 highlight.js 樣式其餘的字色在程式碼底上都至少 4.5:1', theme => {
    const t = THEMES[theme]
    const bg = { label: `--color-code-bg ${t['--color-code-bg']}`, color: surface(t, '--color-code-bg') }
    const colours = [{ who: '--color-code-text', colour: t['--color-code-text'] }]
    for (const rule of HIGHLIGHT.rules) {
      const kept = rule.selectors.filter(s => !OVERRIDDEN.has(s))
      if (rule.inAtRule || kept.length === 0) continue
      for (const [prop, value] of rule.decls) if (prop === 'color') colours.push({ who: kept.join(', '), colour: value })
    }
    // 讀檔或解析壞掉時清單只剩本文一色、照樣全綠
    expect(colours.length, `${HIGHLIGHT.spec} 讀不到字色`).toBeGreaterThan(1)
    const low = colours.flatMap(({ who, colour }) => lowContrast(colour, [bg]).map(l => `${who}（${colour}）配 ${l}`))
    expect(low, `${theme} 的程式碼區塊對比不足：\n${low.join('\n')}`).toEqual([])
  })

  it('highlight.js 樣式裡只有 .hljs 設底色（上面的對比都對 --color-code-bg 算）', () => {
    const backgrounds = HIGHLIGHT.rules
      .filter(r => r.decls.some(([prop]) => prop === 'background' || prop === 'background-color'))
      .map(r => r.selectors.join(', '))
    expect(backgrounds, `${HIGHLIGHT.spec} 有別的底色：那些字要改成對它算`).toEqual(['.hljs'])
  })

  it('每個畫 MarkdownRenderer 的地方，包住它的那層都有程式碼區塊的規則', () => {
    const { mounts, refs } = markdownMounts()
    // 掃描壞掉時清單是空的、照樣全綠：已知的兩處要找得到
    expect(mounts.map(m => path.basename(m.file))).toEqual(expect.arrayContaining(['MessageBubble.tsx', 'ThinkingBlock.tsx']))
    const unrecognised = refs.filter(file => !mounts.some(m => m.file === file))
      .map(file => `${file}：引用了 MarkdownRenderer，卻認不出它畫在哪裡（只認得 import X from 或 import { default as X } from，再寫成 <X />）`)
    const problems = mounts.flatMap(({ file, wrapper, css }) => {
      if (!wrapper || !css) return [`${file}：MarkdownRenderer 沒有包在 className={styles.x} 的元素裡，或沒有 import styles`]
      const rules = cssRules(readFileSync(path.join(RENDERER_DIR, css), 'utf-8'))
      const wrapperClass = new RegExp(`\\.${wrapper}(?![\\w-])`)
      return CODE_BLOCK_RULES.flatMap(({ target, match, props, want, label }) => {
        const selector = `.${wrapper} ${target}`
        const value = lastValue(rules, selector, props)
        const base = value !== undefined && want.test(value) ? [] : [`${css}：${selector} 的 ${props[0]} 是 ${value ?? '（沒寫）'}，要 ${label}`]
        // 同一個元素的其他規則（主題限定、更具體、@media 裡）：設了這個屬性就要是同一個值，不然上面的對比前提不成立
        const overrides = rules.flatMap(rule => rule.selectors
          .filter(s => (s !== selector || rule.inAtRule) && match.test(splitSubject(s).subject) && wrapperClass.test(splitSubject(s).context))
          .flatMap(s => rule.decls.filter(([prop, v]) => props.includes(prop) && !want.test(v)).map(([prop, v]) => `${css}：${s} { ${prop}: ${v} }，要 ${label}`)))
        return [...base, ...overrides]
      })
    })
    expect([...unrecognised, ...problems], [...unrecognised, ...problems].join('\n')).toEqual([])
  })

  it('renderer 的 CSS 給 .hljs-comment／.hljs-quote 的字色都是 --color-code-comment', () => {
    const found: { file: string; rule: string; ok: boolean }[] = []
    for (const file of readdirSync(RENDERER_DIR, { recursive: true, encoding: 'utf8' })) {
      if (!file.endsWith('.css')) continue
      for (const rule of cssRules(readFileSync(path.join(RENDERER_DIR, file), 'utf-8'))) {
        // 只看選擇器最右邊那段：.hljs-comment .hljs-doctag 設的是註解裡 doctag 的字色，不是註解的
        const hits = rule.selectors.filter(s => /\.hljs-(comment|quote)(?![\w-])/.test(splitSubject(s).subject))
        if (hits.length === 0) continue
        for (const [prop, value] of rule.decls) {
          if (prop === 'color') found.push({ file, rule: `${hits.join(', ')} { color: ${value} }`, ok: COMMENT_TOKEN.test(value) })
        }
      }
    }
    // 掃描壞掉時什麼都找不到、照樣全綠：兩個掛載點的規則要找得到
    expect(found.filter(f => f.ok).map(f => path.basename(f.file))).toEqual(expect.arrayContaining(['MessageBubble.module.css', 'ThinkingBlock.module.css']))
    const others = found.filter(f => !f.ok).map(f => `${f.file}：${f.rule}`)
    expect(others, others.join('\n')).toEqual([])
  })
})

// ── 黑板（黑板計畫 PR2 改動 10）──────────────────────────────

/**
 * 黑板的字畫在哪：黑板的容器大多是透明的（泡泡、卡片、徽章、相關面板，對話與儀表板的外層本來就透明），字直接落在板面、側欄或抽屜上。
 * .main（對話、儀表板、儲存空間三頁的捲動區）的背景另有三團擦痕（粉筆白 5.5%／4.5%／4% 的 radial-gradient；spike App.module.css .main），
 * 擦痕不隨內容捲動、什麼字都可能捲到它上面 → .main 裡的字也要對擦痕最亮處（粉筆白 5.5% 疊板面，spike 的值是 #214A36）算。
 * 亮字在越亮的底上越差：黑板最亮的容器底是 --color-bg-selected／--color-accent-light（spike 都是 #24543D）。
 *
 * 表照 spike（f435aaa）的 CSS 加上計畫的改寫組出來：spike 的 rgba(242, 240, 231, α) 改成 --color-text 的 color-mix、
 * 寫死的 #0B2A1B 嵌入底改 --color-inset-bg、選中 session 保留 background-color（--color-accent-light）當記號的備援（改動 2、5）。
 * spike 沒做的對話頁與 Token Budget 照樣稿（.draft/theme-redesign/index.html 的 .win[data-theme="board"]）；兩邊都沒提的元件照現在的 CSS。
 * ⚠️ 元件 CSS 的底或容器改了要同步更新這張表；真實渲染以 dev app 的 contrast_audit 為準（計畫完成條件 1）。
 */
const SMUDGE: Surface = { container: '--color-bg', tint: { base: '--color-text', alpha: 0.055 } }
/** .main 裡透明元件的底：板面、擦痕最亮處 */
const BOARD_MAIN: Surface[] = [{ container: '--color-bg' }, SMUDGE]
/** 側欄 session 列：平常（側欄底）／hover（粉筆白 5%，spike .sessionItem:hover）／選中（保留的 background-color） */
const BOARD_SESSION_ROW: Surface[] = [
  ...plain(['--color-bg-sidebar']),
  ...tinted('--color-text', 0.05, ['--color-bg-sidebar']),
  ...plain(['--color-accent-light']),
]

/**
 * 黑板灰字、錯誤色與粉筆黃、粉紅（頁面與卡片標題、側欄分區標題、選中的專案、搜尋命中、使用者的角色名、壓縮與已捨棄的標示）會出現的底：
 * - --color-bg：抽屜 .drawer、儲存空間的確認框 .dialog（黑板沒改底；兩個都在 .main 外，沒有擦痕）
 * - BOARD_MAIN：對話、儀表板、儲存空間
 * - 側欄 session 列（BOARD_SESSION_ROW）
 * - --color-bg-hover、--color-bg-selected：各頁的 chip 與 hover（元件現在的 CSS，黑板沒改）
 * - --color-inset-bg：嵌入板面的輸入框與下拉（搜尋框、儀表板篩選、儲存空間；spike 寫死的 #0B2A1B）
 * - 工具區塊：嵌入底 55% 疊在 .main 上（樣稿 .tool 的 rgba(11, 42, 27, .55)）
 * - Token Budget 建議的 warning／info 6% 淡底，疊在 .insightsPanel 的 --color-bg 上（同時間線）
 */
const BOARD_TEXT_SURFACES: Surface[] = [
  ...BOARD_MAIN,
  ...BOARD_SESSION_ROW,
  ...plain(['--color-bg-hover', '--color-bg-selected', '--color-inset-bg']),
  ...tinted('--color-inset-bg', 0.55, BOARD_MAIN),
  ...tinted('--chart-marker-warning', 0.06, ['--color-bg']),
  ...tinted('--chart-marker-info', 0.06, ['--color-bg']),
]
const BOARD_TEXT_TOKENS = ['--color-text-secondary', '--color-text-muted', '--color-error', '--chalk-yellow', '--chalk-pink', '--chalk-sky']

/** 黑板用途 token 實際的底（選擇器同時間線那張表；寫死的淡底基色照元件 CSS） */
const BOARD_USAGE_SURFACES: Record<string, Surface[]> = {
  // Sidebar.module.css .outcomeTag[data-outcome]：黑板拿掉淡底（spike），字直接在 session 列上
  '--color-outcome-committed-text': BOARD_SESSION_ROW,
  '--color-outcome-tested-text': BOARD_SESSION_ROW,
  '--color-outcome-in-progress-text': BOARD_SESSION_ROW,
  '--color-outcome-quick-qa-text': BOARD_SESSION_ROW,
  // .remoteBadge、.remoteBadgeLink:hover：黑板拿掉青綠淡底、跟 outcome 標籤一樣只留粉筆字（裁決 31；淡底疊在選中列上只有 4.46、連結 hover 3.61），
  // 字直接在 session 列上
  '--color-remote-text': BOARD_SESSION_ROW,
  // Archaeology.module.css .opBadge[data-op]：黑板拿掉淡底、改虛線框（spike），在抽屜的 --color-bg 與 .timelineEntry:hover 上
  '--color-op-edit-text': plain(DRAWER_ENTRY),
  '--color-op-write-text': plain(DRAWER_ENTRY),
  '--color-op-read-text': plain(DRAWER_ENTRY),
  '--color-op-discovery-text': plain(DRAWER_ENTRY),
  // .jaccardBadge 與 .relatedPanel 黑板都透明（spike）→ 落在對話頁的 .main 上；.relatedCard:hover
  '--color-jaccard-text': [...BOARD_MAIN, ...plain(['--color-bg-hover'])],
  // ChatView.module.css .taskStatusBadge：黑板拿掉淡底、改虛線框（裁決 32；淡底疊在 .taskItemFlash 起點上進行中只有 4.32），字直接在 tasks 面板上
  '--color-task-in-progress-text': plain(TASK_ITEM),
  '--color-task-completed-text': plain(TASK_ITEM),
  // .subagentTypeBadge：對話頁 spike 沒做、樣稿沒提 → 紫色淡底照舊（5.07，有過）
  '--color-subagent-text': tinted('#8b5cf6', 0.1, ['--color-bg-hover']),
  // Dashboard.module.css .healthTrendUp／Down 沒有自己的底，.card 黑板透明（spike）→ .main；.healthItem:hover
  '--color-health-up-text': [...BOARD_MAIN, ...plain(['--color-bg-hover'])],
  '--color-health-down-text': [...BOARD_MAIN, ...plain(['--color-bg-hover'])],
  // ChatView.module.css .sessionIdChipCopied：chip 與 .chatView 都透明 → .main；.sessionIdChip:hover
  '--color-copied-text': [...BOARD_MAIN, ...plain(['--color-bg-hover'])],
}

/**
 * 木框標題列（spike App.module.css .titleBar）：字是 --color-on-wood，底是木紋漸層，最差在暗端 --wood-dark（漸層下墊的實心色也是它）；
 * 標題列裡的鍵 hover 疊 on-wood 14%（spike 在 .titleBar 重新指向的 --color-bg-hover = rgba(35, 20, 11, 0.14)），
 * 選中疊淺木 55%（重新指向的 --color-accent-light = rgba(255, 240, 210, 0.55)）
 */
const WOOD_SURFACES: Surface[] = [
  ...plain(['--wood-dark']),
  ...tinted('--color-on-wood', 0.14, ['--wood-dark']),
  ...tinted('#fff0d2', 0.55, ['--wood-dark']),
]

/**
 * 板擦形狀的跳頂／跳底鍵（樣稿 .jb）：上 58% 深木柄、下 42% 淺毛氈。箭頭（--color-text）只畫在木柄上 —— 對毛氈只有 1.27:1，
 * 所以箭頭包在子元素裡、木柄色直接墊在子元素上，幾何上不准掉到毛氈（計畫改動 7b，dev app 三種字級另量）。這裡量木柄平常與 hover 的色
 */
const ERASER_HANDLES = ['--eraser-handle', '--eraser-handle-hover']

/** 健康度長條段內的名稱畫在 outcome 色上（裁決 21） */
const OUTCOME_CHART_TOKENS = Object.keys(ROOT).filter(name => name.startsWith('--chart-outcome-'))
/**
 * 圖形色（裁決 17）：:root 的每個 --chart-*（chartColorTokens.test.ts 鎖住黑板區塊跟 :root 同一組），加上泡泡左緣的熱度條
 * （--color-heat-*；畫出來是 color-mix 的濃淡，這裡量的是最濃那一格）
 */
const CHART_TOKENS = Object.keys(ROOT).filter(name => name.startsWith('--chart-'))
/** 畫的是底色：圓餅片與片之間的縫、hover 圓點外圈（把點跟線隔開）。不是圖形，不量對比；黑板上要是板面色 */
const GAP_TOKENS = ['--chart-slice-gap', '--chart-dot-ring']
const GRAPHIC_TOKENS = [...CHART_TOKENS.filter(name => !GAP_TOKENS.includes(name)), '--color-heat-positive', '--color-heat-negative']
const CHART_MIN_ON_BOARD = 3.5
const CHART_MIN_ON_SMUDGE = 3.0
/** 兩個色條要分得開的距離（RGB 歐氏距離；實畫面的色條像素檢查用同一個門檻分辨熱度條與已捨棄條） */
const COLOR_BARS_MIN_DISTANCE = 40

/** 黑板生效的 token；ThemeId 還沒有黑板時是斷言失敗（不是 TypeError） */
function boardTokens(): Record<string, string> {
  expect(THEMES.board, 'ThemeId 還沒有黑板（board）').toBeDefined()
  return THEMES.board
}

describe('黑板的對比', () => {
  it('底色表涵蓋每個用途 token；表裡的底都指得到 token 或另一個底', () => {
    expect(Object.keys(BOARD_USAGE_SURFACES).sort()).toEqual([...USAGE_TOKENS].sort())
    expect(OUTCOME_CHART_TOKENS).toHaveLength(5)
    expect(CHART_TOKENS.length).toBeGreaterThan(OUTCOME_CHART_TOKENS.length)
    expect(GRAPHIC_TOKENS.every(name => name in ROOT), '熱度色在 :root 要有定義').toBe(true)
    expect(GAP_TOKENS.filter(name => !CHART_TOKENS.includes(name)), '排除的縫要是 :root 現有的圖表 token').toEqual([])
    // 擦痕最亮處 = 粉筆白 5.5% 疊板面：拿 spike 的值算，要是母計畫量到的 #214A36（巢狀的淡底也照這個算法）
    const spike = { '--color-bg': '#15402C', '--color-text': '#F2F0E7', '--color-bg-sidebar': '#0E3221' }
    expect(resolveSurface(spike, SMUDGE).color.map(Math.round)).toEqual([0x21, 0x4a, 0x36, 1])
    const nested = resolveSurface(spike, tinted('#14b8a6', 0.38, [tinted('--color-text', 0.05, ['--color-bg-sidebar'])[0]])[0])
    expect(nested.label).toBe('#14b8a6 38% over --color-text 5% over --color-bg-sidebar')
    // 先疊裡層（粉筆白 5% 疊側欄）再疊外層；順序反過來是 [28, 108, 91]
    expect(nested.color.map(Math.round)).toEqual([23, 107, 90, 1])
  })

  /**
   * 連結（2026-11-05 完成條件 1）：renderer 沒有任何 CSS 給 <a> 上色，主題設了 color-scheme: dark 時 Chromium 給深色配色的預設連結色
   * #9E9EFF —— 黑板板面 4.88、擦痕最亮處 4.19、搜尋跳轉閃色起點（accent-light）3.65。字色 token 的掃描抓不到（沒有 color: 宣告）。
   * 所以：這種主題要在 global.css 寫 `[data-theme="x"] a { color: var(--…) }`，而且那個 token 要在上面的字色對比清單裡。
   */
  it('設了 color-scheme: dark 的主題給連結明確的字色，而且那個色有對比測試', () => {
    const block = (id: string) => {
      const start = GLOBAL_CSS.indexOf(`[data-theme="${id}"] {`)
      return start === -1 ? '' : GLOBAL_CSS.slice(start, GLOBAL_CSS.indexOf('\n}', start))
    }
    const dark = THEME_IDS.filter(id => /(?<![-\w])color-scheme\s*:\s*dark\b/.test(block(id)))
    expect(dark, '黑板設了 color-scheme: dark').toContain('board')
    for (const id of dark) {
      const rule = GLOBAL_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
        .match(new RegExp(`\\[data-theme="${id}"\\]\\s+a\\s*\\{[^}]*?(?<![-\\w])color\\s*:\\s*var\\(\\s*(--[\\w-]+)`))
      expect(rule, `global.css 沒有 [data-theme="${id}"] a { color: var(--…) }`).not.toBeNull()
      expect(BOARD_TEXT_TOKENS, `${id} 的連結色 ${rule?.[1]} 不在有對比測試的字色清單裡`).toContain(rule?.[1])
    }
  })

  it.each(BOARD_TEXT_TOKENS)('黑板 %s 在每種會出現的底上都至少 4.5:1（含擦痕最亮處）', name => {
    const b = boardTokens()
    expect(b[name], `黑板沒有 ${name}`).toBeDefined()
    const low = lowContrast(b[name], BOARD_TEXT_SURFACES.map(s => resolveSurface(b, s)))
    expect(low, `黑板 ${name}（${b[name]}）對比不足：\n${low.join('\n')}`).toEqual([])
  })

  it.each(USAGE_TOKENS)('黑板 %s 在它所有出現處的底上都至少 4.5:1', name => {
    const b = boardTokens()
    expect(OWN.board[name], `黑板的區塊沒有明寫 ${name}`).toBeDefined()
    const low = lowContrast(b[name], BOARD_USAGE_SURFACES[name].map(s => resolveSurface(b, s)))
    expect(low, `黑板 ${name}（${b[name]}）對比不足：\n${low.join('\n')}`).toEqual([])
  })

  it.each(BADGE_BG_TOKENS)('黑板徽章字色在 %s 上至少 4.5:1', name => {
    const b = boardTokens()
    const low = lowContrast(b[BADGE_TEXT], [{ label: name, color: surface(b, name) }])
    expect(low, `黑板徽章（${b[BADGE_TEXT]} 配 ${b[name]}）對比不足：\n${low.join('\n')}`).toEqual([])
  })

  it('黑板木框上的字（--color-on-wood）在木框暗端、hover 與選中的鍵上都至少 4.5:1', () => {
    const b = boardTokens()
    expect(b['--color-on-wood'], '黑板沒有 --color-on-wood').toBeDefined()
    const low = lowContrast(b['--color-on-wood'], WOOD_SURFACES.map(s => resolveSurface(b, s)))
    expect(low, `黑板 --color-on-wood（${b['--color-on-wood']}）對比不足：\n${low.join('\n')}`).toEqual([])
  })

  it.each(ERASER_HANDLES)('黑板跳頂／跳底鍵的箭頭（--color-text）在板擦木柄 %s 上至少 4.5:1', name => {
    const b = boardTokens()
    expect(b[name], `黑板沒有 ${name}`).toBeDefined()
    const low = lowContrast(b['--color-text'], [{ label: name, color: surface(b, name) }])
    expect(low, `黑板跳頂鍵的箭頭（${b['--color-text']} 配 ${b[name]}）對比不足：\n${low.join('\n')}`).toEqual([])
  })

  it.each(OUTCOME_CHART_TOKENS)('黑板健康度段內的名稱（--color-segment-label-text）在 %s 上至少 4.5:1', name => {
    const b = boardTokens()
    expect(b['--color-segment-label-text'], '黑板沒有 --color-segment-label-text').toBeDefined()
    const low = lowContrast(b['--color-segment-label-text'], [{ label: name, color: over(tokenColor(b, name), tokenColor(b, '--color-bg')) }])
    expect(low, `黑板段內名稱（${b['--color-segment-label-text']}）對比不足：\n${low.join('\n')}`).toEqual([])
  })

  it.each(GAP_TOKENS)('黑板 %s 是板面色（卡片透明，縫要跟周圍一樣）', name => {
    const b = boardTokens()
    expect(tokenColor(b, name), `黑板 ${name}（${b[name]}）`).toEqual(tokenColor(b, '--color-bg'))
  })

  it('黑板熱度負值跟已捨棄分支的粉紅分得開（裁決 25：粉紅只留給已捨棄，熱度負值改粉筆橘）', () => {
    const b = boardTokens()
    const [r1, g1, b1] = tokenColor(b, '--color-heat-negative')
    const [r2, g2, b2] = tokenColor(b, '--chalk-pink')
    const distance = Math.hypot(r1 - r2, g1 - g2, b1 - b2)
    expect(distance, `--color-heat-negative（${b['--color-heat-negative']}）與 --chalk-pink（${b['--chalk-pink']}）距離 ${distance.toFixed(1)}`)
      .toBeGreaterThanOrEqual(COLOR_BARS_MIN_DISTANCE)
  })

  it.each(GRAPHIC_TOKENS)(`黑板 %s 對板面至少 ${CHART_MIN_ON_BOARD}:1、對擦痕最亮處至少 ${CHART_MIN_ON_SMUDGE}:1`, name => {
    const b = boardTokens()
    const board = tokenColor(b, '--color-bg')
    const smudge = resolveSurface(b, SMUDGE).color
    const color = tokenColor(b, name)
    const onBoard = contrast(over(color, board), board)
    const onSmudge = contrast(over(color, smudge), smudge)
    expect(onBoard, `黑板 ${name}（${b[name]}）對板面 ${onBoard.toFixed(2)}`).toBeGreaterThanOrEqual(CHART_MIN_ON_BOARD)
    expect(onSmudge, `黑板 ${name}（${b[name]}）對擦痕最亮處 ${onSmudge.toFixed(2)}`).toBeGreaterThanOrEqual(CHART_MIN_ON_SMUDGE)
  })
})
