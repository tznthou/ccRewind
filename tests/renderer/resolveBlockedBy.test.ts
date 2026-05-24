import { describe, it, expect } from 'vitest'
import { resolveBlockedBy, type BlockedByRef } from '../../src/renderer/components/ChatView/blockedBy'

type MinimalTask = { taskId: string; subject: string }

const tasks: MinimalTask[] = [
  { taskId: '1', subject: '建 schema' },
  { taskId: '2', subject: '寫 parser' },
  { taskId: '3', subject: '' }, // 存在但 subject 為空字串
]

describe('resolveBlockedBy', () => {
  it('查得到的 id 帶出對應 subject', () => {
    expect(resolveBlockedBy(tasks, ['2'])).toEqual<BlockedByRef[]>([
      { id: '2', subject: '寫 parser' },
    ])
  })

  it('查不到的 id（指向清單外的 task）subject 為 null', () => {
    expect(resolveBlockedBy(tasks, ['99'])).toEqual<BlockedByRef[]>([
      { id: '99', subject: null },
    ])
  })

  it('混合查得到與查不到時，保持 blockedBy 的輸入順序', () => {
    expect(resolveBlockedBy(tasks, ['2', '99', '1'])).toEqual<BlockedByRef[]>([
      { id: '2', subject: '寫 parser' },
      { id: '99', subject: null },
      { id: '1', subject: '建 schema' },
    ])
  })

  it('subject 為空字串的 task 仍視為存在（subject 是 \'\' 不是 null）', () => {
    // 區分「存在但 subject 空」與「不存在」：前者可跳轉，後者不可。
    // 若實作誤用 || null 會把 '' 吞成 null，此案例會轉紅。
    expect(resolveBlockedBy(tasks, ['3'])).toEqual<BlockedByRef[]>([
      { id: '3', subject: '' },
    ])
  })

  it('空 blockedBy 回傳空陣列', () => {
    expect(resolveBlockedBy(tasks, [])).toEqual([])
  })
})
