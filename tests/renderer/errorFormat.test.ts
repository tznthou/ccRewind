import { describe, it, expect } from 'vitest'
import { formatError, MAX_MESSAGE_LENGTH } from '../../src/renderer/components/ErrorBoundary/errorFormat'

describe('formatError', () => {
  it('Error 物件保留 name 與 message', () => {
    expect(formatError(new Error('壞掉了'))).toEqual({ name: 'Error', message: '壞掉了' })
  })

  it('內建子類 Error 保留實際 name', () => {
    expect(formatError(new TypeError('不是函式'))).toEqual({ name: 'TypeError', message: '不是函式' })
  })

  it('自訂 name 的 Error 保留該 name', () => {
    const err = new Error('解析失敗')
    err.name = 'ParseError'
    expect(formatError(err)).toEqual({ name: 'ParseError', message: '解析失敗' })
  })

  it('message 為空的 Error 回傳空字串，不自行編造文字', () => {
    expect(formatError(new Error(''))).toEqual({ name: 'Error', message: '' })
  })

  it('字串當成 message，name 退回 Error', () => {
    expect(formatError('炸了')).toEqual({ name: 'Error', message: '炸了' })
  })

  it('一般物件序列化成 JSON，不是 [object Object]', () => {
    expect(formatError({ code: 42, reason: 'bad' })).toEqual({
      name: 'Error',
      message: '{"code":42,"reason":"bad"}',
    })
  })

  it('循環參照物件不拋錯，退回可讀字串', () => {
    const circular: Record<string, unknown> = { a: 1 }
    circular.self = circular
    const result = formatError(circular)
    expect(result.name).toBe('Error')
    expect(result.message).toBe('[object Object]')
  })

  it('null 與 undefined 回傳空 message，不顯示字面 null', () => {
    expect(formatError(null)).toEqual({ name: 'Error', message: '' })
    expect(formatError(undefined)).toEqual({ name: 'Error', message: '' })
  })

  it('數字與布林值轉成字串', () => {
    expect(formatError(404)).toEqual({ name: 'Error', message: '404' })
    expect(formatError(false)).toEqual({ name: 'Error', message: 'false' })
  })

  it('超長 message 截斷到上限並加省略號', () => {
    const long = 'x'.repeat(MAX_MESSAGE_LENGTH + 100)
    const result = formatError(new Error(long))
    expect(result.message).toHaveLength(MAX_MESSAGE_LENGTH + 1)
    expect(result.message.endsWith('…')).toBe(true)
    expect(result.message.slice(0, MAX_MESSAGE_LENGTH)).toBe('x'.repeat(MAX_MESSAGE_LENGTH))
  })

  it('剛好等於上限的 message 不截斷', () => {
    const exact = 'y'.repeat(MAX_MESSAGE_LENGTH)
    expect(formatError(new Error(exact)).message).toBe(exact)
  })

  it('截斷以 code point 計算，不切壞代理對', () => {
    // 每個 emoji 是一個 code point、兩個 UTF-16 code unit
    const emojis = '😀'.repeat(MAX_MESSAGE_LENGTH + 100)
    const result = formatError(new Error(emojis))
    expect(result.message.endsWith('…')).toBe(true)
    expect([...result.message]).toHaveLength(MAX_MESSAGE_LENGTH + 1)
    // 不得出現落單代理（切壞的半個 emoji）
    expect(/[\uD800-\uDFFF]/.test(result.message.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ''))).toBe(false)
  })
})
