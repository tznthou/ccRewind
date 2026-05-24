import type { SessionTask } from '../../../shared/types'

export interface BlockedByRef {
  id: string
  // null = blockedBy 指向的 task 不在當前清單（資料不完整或 list 外）。
  // caller 據此降級為不可點的純 #id chip；非 null（含空字串）代表 task 存在、可跳轉。
  subject: string | null
}

// blockedBy 只存 task id；UI 需要 subject 來顯示「#id subject」並判斷能否 click-to-jump。
// 用 ?? 而非 ||：subject 為空字串的 task 仍存在（可跳轉），只有反查不到才是 null。
export function resolveBlockedBy(
  tasks: readonly Pick<SessionTask, 'taskId' | 'subject'>[],
  blockedByIds: readonly string[],
): BlockedByRef[] {
  const subjectById = new Map(tasks.map(task => [task.taskId, task.subject]))
  return blockedByIds.map(id => ({
    id,
    subject: subjectById.get(id) ?? null,
  }))
}
