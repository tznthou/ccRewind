import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 打包進 app 的字型都是 SIL Open Font License 1.1:
 * - 條款 2: 每份拷貝都附版權聲明與授權全文 → `licenses/` 每個字體一份 OFL 原檔, 由 electron-builder 的
 *   extraResources 放進 app。
 * - 條款 3: 修改版不能用保留字型名稱(RFN) → 有 RFN 的字體只放著作權人發布的原檔。
 *
 * `licenses/fonts.json` 是唯一的清單, 這裡把 src/ 的字型檔、fonts.css、授權檔、檔案雜湊都跟它對。
 * 換字型檔一定得改清單裡的雜湊, 清單記的來源與修改紀錄才不會跟檔案脫節。
 * 但來源與「沒修改」是人寫進清單的, 測試驗不了真假, 要在審 PR 時看; 授權檔的版權行也只跟清單比,
 * 沒跟字型檔自己的版權欄比。
 * 這裡只看得到 src/; 從別的路(npm 套件的 CSS、其他樣式表)進到建置結果的字型, 由 electron-smoke 在
 * `pnpm build` 之後跑 scripts/check-built-fonts.mjs 抓, 打包後的授權檔由 scripts/check-packaged-font-licenses.sh 比。
 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC_DIR = path.join(REPO_ROOT, 'src')
const FONT_DIR = path.join(SRC_DIR, 'renderer/assets/fonts')
const LICENSE_DIR = path.join(FONT_DIR, 'licenses')
const MANIFEST = path.join(LICENSE_DIR, 'fonts.json')
const FONT_FILE = /\.(woff2?|ttf|otf)$/i
const NOT_LICENSES = new Set(['fonts.json', 'README.md'])

interface FontEntry {
  file: string
  family: string
  license: string
  copyright: string
  reservedFontName: string | null
  modified: boolean
  sha256: string
}

function readManifest(): FontEntry[] {
  if (!existsSync(MANIFEST)) return []
  return (JSON.parse(readFileSync(MANIFEST, 'utf8')) as { fonts: FontEntry[] }).fonts
}

/** 授權檔原樣保存, 有的是 CRLF(以前打包的 IBM Plex 那份就是), 比對前統一成 LF */
function readLicense(name: string): string | null {
  const p = path.join(LICENSE_DIR, name)
  return existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : null
}

const OFL_HEADING = 'SIL OPEN FONT LICENSE Version 1.1'

/** OFL 標題以前的部分 = 版權聲明(可能不只一行, 保留字型名稱就寫在這裡) */
function noticeOf(text: string): string {
  const i = text.indexOf(OFL_HEADING)
  return i < 0 ? text : text.slice(0, i)
}

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim()

/**
 * 版權聲明裡宣告的保留字型名稱: 每個「Reserved Font Name」之後到句點為止的那段(可能是空字串)。
 * 不分大小寫、可以跨行、Name / Names / Name(s) 後面可以接冒號、引號不拘(SIL 範本不加引號、IBM 用 "Plex"、
 * Adobe 的 Source 系列寫成 `Reserved Font\nName 'Source'`), 一段聲明可以有好幾個。
 * 只要出現就回傳一段, 抽不出名稱也一樣: 有宣告就得登記(2026-11-03 盲審: 要求 Name 後面接空白的版本
 * 把 `Reserved Font Name: "X"` 整個漏掉)。
 */
function reservedNameClauses(notice: string): string[] {
  return notice
    .split(/\n\s*\n/)
    .flatMap(para =>
      [...squash(para).matchAll(/reserved font name(?:s|\(s\))?\s*:?\s*(.*?)(?:\.\s|\.?$)/gi)].map(m => m[1]),
    )
}

/**
 * OFL 1.1 本文(標題到結尾, 拿掉分隔線、壓縮空白)的 SHA-256。SIL 官方的 OFL.txt
 * (https://openfontlicense.org/documents/OFL.txt, 2026-11-03 抓)與每份打包的授權檔都是這個值。
 * 只檢查幾段文字的話, 砍掉一半的授權檔也會過(2026-11-03 審查實測)。
 */
const OFL_BODY_SHA256 = '70006bea3c19ca31505acc2ab97296f48cccbf972825a66d81321f1474e30ebf'

