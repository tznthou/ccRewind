import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 打包進 app 的字型都是 SIL Open Font License 1.1:
 * - 條款 2: 每份拷貝都附版權聲明與授權全文 → `licenses/` 每個字體一份 OFL 原檔, 由 electron-builder 的
 *   extraResources 放進 app(打包產物由 scripts/check-packaged-font-licenses.sh 在 electron-smoke 驗)。
 * - 條款 3: 修改版不能用保留字型名稱(RFN) → 有 RFN 的字體只放著作權人發布的原檔。
 *
 * `licenses/fonts.json` 是唯一的清單, 這裡把字型檔、fonts.css、授權檔、檔案雜湊都跟它對。
 * 換字型檔一定得改清單裡的雜湊, 清單記的來源與修改紀錄才不會跟檔案脫節。
 * 但來源與「沒修改」是人寫進清單的, 測試驗不了真假, 要在審 PR 時看。
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

/** 授權檔原樣保存(IBM 的是 CRLF), 比對前統一成 LF */
function readLicense(name: string): string | null {
  const p = path.join(LICENSE_DIR, name)
  return existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : null
}

/** OFL 標題以前的部分 = 版權聲明(可能不只一行, 保留字型名稱就寫在這裡) */
function noticeOf(text: string): string {
  const i = text.indexOf('SIL OPEN FONT LICENSE Version 1.1')
  return i < 0 ? text : text.slice(0, i)
}

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim()

// OFL 1.1 全文的固定段落。各家 OFL.txt 只在版權行、換行位置與行尾空白上不同 → 壓縮空白後逐字比。
const OFL_PASSAGES = [
  'SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007',
  'PREAMBLE The goals of the Open Font License (OFL) are to stimulate worldwide development of collaborative font projects',
  '"Reserved Font Name" refers to any names specified as such after the copyright statement(s).',
  '"Modified Version" refers to any derivative made by adding to, deleting, or substituting -- in part or in whole -- any of the components of the Original Version, by changing formats or by porting the Font Software to a new environment.',
  'PERMISSION & CONDITIONS Permission is hereby granted, free of charge, to any person obtaining a copy of the Font Software',
  '1) Neither the Font Software nor any of its individual components, in Original or Modified Versions, may be sold by itself.',
  '2) Original or Modified Versions of the Font Software may be bundled, redistributed and/or sold with any software, provided that each copy contains the above copyright notice and this license.',
  '3) No Modified Version of the Font Software may use the Reserved Font Name(s) unless explicit written permission is granted by the corresponding Copyright Holder.',
  '4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font Software shall not be used to promote, endorse or advertise any Modified Version',
  '5) The Font Software, modified or unmodified, in part or in whole, must be distributed entirely under this license, and must not be distributed under any other license.',
  'TERMINATION This license becomes null and void if any of the above conditions are not met.',
  'DISCLAIMER THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND',
]

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
    const onDisk = readdirSync(LICENSE_DIR).filter(f => !NOT_LICENSES.has(f)).sort()
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
      const body = squash(text)
      for (const p of OFL_PASSAGES) if (!body.includes(p)) problems.push(`${e.file}: ${e.license} 缺「${p.slice(0, 40)}…」`)
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
      const notice = noticeOf(readLicense(e.license) ?? '')
      if (/Reserved Font Names?/.test(notice) && e.reservedFontName === null)
        problems.push(`${e.file}: ${e.license} 有保留字型名稱, 清單沒登記`)
      if (e.reservedFontName !== null && !notice.includes(`"${e.reservedFontName}"`))
        problems.push(`${e.file}: ${e.license} 的版權聲明裡沒有 "${e.reservedFontName}"`)
      if (e.reservedFontName !== null && e.modified !== false)
        problems.push(`${e.file}: 有保留字型名稱卻登記成修改版(要放著作權人發布的原檔, 或改名)`)
    }
    expect(problems).toEqual([])
  })
})
