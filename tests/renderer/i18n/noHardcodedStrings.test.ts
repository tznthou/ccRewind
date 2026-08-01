import { describe, it, expect } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * i18n 收口機制。
 *
 * `satisfies MessageCatalog` 只抓得到「catalog 之間 key 漂移」，抓不到
 * 「根本沒進 catalog 的字串」—— 專門做了兩版 i18n 收尾（v1.12.0 / v1.12.1）
 * 仍漏掉對話氣泡的 'User' / 'Assistant' 和排序列的 'Time' / 'Tokens'，
 * 就是因為缺這一層。
 *
 * 掃 renderer 的 .tsx 找三種形態：
 *   1. JSX 文字節點，含跨行的 `<button>\n  Time\n</button>`
 *   2. JSX expression 內的單引號字串：`{cond ? 'User' : 'Assistant'}`
 *   3. 面向使用者的字面屬性：`title="..."`、`aria-label="..."`
 *
 * 掃整份原始碼而非逐行：JSX 文字節點跨行是常態，逐行看永遠看不到它 ——
 * 這個掃描器的第一版就是這樣漏掉 SessionList 的三個字串還一路綠燈。
 *
 * 已知抓不到（正則不是 tokenizer，這裡不追求完備）：
 *   - 反引號 template literal 裡的文案
 *   - 從 .ts 模組匯入的字串常數
 *   - 含程式語法符號的片語（會被當成引號配錯的殘骸濾掉）
 * 它擋的是「順手寫死一個英文字」這個最常見的漏法，不是形式驗證。
 */

const RENDERER_DIR = fileURLToPath(new URL('../../../src/renderer', import.meta.url))

/** 不是文案的字串。每一條都要能說出為什麼，否則就是在放水。 */
const ALLOWED = new Set([
  // KeyboardEvent.key 值 —— DOM 規格常數，翻譯了就比對不到
  'Enter', 'Escape', 'Tab', 'Home', 'End', 'Backspace', 'Delete',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown',
  // 產品名，兩種語言都這樣寫
  'ccRewind',
])

// `(?<!=)` 讓 `=> void` 的箭頭不被當成 JSX 標籤結尾。不排除換行 —— 跨行文字節點正是重點
const JSX_TEXT = /(?<!=)>\s*([A-Za-z][^<>{}]{2,80}?)\s*</g
// 前面不接 `=` 或值的結尾字元，避免把屬性值的收尾引號當成字串開頭
const EXPR_STRING = /(?<![=\w}\])'"])'([^'\\\n]{2,80})'/g
// 直接寫死的使用者可見屬性
const PROP_LITERAL = /\b(?:title|aria-label|placeholder|alt|aria-description|aria-roledescription)\s*=\s*"([^"\n]{2,80})"/g

/** 這個字串看起來像給人看的文案嗎？ */
export function looksLikeProse(s: string): boolean {
  if (!/[A-Za-z]/.test(s)) return false
  if (/^[a-z0-9_$.\-/[\]:]+$/.test(s)) return false // i18n key / class / path / 小寫 type literal
  if (/^[A-Za-z]+([A-Z][a-z0-9]*)+$/.test(s)) return false // camelCase 識別字
  if (/^--/.test(s) || /\d(px|rem|em|%|vh|vw)\b/.test(s)) return false // CSS 值
  // 含程式語法符號 → 正則把兩個相鄰字面的引號配錯了，不是文案
  if (/[(){}[\]<>=;|]/.test(s)) return false
  if (/^[A-Z][a-zA-Z0-9]*$/.test(s)) return true // 首字母大寫的單字：User / Assistant
  return /\s/.test(s) && /[a-z]/.test(s) // 含空白的英文片語
}

/** 給開發者看的字串（console、throw）不必翻譯，也不該逼開發者為它們開 catalog key。 */
export function isDeveloperFacing(line: string): boolean {
  return /\bconsole\.(log|warn|error|info|debug)\b/.test(line) || /\bthrow new \w*Error\b/.test(line)
}

export interface Hit {
  line: number
  text: string
}