function oflBodySha256(text: string): string | null {
  const i = text.indexOf(OFL_HEADING)
  if (i < 0) return null
  return createHash('sha256')
    .update(squash(text.slice(i).replace(/[-=_*]{5,}/g, ' ')))
    .digest('hex')
}

const entries = readManifest()

describe('打包字型的授權', () => {
  it('清單存在且登記了字型', () => {
    expect(existsSync(MANIFEST)).toBe(true)
    expect(entries.length).toBeGreaterThan(0)
  })

  it('字型檔只放在字型資料夾, 而且跟清單一一對應', () => {
    const found = (readdirSync(SRC_DIR, { recursive: true }) as string[])
      .filter(f => FONT_FILE.test(f))
      .map(f => f.split(path.sep).join('/'))
      .sort()
    expect(found).toEqual(entries.map(e => `renderer/assets/fonts/${e.file}`).sort())
  })

  it('fonts.css 用到的字型檔跟清單一一對應', () => {
    const css = readFileSync(path.join(FONT_DIR, 'fonts.css'), 'utf8')
    const used = [...new Set([...css.matchAll(/url\(\s*['"]?\.\/([^'")\s]+)['"]?\s*\)/g)].map(m => m[1]))].sort()
    expect(used).toEqual(entries.map(e => e.file).sort())
  })

  it('授權檔跟清單引用的一一對應, 每份都是 OFL 1.1 全文、第一行是登記的版權行', () => {
    expect(entries.length).toBeGreaterThan(0)
    const problems: string[] = []
    // 點開頭的是系統檔(Finder 的 .DS_Store), 不進 git
    const onDisk = readdirSync(LICENSE_DIR)
      .filter(f => !f.startsWith('.') && !NOT_LICENSES.has(f))
      .sort()
    const referenced = [...new Set(entries.map(e => e.license))].sort()
    if (onDisk.join('\n') !== referenced.join('\n'))
      problems.push(`licenses/ 裡的授權檔 [${onDisk.join(', ')}] ≠ 清單引用的 [${referenced.join(', ')}]`)
    for (const e of entries) {
      const text = readLicense(e.license)
      if (text === null) {
        problems.push(`${e.file}: 找不到 ${e.license}`)
        continue
      }
      if (text.split('\n', 1)[0] !== e.copyright) problems.push(`${e.file}: ${e.license} 第一行不是登記的版權行`)
      const sha = oflBodySha256(text)
      if (sha !== OFL_BODY_SHA256) problems.push(`${e.file}: ${e.license} 的 OFL 1.1 本文跟標準不同(${sha ?? '找不到標題'})`)
    }
    expect(problems).toEqual([])
  })

  it('字型檔的 SHA-256 跟清單一致', () => {
    expect(entries.length).toBeGreaterThan(0)
    const problems: string[] = []
    for (const e of entries) {
      const p = path.join(FONT_DIR, e.file)
      if (!existsSync(p)) continue // 由「一一對應」那條報
      const got = createHash('sha256').update(readFileSync(p)).digest('hex')
      if (got !== e.sha256) problems.push(`${e.file}: ${got}`)
    }
    expect(problems).toEqual([])
  })

  it('保留字型名稱照授權檔登記, 有的話只能是原檔', () => {
    expect(entries.length).toBeGreaterThan(0)
    const problems: string[] = []
    for (const e of entries) {
      const clauses = reservedNameClauses(noticeOf(readLicense(e.license) ?? ''))
      if (clauses.length > 0 && e.reservedFontName === null)
        problems.push(`${e.file}: ${e.license} 有保留字型名稱(${clauses.join(' / ')}), 清單沒登記`)
      if (e.reservedFontName !== null && !clauses.some(c => c.includes(e.reservedFontName as string)))
        problems.push(`${e.file}: ${e.license} 宣告的保留字型名稱裡沒有 ${e.reservedFontName}`)
      if (e.reservedFontName !== null && e.modified !== false)
        problems.push(`${e.file}: 有保留字型名稱卻登記成修改版(要放著作權人發布的原檔, 或改名)`)
    }
    expect(problems).toEqual([])
  })
})
