import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import MarkdownRenderer from '../../src/renderer/components/ChatView/MarkdownRenderer'

/**
 * MarkdownRenderer 是 MessageBubble 與 ThinkingBlock 畫訊息內文的元件; 這裡在 node 裡用 renderToStaticMarkup 看它的輸出。
 * react-markdown、remark-gfm、rehype-sanitize、rehype-highlight、highlight.js 都在 Renovate 的 patch 自動合併白名單裡,
 * 2026-11-02 盤點時 CI 沒有任何測試跑到它們。
 */
function render(content: string, searchQuery?: string): string {
  return renderToStaticMarkup(createElement(MarkdownRenderer, { content, searchQuery }))
}

/** 輸出裡真正的元素標籤。React 把文字裡的 `<` 跳脫成 `&lt;`, 所以字面上的 `<x …>` 一定是元素, 跳脫成文字的 HTML 不會算進來 */
function tagsOf(html: string): string[] {
  return html.match(/<[a-z][^>]*>/gi) ?? []
}

/** 有搜尋詞時元件換另一組 rehype plugin(sanitize 與 highlight 中間多一個 search highlight), 兩條路徑都要看 */
const QUERIES: (string | undefined)[] = [undefined, 'x']
const label = (query: string | undefined) => (query ? '(有搜尋詞)' : '')

describe('MarkdownRenderer: 惡意輸入畫不出可執行的東西', () => {
  // 這組看的是整條管線的結果, 不是某一層: 原始 HTML 在 react-markdown 預設就不會變成元素(app 的 rehype-sanitize 再把它刪掉),
  // on* 字串屬性 React 本身也不會畫出來, 網址由 react-markdown 的 urlTransform 與 rehype-sanitize 兩層清。
  // 所以只拿掉其中一層, 這組不一定會紅(2026-11-02 突變: 只拿掉 sanitize 全綠; 再把 urlTransform 換成原樣放行, 網址那 12 條紅);
  // rehype-sanitize 還在不在, 由下一組守。
  const inputs: Record<string, string> = {
    'script 標籤': 'a <script>alert(1)</script> b',
    'img 的 onerror': 'x <img src="x" onerror="alert(1)"> y',
    'b 的 onclick': 'before <b onclick="alert(1)">x</b> after',
    'svg 的 onload': '<svg onload="alert(1)"></svg>',
    'javascript: 連結': '[click](javascript:alert(1))',
    '大小寫混寫的 javascript: 連結': '[click](JaVaScRiPt:alert(1))',
    'javascript: autolink': '<javascript:alert(1)>',
    'vbscript: 連結': '[click](vbscript:msgbox(1))',
    'data: 連結': '[click](data:text/html;base64,PHNjcmlwdD4=)',
    'data: 圖片': '![a](data:text/html;base64,PHNjcmlwdD4=)',
  }
  for (const query of QUERIES) {
    for (const [name, md] of Object.entries(inputs)) {
      it(`${name}${label(query)}: 沒有 script 元素、沒有 on* 屬性、href / src 沒有 javascript: / vbscript: / data:`, () => {
        const tags = tagsOf(render(md, query))
        expect(tags.filter(t => /^<script\b/i.test(t))).toEqual([])
        expect(tags.filter(t => /\son[a-z]+\s*=/i.test(t))).toEqual([])
        const urls = tags.flatMap(t => [...t.matchAll(/\s(?:href|src)="([^"]*)"/gi)].map(m => m[1]))
        expect(urls.filter(u => /^\s*(?:javascript|vbscript|data):/i.test(u))).toEqual([])
      })
    }
  }
})

describe('MarkdownRenderer: rehype-sanitize 在兩組 plugin 裡都在', () => {
  // 只有 rehype-sanitize 會把 javascript: 連結的 href 整個拿掉; 少了它, react-markdown 的 urlTransform 只會清成 href=""
  // (2026-11-02 實測)。這條守的是 sanitize 還在管線上, 不是說 href="" 不安全。
  for (const query of QUERIES) {
    it(`javascript: 連結沒有 href 屬性${label(query)}`, () => {
      const anchors = tagsOf(render('[click](javascript:alert(1))', query)).filter(t => /^<a\b/i.test(t))
      expect(anchors).toEqual(['<a>'])
    })
  }
})

describe('MarkdownRenderer: GFM 表格', () => {
  it('pipe table 的表頭列進 thead / th, 內容列進 tbody / td', () => {
    expect(render('| a | b |\n|---|---|\n| 1 | 2 |')).toContain(
      '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    )
  })
})

describe('MarkdownRenderer: 程式碼上色', () => {
  // rehype-sanitize 要排在 rehype-highlight 前面, 反過來 sanitize 會把 highlight 加的 class 剝掉
  for (const query of QUERIES) {
    it(`有語言的程式碼區塊帶 highlight.js 的 class${label(query)}`, () => {
      const html = render('```js\nconst y = 1\n```', query)
      expect(html).toContain('<code class="hljs language-js">')
      expect(html).toContain('<span class="hljs-keyword">const</span>')
    })
  }
})
