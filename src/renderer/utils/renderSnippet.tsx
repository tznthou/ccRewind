import type { ReactNode } from 'react'

/** FTS5 snippet 使用 Unicode sentinel \uE000/\uE001 標記匹配位置，轉為 React <mark> 元素 */
export function renderSnippet(snippet: string): ReactNode {
  const parts = snippet.split(/(\uE000.*?\uE001)/g)
  return parts.map((part, i) => {
    if (part.startsWith('\uE000') && part.endsWith('\uE001')) {
      return <mark key={i}>{part.slice(1, -1)}</mark>
    }
    return part
  })
}
