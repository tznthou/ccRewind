import { describe, it, expect } from 'vitest'
import { extractThinkingBlocks, type ThinkingBlock } from '../../src/renderer/components/ChatView/contentBlocks'

const json = (blocks: unknown) => JSON.stringify(blocks)

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
