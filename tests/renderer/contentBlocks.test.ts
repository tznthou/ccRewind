import { describe, it, expect } from 'vitest'
import { extractThinkingBlocks, extractToolBlocks, isDisplayableMessage, type ThinkingBlock } from '../../src/renderer/components/ChatView/contentBlocks'
import type { Message } from '../../src/shared/types'

const json = (blocks: unknown) => JSON.stringify(blocks)

type DisplayableInput = Pick<Message, 'type' | 'contentText' | 'contentJson'>

const msg = (over: Partial<DisplayableInput>): DisplayableInput => ({
  type: 'assistant',
  contentText: null,
  contentJson: null,
  ...over,
})

describe('extractThinkingBlocks', () => {
  it('抽出 thinking block 並保留 thinking 文字', () => {
    const cj = json([{ type: 'thinking', thinking: '我在想…' }])
    expect(extractThinkingBlocks(cj)).toEqual<ThinkingBlock[]>([
      { type: 'thinking', thinking: '我在想…' },
    ])
  })

  it('混合 block 只抽 thinking，並保留原順序', () => {
    const cj = json([
      { type: 'text', text: '結論' },
      { type: 'thinking', thinking: '推理一' },
      { type: 'tool_use', name: 'Bash', input: {} },
      { type: 'thinking', thinking: '推理二' },
    ])
    expect(extractThinkingBlocks(cj).map(b => b.thinking)).toEqual(['推理一', '推理二'])
  })

  it('contentJson 為 null → 空陣列', () => {
    expect(extractThinkingBlocks(null)).toEqual([])
  })

  it('壞掉的 JSON → 空陣列，不拋例外', () => {
    expect(extractThinkingBlocks('{ not valid json')).toEqual([])
  })

  it('content 非陣列（JSON object）→ 空陣列', () => {
    expect(extractThinkingBlocks(json({ type: 'thinking', thinking: 'x' }))).toEqual([])
  })

  it('type 是 thinking 但 thinking 欄位非 string → 排除（type guard 守住）', () => {
    // 若實作只判 type==='thinking' 而漏判 thinking 型別，這案例會轉紅
    const cj = json([
      { type: 'thinking' },                 // 缺 thinking 欄位
      { type: 'thinking', thinking: 123 },  // thinking 非 string
      { type: 'thinking', thinking: '有效' },
    ])
    expect(extractThinkingBlocks(cj).map(b => b.thinking)).toEqual(['有效'])
  })
})

// 這組斷言與 MessageBubble 的兩個 early return 綁定：任一邊改了條件、另一邊沒跟上，
// 虛擬列表的 count 就會與實際渲染出的列數不一致（捲軸長度失準）。
describe('isDisplayableMessage', () => {
  it('有 contentText 就會渲染', () => {
    expect(isDisplayableMessage(msg({ contentText: '嗨' }))).toBe(true)
  })

  it('last-prompt 即使有 contentText 也不渲染', () => {
    expect(isDisplayableMessage(msg({ type: 'last-prompt', contentText: '不該出現' }))).toBe(false)
  })

  it('無 contentText 但有 tool_use block 仍會渲染', () => {
    const cj = json([{ type: 'tool_use', name: 'Bash', input: {} }])
    expect(isDisplayableMessage(msg({ contentJson: cj }))).toBe(true)
  })

  it('無 contentText 但有 tool_result block 仍會渲染', () => {
    const cj = json([{ type: 'tool_result', tool_use_id: 'abc', content: 'out' }])
    expect(isDisplayableMessage(msg({ contentJson: cj }))).toBe(true)
  })

  it('無 contentText 但有 thinking block 仍會渲染', () => {
    const cj = json([{ type: 'thinking', thinking: '推理' }])
    expect(isDisplayableMessage(msg({ contentJson: cj }))).toBe(true)
  })

  it('空字串 contentText 且無可用 block 不渲染', () => {
    expect(isDisplayableMessage(msg({ contentText: '' }))).toBe(false)
  })

  it('contentJson 只有不認得的 block 不渲染', () => {
    const cj = json([{ type: 'image', source: {} }, { type: 'text', text: 'x' }])
    expect(isDisplayableMessage(msg({ contentJson: cj }))).toBe(false)
  })

  it('contentJson 是壞掉的 JSON 不拋錯且不渲染', () => {
    expect(isDisplayableMessage(msg({ contentJson: '{壞掉' }))).toBe(false)
  })

  it('contentJson 為 null 不渲染', () => {
    expect(isDisplayableMessage(msg({ contentJson: null }))).toBe(false)
  })
})

describe('extractToolBlocks', () => {
  it('抽出 tool_use 並保留 name 與 input', () => {
    const cj = json([{ type: 'tool_use', name: 'Bash', input: { cmd: 'ls' } }])
    expect(extractToolBlocks(cj)).toEqual([{ type: 'tool_use', name: 'Bash', input: { cmd: 'ls' } }])
  })

  it('抽出 tool_result 並保留 tool_use_id 與 content', () => {
    const cj = json([{ type: 'tool_result', tool_use_id: 'toolu_1', content: '輸出' }])
    expect(extractToolBlocks(cj)).toEqual([{ type: 'tool_result', tool_use_id: 'toolu_1', content: '輸出' }])
  })

  it('tool_use 缺 name 視為無效', () => {
    expect(extractToolBlocks(json([{ type: 'tool_use', input: {} }]))).toEqual([])
  })

  it('tool_use 的 name 非字串視為無效', () => {
    expect(extractToolBlocks(json([{ type: 'tool_use', name: 42, input: {} }]))).toEqual([])
  })

  it('tool_result 缺 tool_use_id 視為無效', () => {
    expect(extractToolBlocks(json([{ type: 'tool_result', content: 'x' }]))).toEqual([])
  })

  it('混合有效與無效 block 只留有效的並保序', () => {
    const cj = json([
      { type: 'text', text: '前言' },
      { type: 'tool_use', name: 'Read', input: {} },
      { type: 'tool_use' },
      { type: 'tool_result', tool_use_id: 'id2', content: 'ok' },
    ])
    expect(extractToolBlocks(cj).map(b => b.type)).toEqual(['tool_use', 'tool_result'])
  })

  it('非陣列的 contentJson 回空陣列', () => {
    expect(extractToolBlocks(json({ type: 'tool_use', name: 'X' }))).toEqual([])
  })

  it('壞掉的 JSON 不拋錯', () => {
    expect(() => extractToolBlocks('{壞掉')).not.toThrow()
    expect(extractToolBlocks('{壞掉')).toEqual([])
  })

  it('null contentJson 回空陣列', () => {
    expect(extractToolBlocks(null)).toEqual([])
  })
})
