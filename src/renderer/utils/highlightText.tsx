import type { ReactNode } from 'react'

const REGEX_ESCAPE = /[.*+?^${}()|[\]\\]/g

export function highlightText(text: string, query: string): ReactNode {
  if (!query) return text
  const escaped = query.replace(REGEX_ESCAPE, '\\$&')
  const regex = new RegExp(escaped, 'gi')
  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    parts.push(
      <mark key={key++} data-search-match="true">
        {match[0]}
      </mark>,
    )
    lastIndex = match.index + match[0].length
    if (match.index === regex.lastIndex) regex.lastIndex++
  }
  if (parts.length === 0) return text
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}
