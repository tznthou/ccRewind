/**
 * 把來自檔案系統或 JSONL 的字串放進 log 之前先逃逸。
 *
 * 為什麼需要：檔名在 macOS / Linux 可以合法含換行與 ANSI escape。索引路徑上的
 * sessionId、subagentId、filePath 全都直接來自 readdir 的結果，原樣插進 log
 * 等於讓任何能寫入家目錄的東西偽造 log 行（`bad\n[indexer] all good.jsonl`），
 * 或對開發者的終端機送控制序列 —— 後者在有漏洞的終端機上出過 RCE（iTerm2
 * CVE-2019-9535）。這是唯讀本機工具，但寫 log 的成本不該包含「相信檔名」。
 */

/** C1 控制字元（U+007F–U+009F）：JSON.stringify 不管它們，部分終端機仍會解讀。 */
const C1_CONTROL = /[\u007f-\u009f]/g

/**
 * 逃逸後回傳「帶引號」的字串。引號是刻意的：它標出值的邊界，
 * 讓讀 log 的人分得出路徑在哪裡結束、訊息從哪裡開始。
 */
export function logSafe(value: string): string {
  // JSON.stringify 逃逸 C0（含 ESC / CR / LF）並加上引號
  return JSON.stringify(value).replace(C1_CONTROL, (c) => `\\u${c.codePointAt(0)!.toString(16).padStart(4, '0')}`)
}

/**
 * 逃逸例外的描述文字。
 *
 * 只取 message 不取 stack：這些 catch 抓的幾乎都是 I/O 錯誤，stack 全在 fs 內部沒有
 * 除錯價值，而 message 本身就含攻擊者可控的路徑（`ENOENT: ... stat '<path>'`），
 * 交給 console 直接 inspect 一個 Error 物件不會逃逸它。
 */
export function logSafeError(err: unknown): string {
  if (err instanceof Error) return logSafe(err.message)
  try {
    return logSafe(String(err))
  } catch {
    // 無原型物件、或 toString 自己會拋的物件。錯誤處理器在處理錯誤時爆炸，
    // 會把原本要記的那筆失敗一起吃掉 —— 這裡是最後一道，不能再往外拋。
    return logSafe(`[unstringifiable ${typeof err}]`)
  }
}