/** 掃一份 .tsx 原始碼。export 出來讓測試能直接餵 fixture 驗掃描器本身。 */
export function scanSource(src: string): Hit[] {
  const lines = src.split('\n')
  const hits: Hit[] = []

  const record = (matchIndex: number, whole: string, text: string) => {
    const clean = text.replace(/\s+/g, ' ').trim()
    if (!looksLikeProse(clean) || ALLOWED.has(clean)) return
    // 用「文字本身」的位置算行號，跨行節點才不會歸到開頭的 `>` 那一行
    const textIndex = matchIndex + Math.max(0, whole.indexOf(text))
    const line = src.slice(0, textIndex).split('\n').length
    const raw = lines[line - 1] ?? ''
    const trimmed = raw.trim()
    if (/^(import|export)\s/.test(trimmed) || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
    if (isDeveloperFacing(raw)) return
    hits.push({ line, text: clean })
  }

  for (const m of src.matchAll(JSX_TEXT)) record(m.index, m[0], m[1])
  for (const m of src.matchAll(EXPR_STRING)) record(m.index, m[0], m[1])
  for (const m of src.matchAll(PROP_LITERAL)) record(m.index, m[0], m[1])

  return hits
}

async function* walkTsx(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walkTsx(full)
    else if (entry.name.endsWith('.tsx')) yield full
  }
}

describe('i18n 硬編碼收口', () => {
  it('renderer 的 .tsx 不留面向使用者的英文字面字串', async () => {
    const found: string[] = []
    for await (const file of walkTsx(RENDERER_DIR)) {
      const src = await readFile(file, 'utf-8')
      for (const hit of scanSource(src)) {
        found.push(`  ${path.relative(RENDERER_DIR, file)}:${hit.line}  ${JSON.stringify(hit.text)}`)
      }
    }
    expect(found, `發現未走 t() 的字串。請補進 messages.ts 的兩份 catalog，\n若確定不是文案再加進本檔的 ALLOWED（附理由）：\n${found.join('\n')}`).toEqual([])
  })

  it('抓得到跨行的 JSX 文字節點', () => {
    // SessionList 的 Time / Tokens 長這樣，第一版逐行掃描完全看不到它們
    const src = [
      'export default function Sort() {',
      '  return (',
      '    <button onClick={() => setSortKey("time")}>',
      '      Time',
      '    </button>',
      '  )',
      '}',
    ].join('\n')
    const hits = scanSource(src)
    expect(hits).toEqual([{ line: 4, text: 'Time' }])
  })

  it('抓得到三元運算子裡的字串字面', () => {
    const src = '<span>{isUser ? \'User\' : \'Assistant\'}</span>'
    expect(scanSource(src).map(h => h.text).sort()).toEqual(['Assistant', 'User'])
  })

  it('抓得到寫死的使用者可見屬性', () => {
    const src = '<button title="Copy session id" aria-label={t(\'a.b\')}>x</button>'
    expect(scanSource(src).map(h => h.text)).toEqual(['Copy session id'])
  })

  it('不誤報識別字、樣式與開發者訊息', () => {
    const src = [
      "const cls = `${styles.option} ${isActive ? styles.optionActive : ''}`",
      "if (e.key === 'Enter') activate()",
      "console.warn('Update check failed:', err)",
      "throw new Error('useTheme must be used within ThemeProvider')",
      '<svg><rect x="1" y="2" width="10" height="20" /></svg>',
      "<span>{t('sidebar.sessionList.sort.time')}</span>",
      'const cb: () => void | Promise<void> = noop',
    ].join('\n')
    expect(scanSource(src)).toEqual([])
  })

  it('looksLikeProse 的分界', () => {
    expect(looksLikeProse('User')).toBe(true)
    expect(looksLikeProse('No projects')).toBe(true)
    expect(looksLikeProse('chatView.message.system')).toBe(false) // i18n key
    expect(looksLikeProse('optionActive')).toBe(false) // camelCase
    expect(looksLikeProse('--color-error')).toBe(false) // CSS variable
    expect(looksLikeProse('16px')).toBe(false) // CSS 值
    expect(looksLikeProse('user')).toBe(false) // 小寫 type literal
    expect(looksLikeProse(').filter(t => t !== ')).toBe(false) // 引號配錯的殘骸
  })
})
