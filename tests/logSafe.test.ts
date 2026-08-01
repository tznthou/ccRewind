import { describe, it, expect } from 'vitest'
import { logSafe, logSafeError } from '../src/main/logSafe'

/**
 * 索引路徑上的 log 全部插入檔案系統來源的字串。檔名在 macOS / Linux 可以合法
 * 含換行與 ANSI escape，所以「能不能偽造一行 log」「能不能對終端機送控制序列」
 * 是這裡真正要驗的兩件事。
 */
describe('logSafe', () => {
  it('換行不會外洩成新的一行 —— 否則檔名就能偽造 log 記錄', () => {
    const forged = 'bad\n[indexer] all sessions indexed, 0 skipped'
    const out = logSafe(forged)
    expect(out).not.toContain('\n')
    expect(out).toContain('\\n')
  })

  it('CR 也一併處理（單獨的 \\r 可以把游標拉回行首覆寫前面的輸出）', () => {
    expect(logSafe('a\rb')).not.toContain('\r')
  })

  it('ANSI escape 被逃逸 —— 終端機控制序列曾在有漏洞的終端機上升級成 RCE', () => {
    const ansi = '\u001b[2J\u001b[1;1H'
    const out = logSafe(ansi)
    expect(out).not.toContain('\u001b')
    expect(out).toContain('\\u001b')
  })

  it('C1 控制字元也逃逸（JSON.stringify 本身不管這段）', () => {
    for (const cp of [0x7f, 0x80, 0x9b, 0x9f]) {
      const out = logSafe(String.fromCharCode(cp))
      expect(out).not.toContain(String.fromCharCode(cp))
      expect(out.toLowerCase()).toContain(`\\u${cp.toString(16).padStart(4, '0')}`)
    }
  })

  it('尋常路徑照樣讀得懂，只是多一層引號標出邊界', () => {
    expect(logSafe('/Users/someone/.claude/projects/-a-b/sess-1.jsonl'))
      .toBe('"/Users/someone/.claude/projects/-a-b/sess-1.jsonl"')
  })

  it('CJK 與 emoji 不被破壞', () => {
    expect(logSafe('專案-🎬')).toBe('"專案-🎬"')
  })
})

describe('logSafeError', () => {
  it('Error 的 message 也逃逸 —— ENOENT 訊息本身就含攻擊者可控的路徑', () => {
    const err = Object.assign(new Error("ENOENT: no such file, stat 'a\nb'"), { code: 'ENOENT' })
    const out = logSafeError(err)
    expect(out).not.toContain('\n')
    expect(out).toContain('\\n')
  })

  it('非 Error 的 throw 值也吃得下', () => {
    expect(logSafeError('plain string')).toBe('"plain string"')
    expect(logSafeError(null)).toBe('"null"')
    expect(logSafeError(42)).toBe('"42"')
  })

  it('無原型物件不會讓錯誤處理器自己爆炸', () => {
    expect(() => logSafeError(Object.create(null))).not.toThrow()
  })
})
