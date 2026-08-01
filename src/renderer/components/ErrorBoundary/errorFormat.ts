/**
 * 把 componentDidCatch / getDerivedStateFromError 收到的任意值，轉成可顯示的錯誤摘要。
 *
 * React 的錯誤參數型別是 unknown——throw 的不一定是 Error。parser 採寬容模式收下未知
 * 結構的 JSONL，髒資料流到 renderer 時什麼都可能被丟出來，所以這裡不假設輸入型別。
 */

export interface FormattedError {
  name: string
  message: string
}

/** 以 code point 計算的顯示上限；超過就截斷，避免單一錯誤把畫面撐爆 */
export const MAX_MESSAGE_LENGTH = 500

function truncate(text: string): string {
  // 用展開運算子逐 code point 切，避免把代理對切成落單代理
  const points = [...text]
  if (points.length <= MAX_MESSAGE_LENGTH) return text
  return points.slice(0, MAX_MESSAGE_LENGTH).join('') + '…'
}

function stringify(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    try {
      // 一般物件用 JSON 才看得出內容，String() 只會得到 [object Object]
      return JSON.stringify(value) ?? String(value)
    } catch {
      // 循環參照等無法序列化的情況，退回 String()
      return String(value)
    }
  }
  return String(value)
}

export function formatError(error: unknown): FormattedError {
  if (error instanceof Error) {
    return { name: error.name, message: truncate(error.message) }
  }
  return { name: 'Error', message: truncate(stringify(error)) }
}
