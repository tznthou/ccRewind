import { describe, it, expect } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * renderer 不用 data: 圖（黑板計畫 PR2 改動 5）。兩處 CSP（src/renderer/index.html 的 meta、dev 的 src/main/index.ts）都沒有
 * img-src，退回 default-src 'self' → data: 圖被擋、畫不出來，也不報錯：spike 的選中 session 黃圈就是這樣（background 簡寫還把
 * 底色清成透明，選中列整個沒有記號；Phase 0 的像素檢查量到選中列 0 個記號色像素）。CSP 不放行，寫了就是畫不出來 → 一律不准。
 *
 * 抓兩種寫法，引號與空白都容許：CSS 或樣式字串的 url(data:…)（spike 原文是帶引號的 url("data:…"，只比對字面 url(data: 會漏），
 * JSX 的 src="data:…"、src='data:…'、src={`data:…`}。CSS 的註解先剝掉；.ts／.tsx 整行看（註解裡寫 url(data: 也會紅，改寫說法）。
 * 不改成「存成 SVG 檔再引用」：Vite 會把小檔內嵌回 data: URI，一樣被擋。
 */

const RENDERER_DIR = fileURLToPath(new URL('../../src/renderer', import.meta.url))
const URL_DATA = /url\(\s*['"]?\s*data:/i
const SRC_DATA = /\bsrc\s*=\s*\{?\s*['"`]\s*data:/i

interface Source {
  file: string
  text: string
}

interface Ref {
  at: string
  text: string
}

function dataImageRefs(sources: Source[]): Ref[] {
  const found: Ref[] = []
  for (const { file, text } of sources) {
    const code = file.endsWith('.css') ? text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')) : text
    code.split('\n').forEach((line, i) => {
      if (URL_DATA.test(line) || SRC_DATA.test(line)) found.push({ at: `${file}:${i + 1}`, text: line.trim().slice(0, 80) })
    })
  }
  return found
}

const at = (refs: Ref[]) => refs.map(r => r.at)

async function collect(): Promise<Source[]> {
  const sources: Source[] = []
  for (const entry of await readdir(RENDERER_DIR, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !/\.(css|tsx?)$/.test(entry.name) || entry.name.includes('.test.')) continue
    const full = path.join(entry.parentPath, entry.name)
    sources.push({ file: path.relative(RENDERER_DIR, full), text: await readFile(full, 'utf-8') })
  }
  return sources
}

describe('renderer 不用 data: 圖', () => {
  it('css／ts／tsx 都沒有 url(data:…) 或 src="data:…"', async () => {
    const sources = await collect()
    // 路徑錯或沒掃到檔案時，「沒有發現」會空著通過：先確認 CSS 與 TSX 都掃到了
    expect(sources.map(s => s.file)).toEqual(expect.arrayContaining([
      path.join('components', 'Sidebar', 'Sidebar.module.css'),
      path.join('components', 'Sidebar', 'SessionList.tsx'),
    ]))
    const found = dataImageRefs(sources)
    expect(at(found), `CSP 沒有 img-src，data: 圖畫不出來：\n${found.map(r => `${r.at}  ${r.text}`).join('\n')}`).toEqual([])
  })

  it('抓得到 spike 的原文與各種引號、空白、JSX 寫法；一般網址、相對路徑、變數與註解不算', () => {
    expect(at(dataImageRefs([
      // spike/board-theme-pages:src/renderer/components/Sidebar/Sidebar.module.css:546 的開頭（原文帶引號）
      { file: 'a.module.css', text: `.x {\n  background: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 100'>") no-repeat;\n}` },
      { file: 'b.module.css', text: ".y { background-image: url( 'data:image/png;base64,AAAA' ); }\n.z { background: url(DATA:image/gif;base64,R0lG); }" },
      { file: 'C.tsx', text: '<img src="data:image/png;base64,AAAA" />\n<img src=\'data:image/png;base64,AAAA\' />\n<img src={`data:image/svg+xml,${svg}`} />' },
      { file: 'D.tsx', text: "<i style={{ background: 'url(\"data:image/svg+xml,x\")' }} />" },
    ]))).toEqual(['a.module.css:2', 'b.module.css:1', 'b.module.css:2', 'C.tsx:1', 'C.tsx:2', 'C.tsx:3', 'D.tsx:1'])
    expect(at(dataImageRefs([
      { file: 'e.module.css', text: '.a { background: url(./chalk.svg); }\n.b { background: url(https://example.com/data:x); }\n/* url(data:image/png;base64,AAAA) */' },
      { file: 'F.tsx', text: "<img src={dataUrl} />\nconst s = 'data:'\n<img src=\"./a.png\" />" },
    ]))).toEqual([])
  })
})
