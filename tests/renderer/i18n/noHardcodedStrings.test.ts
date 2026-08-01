import { describe, it, expect } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * i18n 收口機制。
 *
 * `satisfies MessageCatalog` 只抓得到「catalog 之間 key 漂移」，抓不到
 * 「根本沒進 catalog 的字串」—— 專門做了兩版 i18n 收尾（v1.12.0 / v1.12.1）
 * 仍漏掉對話氣泡最顯眼的 'User' / 'Assistant'，就是因為缺這一層。
 *
 * 這裡掃 renderer 的 .tsx 找兩種形態：
 *   1. JSX text node：`<div>Some text</div>`
 *   2. JSX expression 內的單引號字串字面：`{cond ? 'User' : 'Assistant'}`
 *
 * 只掃單引號：專案的 JS 字面一律單引號，JSX 屬性一律雙引號，
 * 分開來可以避開「把 `x="1" y="2"` 的屬性邊界當成字串」這類誤判。
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

// `(?<!=)` 讓 `=> void` 的箭頭不被當成 JSX 標籤結尾
const JSX_TEXT = /(?<!=)>\s*([A-Za-z][^<>{}\n]{2,80}?)\s*</g
// 前面不接 `=` 或值的結尾字元，避免把屬性值的收尾引號當成字串開頭
const EXPR_STRING = /(?<![=\w}\])'"])'([^'\\\n]{2,80})'/g

/** 這個字串看起來像給人看的文案嗎？ */
function looksLikeProse(s: string): boolean {
  if (!/[A-Za-z]/.test(s)) return false
  if (/^[a-z0-9_$.\-/[\]:]+$/.test(s)) return false // i18n key / class / path / 小寫 type literal
  if (/^[A-Za-z]+([A-Z][a-z0-9]*)+$/.test(s)) return false // camelCase 識別字
  if (/^--/.test(s) || /\d(px|rem|em|%|vh|vw)\b/.test(s)) return false // CSS 值
  // 含程式語法符號 → 正則把兩個相鄰字面的引號配錯了，不是文案
  if (/[(){}[\]<>=;|]/.test(s)) return false
  if (/^[A-Z][a-zA-Z0-9]*$/.test(s)) return true // 首字母大寫的單字：User / Assistant
  return / /.test(s) && /[a-z]/.test(s) // 含空格的英文片語
}

/** 給開發者看的字串（console、throw）不必翻譯，也不該逼開發者為它們開 catalog key。 */
function isDeveloperFacing(line: string): boolean {
  return /\bconsole\.(log|warn|error|info|debug)\b/.test(line) || /\bthrow new \w*Error\b/.test(line)
}

async function* walkTsx(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walkTsx(full)
    else if (entry.name.endsWith('.tsx')) yield full
  }
}

interface Hit {
  location: string
  text: string
}

async function findHardcodedStrings(): Promise<Hit[]> {
  const hits: Hit[] = []
  for await (const file of walkTsx(RENDERER_DIR)) {
    const src = await readFile(file, 'utf-8')
    src.split('\n').forEach((line, i) => {
      const trimmed = line.trim()
      // import / 註解 / 開發者訊息不是 UI 文案來源
      if (/^(import|export)\s/.test(trimmed) || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
      if (isDeveloperFacing(line)) return

      const location = `${path.relative(RENDERER_DIR, file)}:${i + 1}`
      for (const m of line.matchAll(JSX_TEXT)) {
        const text = m[1].trim()
        if (looksLikeProse(text) && !ALLOWED.has(text)) hits.push({ location, text })
      }
      for (const m of line.matchAll(EXPR_STRING)) {
        const text = m[1]
        if (looksLikeProse(text) && !ALLOWED.has(text)) hits.push({ location, text })
      }
    })
  }
  return hits
}

describe('i18n 硬編碼收口', () => {
  it('renderer 的 .tsx 不留面向使用者的英文字面字串', async () => {
    const hits = await findHardcodedStrings()
    const report = hits.map(h => `  ${h.location}  ${JSON.stringify(h.text)}`).join('\n')
    expect(hits, `發現未走 t() 的字串。請補進 messages.ts 的兩份 catalog，\n若確定不是文案再加進本檔的 ALLOWED（附理由）：\n${report}`).toEqual([])
  })

  it('掃描器本身抓得到 User / Assistant 這種形態，否則這個閘門是空的', () => {
    // 這兩個字串曾經真的躺在 MessageBubble 裡沒被任何機制抓到
    expect(looksLikeProse('User')).toBe(true)
    expect(looksLikeProse('Assistant')).toBe(true)
    expect(looksLikeProse('No projects')).toBe(true)
    expect(looksLikeProse('Show more results')).toBe(true)
  })

  it('掃描器不把識別字當文案，否則沒人受得了這個閘門', () => {
    expect(looksLikeProse('chatView.message.system')).toBe(false) // i18n key
    expect(looksLikeProse('optionActive')).toBe(false) // camelCase
    expect(looksLikeProse('data-message-id')).toBe(false) // attribute
    expect(looksLikeProse('--color-error')).toBe(false) // CSS variable
    expect(looksLikeProse('16px')).toBe(false) // CSS 值
    expect(looksLikeProse('user')).toBe(false) // 小寫 type literal
    expect(looksLikeProse(').filter(t => t !== ')).toBe(false) // 引號配錯的殘骸
  })

  it('開發者訊息不進掃描範圍', () => {
    expect(isDeveloperFacing("    console.warn('Update check failed:', err)")).toBe(true)
    expect(isDeveloperFacing("  throw new Error('useTheme must be used within ThemeProvider')")).toBe(true)
    expect(isDeveloperFacing("  <span>{t('chatView.message.system')}</span>")).toBe(false)
  })
})
