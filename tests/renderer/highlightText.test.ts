import { describe, it, expect } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { highlightText } from '../../src/renderer/utils/highlightText'

function asMark(node: ReactNode): { text: string; dataSearchMatch: string | undefined } | null {
  if (!isValidElement(node)) return null
  const el = node as ReactElement<{ children: ReactNode; 'data-search-match'?: string }>
  if (el.type !== 'mark') return null
  return { text: String(el.props.children), dataSearchMatch: el.props['data-search-match'] }
}

function expectMark(node: ReactNode, expectedText: string) {
  const m = asMark(node)
  expect(m, `expected <mark> element, got: ${JSON.stringify(node)}`).not.toBeNull()
  expect(m!.text).toBe(expectedText)
  expect(m!.dataSearchMatch).toBe('true')
}

describe('highlightText', () => {
  it('returns plain string when query is empty', () => {
    expect(highlightText('foo bar', '')).toBe('foo bar')
  })

  it('returns plain string when no match', () => {
    expect(highlightText('foo bar', 'baz')).toBe('foo bar')
  })

  it('wraps a single match in <mark> with data-search-match attribute', () => {
    const result = highlightText('hello foo world', 'foo')
    expect(Array.isArray(result)).toBe(true)
    const arr = result as ReactNode[]
    expect(arr).toHaveLength(3)
    expect(arr[0]).toBe('hello ')
    expectMark(arr[1], 'foo')
    expect(arr[2]).toBe(' world')
  })

  it('wraps multiple matches in separate <mark> elements', () => {
    const result = highlightText('foo bar foo baz foo', 'foo')
    const arr = result as ReactNode[]
    // expected: [<mark>foo</mark>, ' bar ', <mark>foo</mark>, ' baz ', <mark>foo</mark>]
    expect(arr).toHaveLength(5)
    expectMark(arr[0], 'foo')
    expect(arr[1]).toBe(' bar ')
    expectMark(arr[2], 'foo')
    expect(arr[3]).toBe(' baz ')
    expectMark(arr[4], 'foo')
  })

  it('matches case-insensitively but preserves original casing in mark', () => {
    const result = highlightText('Foo FOO foo', 'foo')
    const arr = result as ReactNode[]
    expect(arr).toHaveLength(5)
    expectMark(arr[0], 'Foo')
    expect(arr[1]).toBe(' ')
    expectMark(arr[2], 'FOO')
    expect(arr[3]).toBe(' ')
    expectMark(arr[4], 'foo')
  })

  it('escapes regex special characters in query', () => {
    const result = highlightText('use a.b.c selector', 'a.b.c')
    const arr = result as ReactNode[]
    expect(arr).toHaveLength(3)
    expect(arr[0]).toBe('use ')
    expectMark(arr[1], 'a.b.c')
    expect(arr[2]).toBe(' selector')
  })

  it('does not over-match when query contains regex metachars', () => {
    // query 'a.c' literally — should NOT match 'abc' (would if regex unescaped)
    const result = highlightText('abc def', 'a.c')
    expect(result).toBe('abc def')
  })

  it('handles parens in query without throwing', () => {
    const result = highlightText('call foo() now', 'foo()')
    const arr = result as ReactNode[]
    expect(arr).toHaveLength(3)
    expectMark(arr[1], 'foo()')
  })

  it('handles match at start and end of string', () => {
    const result = highlightText('foo middle foo', 'foo')
    const arr = result as ReactNode[]
    expect(arr).toHaveLength(3)
    expectMark(arr[0], 'foo')
    expect(arr[1]).toBe(' middle ')
    expectMark(arr[2], 'foo')
  })

  it('handles entire string as match', () => {
    const result = highlightText('foo', 'foo')
    const arr = result as ReactNode[]
    expect(arr).toHaveLength(1)
    expectMark(arr[0], 'foo')
  })
})
