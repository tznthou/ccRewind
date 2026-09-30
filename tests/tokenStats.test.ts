import { describe, it, expect } from 'vitest'
import { collapseDuplicateUsageRows, toolNamesPerCall } from '../src/main/tokenStats'

interface Row {
  sequence: number
  input_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  output_tokens: number
}

function row(sequence: number, input: number, read: number, creation: number, output = 0): Row {
  return {
    sequence,
    input_tokens: input,
    cache_read_tokens: read,
    cache_creation_tokens: creation,
    output_tokens: output,
  }
}

describe('collapseDuplicateUsageRows', () => {
  // 真實樣本(c9ed37b7 的第 5/6/7/9 列): 同一次回應被拆成 4 列, input/讀/寫相同, 只有輸出量是串流中途值
  it('keeps only the last row of a run of identical usage — its output is the final value', () => {
    const rows = [
      row(5, 31_670, 14_347, 17_321, 9),
      row(6, 31_670, 14_347, 17_321, 9),
      row(7, 31_670, 14_347, 17_321, 9),
      row(9, 31_670, 14_347, 17_321, 215),
    ]
    const out = collapseDuplicateUsageRows(rows)
    expect(out).toHaveLength(1)
    expect(out[0].sequence).toBe(9)
    expect(out[0].output_tokens).toBe(215)
  })

  it('collapses each run separately and keeps distinct calls', () => {
    const rows = [
      row(1, 100, 60, 40),
      row(2, 100, 60, 40),
      row(3, 150, 100, 50),
      row(4, 150, 100, 50),
      row(5, 150, 100, 50),
      row(6, 200, 150, 50),
    ]
    expect(collapseDuplicateUsageRows(rows).map(r => r.sequence)).toEqual([2, 5, 6])
  })

  it.each([
    ['input differs', row(2, 101, 60, 40)],
    ['cache read differs', row(2, 100, 61, 40)],
    ['cache creation differs', row(2, 100, 60, 41)],
  ])('does not collapse rows when %s', (_label, second) => {
    const out = collapseDuplicateUsageRows([row(1, 100, 60, 40), second])
    expect(out.map(r => r.sequence)).toEqual([1, 2])
  })

  it('does not collapse identical rows that are not adjacent', () => {
    const rows = [row(1, 100, 60, 40), row(2, 150, 100, 50), row(3, 100, 60, 40)]
    expect(collapseDuplicateUsageRows(rows).map(r => r.sequence)).toEqual([1, 2, 3])
  })

  // 2026-09 實測: opus-4-8 的 input=10、無快取小呼叫兩次撞同一組數字是巧合, 不是同一次回應
  it('does not collapse rows with no cache activity (read + creation = 0)', () => {
    const rows = [row(9, 10, 0, 0), row(10, 10, 0, 0)]
    expect(collapseDuplicateUsageRows(rows).map(r => r.sequence)).toEqual([9, 10])
  })

  it('is a no-op for a clean session and does not mutate its input', () => {
    const rows = [row(1, 100, 0, 100), row(2, 220, 100, 120), row(3, 400, 220, 180)]
    const copy = rows.map(r => ({ ...r }))
    const out = collapseDuplicateUsageRows(rows)
    expect(out).toEqual(copy)
    expect(rows).toEqual(copy)
    expect(out).not.toBe(rows)
  })

  it('returns an empty array for no rows', () => {
    expect(collapseDuplicateUsageRows([])).toEqual([])
  })
})

describe('toolNamesPerCall', () => {
  it('gives each call the tools of every entry since the previous call, up to and including its own', () => {
    // 呼叫在 sequence 9 / 14 / 20; 第一次呼叫的回應被拆成 5、7、9 三列
    const calls = [{ sequence: 9 }, { sequence: 14 }, { sequence: 20 }]
    const toolRows = [
      { sequence: 5, tool_names: 'Bash' },
      { sequence: 7, tool_names: 'Bash' },
      { sequence: 9, tool_names: 'Read,Grep' },
      { sequence: 12, tool_names: 'Edit' },
    ]
    expect(toolNamesPerCall(calls, toolRows)).toEqual([['Bash', 'Read', 'Grep'], ['Edit'], []])
  })

  it('does not attribute entries that come after the last call to anything', () => {
    const calls = [{ sequence: 4 }]
    const toolRows = [{ sequence: 3, tool_names: 'Bash' }, { sequence: 8, tool_names: 'Write' }]
    expect(toolNamesPerCall(calls, toolRows)).toEqual([['Bash']])
  })

  it('trims names, skips empty entries, and keeps first-seen order without duplicates', () => {
    const calls = [{ sequence: 10 }]
    const toolRows = [
      { sequence: 2, tool_names: ' Bash , ,Read' },
      { sequence: 6, tool_names: 'Read,Bash,Grep' },
    ]
    expect(toolNamesPerCall(calls, toolRows)).toEqual([['Bash', 'Read', 'Grep']])
  })

  it('returns one empty list per call when no entry called a tool', () => {
    expect(toolNamesPerCall([{ sequence: 1 }, { sequence: 2 }], [])).toEqual([[], []])
  })

  it('returns an empty array for no calls', () => {
    expect(toolNamesPerCall([], [{ sequence: 1, tool_names: 'Bash' }])).toEqual([])
  })
})
