import { describe, it, expect } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 字級跟著字級表走（佈景主題 A：字放大一級，「大」「特大」照比例放大，各主題共用）。
 * 11-01 PR 查核後：檔案室的對話角色標籤寫死 10px（v0.5.0 起），選「特大」也不變；app 量「沒有小於 12px 的字」
 * 只在時間線跑過，主題專屬的規則沒人看過。這裡守兩件事：
 * - 寫死的字級不能小於 12px（rem 以 16px 換算，0.75rem = 12px）：字級表最小的 --font-size-xs 就是 12px
 * - 主題專屬的規則（選擇器帶 data-theme）不能寫死字級：只換配色的主題不該讓字脫離字級表
 * 寫死但刻意不跟字級表的（字級鈕的三個 A、錯誤備援畫面的 rem）都 ≥ 12px，第一條擋不到它們，也不需要擋。
 * em 與 % 跟著父層，這裡不判。只看 CSS：.ts／.tsx 裡的 fontSize 是 recharts 的數字（刻度、提示框 12），另由 CHANGELOG 說明。
 */

const RENDERER_DIR = fileURLToPath(new URL('../../src/renderer', import.meta.url))
const DECL = /(?<![-\w])font-size\s*:\s*([^;}\n]+)/g
const FOLLOWS_SCALE = /var\(\s*--font-(size-[\w-]+|scale)\b/
const FIXED = /^(\d*\.?\d+)(px|rem)\b/
const MIN_PX = 12

interface Source {
  file: string
  text: string
}

interface FontSize {
  file: string
  line: number
  value: string
  selector: string
  px: number | null
  themeScoped: boolean
}

/** CSS 註解換成等長的空白（保留換行，行號不變） */
function stripCssComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
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

/** 不跟字級表走的 font-size（var(--font-size-*)／var(--font-scale) 以外的值）；px 欄位是 px／rem 換算成的 px，其他單位為 null */
export function fixedFontSizes(sources: Source[]): FontSize[] {
  const found: FontSize[] = []
  for (const { file, text } of sources) {
    if (!file.endsWith('.css')) continue
    const lines = stripCssComments(text).split('\n')
    lines.forEach((line, i) => {
      for (const m of line.matchAll(DECL)) {
        const value = m[1].trim()
        if (FOLLOWS_SCALE.test(value)) continue
        const selector = selectorOf(lines, i)
        const fixed = value.match(FIXED)
        const px = fixed ? Number(fixed[1]) * (fixed[2] === 'rem' ? 16 : 1) : null
        found.push({ file, line: i + 1, value, selector, px, themeScoped: /data-theme=/.test(selector) })
      }
    })
  }
  return found
}

async function collect(dir: string): Promise<Source[]> {
  const sources: Source[] = []
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.css')) continue
    const full = path.join(entry.parentPath, entry.name)
    sources.push({ file: path.relative(dir, full), text: await readFile(full, 'utf-8') })
  }
  return sources
}

const show = (f: FontSize) => `${f.file}:${f.line}  ${f.value}  ${f.selector}`

describe('字級跟著字級表走', () => {
  it('寫死的字級不小於 12px；主題專屬的規則不寫死字級', async () => {
    const found = fixedFontSizes(await collect(RENDERER_DIR))
    // 掃描壞了的話「沒有發現」會空著通過：字級鈕的三個 A 是刻意寫死的 12／15／18px，先確認掃得到
    const switcher = found.filter(f => f.file === path.join('components', 'FontScaleSwitcher', 'FontScaleSwitcher.module.css'))
    expect(switcher.map(f => f.px), '掃描壞了：字級鈕的三個 A 應該掃得到').toEqual([12, 15, 18])

    const small = found.filter(f => f.px !== null && f.px < MIN_PX)
    expect(small.map(show), `小於 ${MIN_PX}px 的寫死字級：\n${small.map(show).join('\n')}`).toEqual([])
    const themed = found.filter(f => f.themeScoped)
    expect(themed.map(show), `主題專屬規則寫死了字級：\n${themed.map(show).join('\n')}`).toEqual([])
  })

  it('掃描：var(--font-size-*) 與 var(--font-scale) 不算寫死；px 與 rem 換算成 px；註解不算；主題規則認得出來', () => {
    const found = fixedFontSizes([
      { file: 'a.module.css', text: '.a {\n  font-size: 10px;\n}\n.b { font-size: var(--font-size-xs) }\n.c { font-size: calc(10px * var(--font-scale)) }' },
      { file: 'b.module.css', text: '/* font-size: 9px */\n.d { font-size: 0.7rem; }\n.e { font-size: 1.2em }' },
      { file: 'c.module.css', text: ':global([data-theme="x"]) .f,\n.g {\n  font-size: 14px;\n}' },
      { file: 'D.tsx', text: '<p style={{ fontSize: 9 }} />' },
    ])
    expect(found.map(f => `${f.file}:${f.line} ${f.value} px=${f.px} theme=${f.themeScoped}`)).toEqual([
      'a.module.css:2 10px px=10 theme=false',
      'b.module.css:2 0.7rem px=11.2 theme=false',
      'b.module.css:3 1.2em px=null theme=false',
      'c.module.css:3 14px px=14 theme=true',
    ])
  })
})
