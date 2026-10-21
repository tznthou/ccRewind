import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 排除規則與側欄搜尋的日期條件：起訖時刻在 JS 算（localMidnightIso），SQL 只比時刻。indexer 的
// matchesExclusionRule 也在 JS 換算，兩邊讀同一份時區資料，預覽、刪除與之後的索引才會一致。
// SQLite 的 'localtime' 讀作業系統的時區資料，跟 JS（ICU）不一致時，刪掉的對話下一輪會被索引回來。
// 測試裡 SQLite 與 JS 跟著同一個 TZ，行為測試分不出兩種寫法，所以直接讀原始碼把這個選擇釘住
const DATABASE_TS = fileURLToPath(new URL('../src/main/database.ts', import.meta.url))
const source = readFileSync(DATABASE_TS, 'utf8')

/** 從方法簽名到它的結尾（兩格縮排的右大括號），去掉 // 註解：註解裡解釋為什麼不用 'localtime' 不算 */
function methodBody(signature: string): string {
  const start = source.indexOf(signature)
  if (start < 0) throw new Error(`method not found: ${signature}`)
  return source.slice(start, source.indexOf('\n  }\n', start)).replace(/\/\/.*$/gm, '')
}

describe('date filters use one time zone source', () => {
  it.each([
    '  private buildExclusionWhere(',
    '  search(query: string',
    '  searchSessions(query: string',
  ])('%s compares instants computed in JS, not SQLite localtime', (signature) => {
    const body = methodBody(signature)
    expect(body).not.toMatch(/localtime/)
    expect(body).toMatch(/localMidnightIso\(/)
  })
})
