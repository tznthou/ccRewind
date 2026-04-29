import { visitParents, SKIP } from 'unist-util-visit-parents'
import type { Plugin } from 'unified'
import type { Root, Element, ElementContent, Text, Parents } from 'hast'

interface Options {
  query?: string
}

const REGEX_ESCAPE = /[.*+?^${}()|[\]\\]/g

function isInsideFencedCode(ancestors: ReadonlyArray<Parents>): boolean {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const node = ancestors[i]
    if (node.type !== 'element' || node.tagName !== 'code') continue
    const parent = i > 0 ? ancestors[i - 1] : null
    if (parent && parent.type === 'element' && parent.tagName === 'pre') return true
  }
  return false
}

function splitTextNode(text: string, regex: RegExp): ElementContent[] {
  const out: ElementContent[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  regex.lastIndex = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }
    out.push({
      type: 'element',
      tagName: 'mark',
      properties: { dataSearchMatch: 'true' },
      children: [{ type: 'text', value: match[0] }],
    })
    lastIndex = match.index + match[0].length
    if (match.index === regex.lastIndex) regex.lastIndex++
  }
  if (out.length === 0) return []
  if (lastIndex < text.length) out.push({ type: 'text', value: text.slice(lastIndex) })
  return out
}

const rehypeSearchHighlight: Plugin<[Options?], Root> = (options = {}) => {
  const query = options.query
  if (!query) return
  const escaped = query.replace(REGEX_ESCAPE, '\\$&')
  const regex = new RegExp(escaped, 'gi')
  return (tree: Root) => {
    visitParents(tree, 'text', (node: Text, ancestors) => {
      if (isInsideFencedCode(ancestors)) return
      const replacement = splitTextNode(node.value, regex)
      if (replacement.length === 0) return
      const parent = ancestors[ancestors.length - 1] as Element | Root
      const idx = parent.children.indexOf(node as ElementContent)
      if (idx === -1) return
      parent.children.splice(idx, 1, ...replacement)
      return [SKIP, idx + replacement.length]
    })
  }
}

export default rehypeSearchHighlight
