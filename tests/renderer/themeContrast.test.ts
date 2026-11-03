import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/**
 * 主題顏色的對比（WCAG AA：一般大小的字 4.5:1）。
 *
 * 錯誤色（--color-error）的字在每個主題、每種會出現的底色上都要讀得清楚：timeline 原本的 #dc3545 只有 4.07–4.37。
 * 底色取錯誤色的字實際出現的地方：對話區的錯誤（--color-bg）、側欄（--color-bg-sidebar）、錯誤畫面的說明框（--color-bubble-system），
 * 以及泡泡上的「已捨棄分支」徽章（--color-bubble-user／-assistant；徽章沒有自己的底）。
 * 主題只寫跟 :root 不同的 token，其餘沿用 :root；半透明的底色疊在該主題的 --color-bg 上算，半透明的字色再疊在那個底色上算。
 *
 * 主題清單取自 ThemeContext.tsx 的 ThemeId：app 選得到的主題都會檢查。timeline 是 :root；其他主題缺 CSS 區塊時直接報錯，
 * 不會被略過。只讀每個主題的第一個 `[data-theme="x"] {` 區塊，@media 裡或之後重複的覆寫不算。
 *
 * 佈景主題 A（時間線字級與對比調整）：
 * - 已捨棄分支的泡泡不再整個淡化成 opacity 0.7（以前徽章與內文跟泡泡底一起疊在頁面底色上，實際約 3:1），
 *   內文改用次要字，所以徽章就是畫在不透明泡泡上的錯誤色、內文就是下面的「時間線灰字」。
 * - 寫死的字色收進 token：時間線給新值，檔案室與終端機寫現況值（裁決 5：舊主題不調色），每個主題的區塊都要明寫，
 *   缺了不會報錯、只會沿用 :root 的時間線值 —— 也就是舊主題悄悄變色。
 * - 用途 token 與徽章的對比只檢查時間線：舊主題照現況，本來就不到 4.5（例如 outcome 標籤 2.3–3.7）。
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8')
const GLOBAL_CSS = read('../../src/renderer/styles/global.css')
const THEME_CONTEXT = read('../../src/renderer/context/ThemeContext.tsx')
const SURFACES = ['--color-bg', '--color-bg-sidebar', '--color-bubble-system', '--color-bubble-user', '--color-bubble-assistant']
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
const OLD_THEMES = THEME_IDS.filter(id => id !== 'timeline')

/** 某主題的一個底色 token，半透明的話疊在該主題的 --color-bg 上 */
function surface(t: Record<string, string>, token: string): Rgba {
  const value = t[token]
  if (value === undefined) throw new Error(`沒有 ${token}`)
  return over(parseColor(value), parseColor(t['--color-bg']))
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
    expect(themeIds("export type ThemeId = 'a' | 'b'")).toEqual(['a', 'b'])
    expect(Object.keys(THEMES)).toEqual(expect.arrayContaining(['timeline', 'archive', 'terminal']))
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
 * 用途 token：原本寫死在元件 CSS 的字色（裁決 7），按用途命名 —— 同色系在不同地方有不同 hex，合併的話舊主題會變色。
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

/**
 * 舊主題的值 = 改版前元件 CSS 寫死的那個色（裁決 5）。兩個原本是 token、各主題不同的另外比：unknown 徽章原本是
 * var(--color-text-muted) → 各主題自己的灰字；「已複製」原本是 var(--color-heat-positive) → 各主題自己的 heat 綠
 */
const OLD_THEME_VALUES: Record<string, string> = {
  '--color-outcome-committed-text': '#16a34a',
  '--color-outcome-tested-text': '#2563eb',
  '--color-outcome-in-progress-text': '#d97706',
  '--color-outcome-quick-qa-text': '#7c3aed',
  '--color-remote-text': '#0f766e',
  '--color-op-edit-text': '#d97706',
  '--color-op-write-text': '#16a34a',
  '--color-op-read-text': '#2563eb',
  '--color-op-discovery-text': '#7c3aed',
  '--color-jaccard-text': '#3b82f6',
  '--color-task-in-progress-text': '#f59e0b',
  '--color-task-completed-text': '#10b981',
  '--color-subagent-text': '#8b5cf6',
  '--color-health-up-text': '#22c55e',
  '--color-health-down-text': '#ef4444',
  '--color-outcome-in-progress-badge-bg': '#f59e0b',
  '--color-outcome-quick-qa-badge-bg': '#06b6d4',
  '--color-outcome-badge-text': '#ffffff',
}
/** logo 跟主題變色（裁決 6）：圈與尾巴 / 三角，值取自比較頁 */
const LOGO_VALUES: Record<string, [string, string]> = {
  timeline: ['#0891b2', '#1e293b'],
  archive: ['#b8860b', '#2c2417'],
  terminal: ['#22d3ee', '#fbbf24'],
}

/**
 * 時間線用途 token 實際的底：容器 token，加上元件自己疊的淡底（基色 + 比例；color-mix(in srgb, X p%, transparent) = X 透明度 p）。
 * ⚠️ 元件 CSS 的淡底或容器改了要同步更新這張表；真實渲染以 dev app 的 contrast_audit 為準（計畫完成條件 1）。
 * 11-01 逐一讀元件 CSS 組出來，各 token 的現況最差值跟計畫表格的審查數字逐一相同（committed 2.33、遠端 3.34、task 1.62……）。
 */
interface Surface { container: string; tint?: { base: string; alpha: number } }
const tinted = (base: string, alpha: number, containers: string[]): Surface[] => containers.map(container => ({ container, tint: { base, alpha } }))
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
  const container = surface(t, s.container)
  if (!s.tint) return { label: s.container, color: container }
  // 基色可以是 hex，也可以是 token 名稱（取這個主題的值）
  const base = s.tint.base.startsWith('--') ? t[s.tint.base] : s.tint.base
  if (!base) throw new Error(`沒有 ${s.tint.base}`)
  const [r, g, b] = parseColor(base)
  return { label: `${s.tint.base} ${Math.round(s.tint.alpha * 100)}% over ${s.container}`, color: over([r, g, b, s.tint.alpha], container) }
}

describe('佈景主題 A：新增的 token', () => {
  it.each(THEME_IDS)('%s 的區塊明寫 A 新增的每個 token（沒寫會沿用 :root 的時間線值）', theme => {
    const missing = A_TOKENS.filter(name => !(name in OWN[theme]))
    expect(missing, `${theme} 缺：\n${missing.join('\n')}`).toEqual([])
  })

  it.each(OLD_THEMES)('%s 的用途 token 與徽章 token 等於改版前的寫死色（裁決 5：舊主題不調色）', theme => {
    const t = THEMES[theme]
    const expected = {
      ...OLD_THEME_VALUES,
      '--color-outcome-unknown-badge-bg': t['--color-text-muted'].toLowerCase(),
      '--color-copied-text': t['--color-heat-positive'].toLowerCase(),
    }
    const actual = Object.fromEntries(Object.keys(expected).map(name => [name, (t[name] ?? '(沒有)').toLowerCase()]))
    expect(actual).toEqual(expected)
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
