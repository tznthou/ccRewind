import { describe, it, expect } from 'vitest'
import { extractThinkingBlocks, extractToolBlocks, isDisplayableMessage, isOmittedThinking, type ThinkingBlock } from '../../src/renderer/components/ChatView/contentBlocks'
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

  // API 的 display:"omitted" 會回傳 thinking:"" + signature（官方格式）。
  // 這種 block 必須照樣抽出來——UI 靠它顯示「思考過程未保留」，
  // 濾掉的話該則訊息會整個消失，使用者無從得知這裡本來有推理。
  it('thinking 為空字串但帶 signature（display:omitted）仍會被抽出', () => {
    const cj = json([{ type: 'thinking', thinking: '', signature: 'EosnCkYICxIM' }])
    expect(extractThinkingBlocks(cj)).toHaveLength(1)
  })

  it('保留 signature 欄位供 UI 判斷 omitted（漏帶則 UI 無法區分空白成因）', () => {
    const cj = json([{ type: 'thinking', thinking: '', signature: 'EosnCkYICxIM' }])
    expect(extractThinkingBlocks(cj)[0].signature).toBe('EosnCkYICxIM')
  })
})

// 判斷「空白是 API 刻意省略」還是「單純沒內容」。UI 的文案會據此宣稱原因，
// 歸因錯了就是對使用者說謊，所以 signature 必須真的存在才算 omitted。
describe('isOmittedThinking', () => {
  it('空 thinking + 有 signature → true（API display:omitted）', () => {
    expect(isOmittedThinking({ type: 'thinking', thinking: '', signature: 'Eosn' })).toBe(true)
  })

  it('空 thinking + 無 signature 欄位 → false（不得宣稱是 omitted）', () => {
    expect(isOmittedThinking({ type: 'thinking', thinking: '' })).toBe(false)
  })

  it('空 thinking + signature 為空字串 → false', () => {
    expect(isOmittedThinking({ type: 'thinking', thinking: '', signature: '' })).toBe(false)
  })

  it('有明文 thinking → false（即使帶 signature，正常 block 不是 omitted）', () => {
    expect(isOmittedThinking({ type: 'thinking', thinking: '我在想…', signature: 'Eosn' })).toBe(false)
  })

  it('只有空白字元的 thinking 不算 omitted（有內容就照原樣渲染）', () => {
    expect(isOmittedThinking({ type: 'thinking', thinking: ' ', signature: 'Eosn' })).toBe(false)
  })

  // 型別宣告擋不住畸形的原始 JSON——parser 是寬容模式，signature 進來可能是任何東西。
  // 走 extractThinkingBlocks 是因為那才是真實路徑：直接構造物件會被 TS 擋掉，
  // 測不到 runtime 真正會遇到的形狀。
  it('signature 是物件（畸形 JSON）不算 omitted', () => {
    const [block] = extractThinkingBlocks(json([{ type: 'thinking', thinking: '', signature: {} }]))
    expect(isOmittedThinking(block)).toBe(false)
  })

  it('signature 是數字不算 omitted', () => {
    const [block] = extractThinkingBlocks(json([{ type: 'thinking', thinking: '', signature: 123 }]))
    expect(isOmittedThinking(block)).toBe(false)
  })

  it('signature 是 true 不算 omitted', () => {
    const [block] = extractThinkingBlocks(json([{ type: 'thinking', thinking: '', signature: true }]))
    expect(isOmittedThinking(block)).toBe(false)
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

  // 全庫實測 5,005 個空 thinking block 全帶 signature（2026-08-13 統計，08-07 起
  // 比例明顯上升）。這種訊息若判為不渲染，虛擬列表的 count 會與 MessageBubble 對不上。
  it('只有 display:omitted 的空 thinking block 仍會渲染', () => {
    const cj = json([{ type: 'thinking', thinking: '', signature: 'EosnCkYICxIM' }])
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
