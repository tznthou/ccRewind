import { describe, it, expect } from 'vitest'
import type { Root, Element, ElementContent } from 'hast'
import rehypeSearchHighlight from '../../src/renderer/utils/rehypeSearchHighlight'

type PluginTransform = (tree: Root) => void

function applyPlugin(tree: Root, query?: string): Root {
  const transform = (rehypeSearchHighlight({ query }) as PluginTransform | undefined)
  if (transform) transform(tree)
  return tree
}

function paragraph(...children: ElementContent[]): Element {
  return { type: 'element', tagName: 'p', properties: {}, children }
}

function inlineCode(text: string): Element {
  return { type: 'element', tagName: 'code', properties: {}, children: [{ type: 'text', value: text }] }
}

function fencedCode(text: string, lang = 'ts'): Element {
  return {
    type: 'element',
    tagName: 'pre',
    properties: {},
    children: [
      {
        type: 'element',
        tagName: 'code',
        properties: { className: [`language-${lang}`] },
        children: [{ type: 'text', value: text }],
      },
    ],
  }
}

function isMark(node: ElementContent): node is Element {
  return node.type === 'element' && node.tagName === 'mark'
}

describe('rehypeSearchHighlight', () => {
  it('returns no-op when query is empty', () => {
    const tree: Root = { type: 'root', children: [paragraph({ type: 'text', value: 'hello foo world' })] }
    const after = applyPlugin(tree, '')
    const para = after.children[0] as Element
    expect(para.children).toHaveLength(1)
    expect(para.children[0]).toEqual({ type: 'text', value: 'hello foo world' })
  })

  it('returns no-op when query is undefined', () => {
    const tree: Root = { type: 'root', children: [paragraph({ type: 'text', value: 'hello foo world' })] }
    const after = applyPlugin(tree, undefined)
    const para = after.children[0] as Element
    expect(para.children[0]).toEqual({ type: 'text', value: 'hello foo world' })
  })

  it('wraps a single match in <mark> with data-search-match', () => {
    const tree: Root = { type: 'root', children: [paragraph({ type: 'text', value: 'hello foo world' })] }
    const after = applyPlugin(tree, 'foo')
    const para = after.children[0] as Element
    expect(para.children).toHaveLength(3)
    expect(para.children[0]).toEqual({ type: 'text', value: 'hello ' })
    const mark = para.children[1]
    expect(isMark(mark)).toBe(true)
    expect((mark as Element).tagName).toBe('mark')
    expect((mark as Element).properties).toMatchObject({ dataSearchMatch: 'true' })
    expect((mark as Element).children[0]).toEqual({ type: 'text', value: 'foo' })
    expect(para.children[2]).toEqual({ type: 'text', value: ' world' })
  })

  it('wraps multiple matches across paragraphs', () => {
    const tree: Root = {
      type: 'root',
      children: [
        paragraph({ type: 'text', value: 'foo bar' }),
        paragraph({ type: 'text', value: 'baz foo' }),
      ],
    }
    const after = applyPlugin(tree, 'foo')
    const p1 = after.children[0] as Element
    const p2 = after.children[1] as Element
    expect(isMark(p1.children[0])).toBe(true)
    expect((p1.children[0] as Element).children[0]).toEqual({ type: 'text', value: 'foo' })
    expect(isMark(p2.children[1])).toBe(true)
  })

  it('highlights inside inline code (not fenced)', () => {
    const tree: Root = {
      type: 'root',
      children: [paragraph({ type: 'text', value: 'see ' }, inlineCode('myFunc'), { type: 'text', value: ' here' })],
    }
    const after = applyPlugin(tree, 'myFunc')
    const para = after.children[0] as Element
    const code = para.children[1] as Element
    expect(code.tagName).toBe('code')
    expect(code.children).toHaveLength(1)
    expect(isMark(code.children[0] as ElementContent)).toBe(true)
    expect(((code.children[0] as Element).children[0] as { value: string }).value).toBe('myFunc')
  })

  it('does NOT highlight inside fenced code block', () => {
    const tree: Root = {
      type: 'root',
      children: [fencedCode('const myFunc = () => 1')],
    }
    const after = applyPlugin(tree, 'myFunc')
    const pre = after.children[0] as Element
    const code = pre.children[0] as Element
    expect(code.children).toHaveLength(1)
    expect(code.children[0]).toEqual({ type: 'text', value: 'const myFunc = () => 1' })
  })

  it('handles match at start of text node', () => {
    const tree: Root = { type: 'root', children: [paragraph({ type: 'text', value: 'foo trail' })] }
    const after = applyPlugin(tree, 'foo')
    const para = after.children[0] as Element
    expect(para.children).toHaveLength(2)
    expect(isMark(para.children[0])).toBe(true)
    expect(para.children[1]).toEqual({ type: 'text', value: ' trail' })
  })

  it('handles entire text node as match', () => {
    const tree: Root = { type: 'root', children: [paragraph({ type: 'text', value: 'foo' })] }
    const after = applyPlugin(tree, 'foo')
    const para = after.children[0] as Element
    expect(para.children).toHaveLength(1)
    expect(isMark(para.children[0])).toBe(true)
  })

  it('matches case-insensitively but preserves original casing', () => {
    const tree: Root = { type: 'root', children: [paragraph({ type: 'text', value: 'Foo and FOO' })] }
    const after = applyPlugin(tree, 'foo')
    const para = after.children[0] as Element
    expect(para.children).toHaveLength(3)
    expect(((para.children[0] as Element).children[0] as { value: string }).value).toBe('Foo')
    expect(para.children[1]).toEqual({ type: 'text', value: ' and ' })
    expect(((para.children[2] as Element).children[0] as { value: string }).value).toBe('FOO')
  })

  it('escapes regex special characters in query', () => {
    const tree: Root = { type: 'root', children: [paragraph({ type: 'text', value: 'use a.b.c selector' })] }
    const after = applyPlugin(tree, 'a.b.c')
    const para = after.children[0] as Element
    expect(para.children).toHaveLength(3)
    expect(((para.children[1] as Element).children[0] as { value: string }).value).toBe('a.b.c')
  })

  it('does not over-match when query has regex metachars', () => {
    // 'a.c' literal should NOT match 'abc'
    const tree: Root = { type: 'root', children: [paragraph({ type: 'text', value: 'abc def' })] }
    const after = applyPlugin(tree, 'a.c')
    const para = after.children[0] as Element
    expect(para.children).toHaveLength(1)
    expect(para.children[0]).toEqual({ type: 'text', value: 'abc def' })
  })
})
