// Electron renderer 的 CDP 截圖工具：整頁或指定選擇器的區域，存成 png。
//
// 存在理由：UI 改動的最後一哩驗證是「人眼看到的樣子對不對」——DOM 查詢證明得了結構，
// 證明不了排版被裁掉、顏色在深色主題下看不見這類問題。裁切到單一元件（而非整頁）
// 是因為整頁截圖縮到能看的尺寸後，一個小 badge 根本分辨不出來。
//
// 用法（前置條件與 `--` 陷阱見 cdp-eval.mjs 檔頭）：
//   node scripts/cdp-screenshot.mjs .draft/out.png                        # 整頁
//   node scripts/cdp-screenshot.mjs .draft/out.png '[class*=sessionItem]' # 只截該元素
//
// ⚠️ 輸出建議放 .draft/（已在 .gitignore 內）。這支工具截的是本機真實對話畫面——
// session 標題、意圖、標籤全部來自 ~/.claude/ 的實際紀錄，而本 repo 是公開的。
// 寫到 repo root 的 out.png 不會被任何現有 .gitignore 規則擋下（`out/` 只匹配目錄）。
//
// 連線層（逾時、CDP 協定錯誤、斷線處理）與路徑防護在 cdp-client.mjs。

import { assertSafeOutputPath, isUsableRect, openPageSocket, writeFileNoClobber } from './cdp-client.mjs'

// 裁切區域用 2x 取樣，否則小元件（badge、圖示）截出來糊到看不出對錯。
const CLIP_SCALE = 2

const [outPath, selector] = process.argv.slice(2)
if (!outPath) {
  console.error('用法: node scripts/cdp-screenshot.mjs <out.png> [selector]')
  process.exit(1)
}

let client
try {
  // 先擋明顯打錯的路徑，快速失敗；真正保證不覆寫的是最後那個 writeFileNoClobber。
  assertSafeOutputPath(outPath)
  client = await openPageSocket()

  let clip
  if (selector) {
    // 回傳頁面座標而非視窗座標：CDP 的 clip 吃的是頁面座標系，而 getBoundingClientRect
    // 給的是視窗座標。容器內捲動過的元素 y 可能為負，直接送出去會截到錯的位置。
    const rect = await client.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return null
      const b = el.getBoundingClientRect()
      return {
        x: b.x + window.scrollX,
        y: b.y + window.scrollY,
        width: b.width,
        height: b.height,
      }
    })()`)

    if (rect === null) {
      throw new Error(`選擇器沒有命中任何元素: ${selector}`)
    }
    // 命中但沒有面積（display:none、還沒 layout）——不擋下來就會存出一張 0x0 的圖，
    // 然後照樣印「已存檔」。
    if (!isUsableRect(rect)) {
      throw new Error(`選擇器命中的元素沒有可見面積（${rect.width}x${rect.height}）: ${selector}`)
    }
    clip = { ...rect, scale: CLIP_SCALE }
  }

  const shot = await client.send('Page.captureScreenshot', clip ? { clip, format: 'png' } : { format: 'png' })
  // 緊接著寫入前再驗一次：上面那次檢查到現在隔了一整段 CDP 往返，被驗過的祖先目錄
  // 可能已經被換掉。重驗縮小時間窗，`wx` 則讓「已存在就失敗」不依賴時間窗。
  const safePath = assertSafeOutputPath(outPath)
  writeFileNoClobber(safePath, Buffer.from(shot.data, 'base64'))
  console.log(`已存檔: ${safePath}${clip ? ` (裁切 ${Math.round(clip.width)}x${Math.round(clip.height)} @${CLIP_SCALE}x)` : ' (整頁)'}`)
} catch (e) {
  console.error('FAILED:', e.message)
  process.exitCode = 1
} finally {
  client?.close()
}
