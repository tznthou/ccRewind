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
  // 快速路徑：UTF-16 長度不超過上限時，code point 數必然也不超過
  if (text.length <= MAX_MESSAGE_LENGTH) return text
  // 逐 code point 累加，最多看 MAX_MESSAGE_LENGTH + 1 個字元就停，
  // 不把整個字串展開成陣列（錯誤訊息可能很長）
  let count = 0
  let end = 0
  for (const ch of text) {
    if (count === MAX_MESSAGE_LENGTH) return text.slice(0, end) + '…'
    count += 1
    end += ch.length
  }
  return text
}

function stringify(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    try {
      // 一般物件用 JSON 才看得出內容，String() 只會得到 [object Object]
      return JSON.stringify(value) ?? ''
    } catch {
      // 循環參照、會拋錯的 getter 等：往下退回 String()
    }
  }
  try {
    return String(value)
  } catch {
    // String() 也可能拋錯——無原型物件（無 toString）、toString 自己拋錯、Symbol 都是。
    // 這裡已經在錯誤處理路徑上，再拋就會讓 boundary 自己壞掉、fallback 顯示不出來，
    // 所以放棄取得細節，只留下 name。
    return ''
  }
}

export function formatError(error: unknown): FormattedError {
  if (error instanceof Error) {
    // name 可被賦值成任意字串，比照 message 設限
    return { name: truncate(error.name), message: truncate(error.message) }
  }
  return { name: 'Error', message: truncate(stringify(error)) }
}
