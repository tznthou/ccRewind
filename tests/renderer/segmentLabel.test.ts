import { describe, it, expect } from 'vitest'
import { segmentLabelFits } from '../../src/renderer/components/Dashboard/segmentLabel'
import { OUTCOME_I18N_KEY, OUTCOME_KEYS } from '../../src/renderer/components/Dashboard/outcomeColors'
import { LOCALES, translate } from '../../src/renderer/i18n/messages'

/**
 * 黑板的專案健康度長條在段內寫 outcome 名稱（裁決 21）：段寬 = 佔比 × 長條寬（黑板 220px），名稱放不下的段不寫
 * （段的 overflow 是 hidden，硬塞會被切成半個字；名稱還在圖例與 tooltip 裡）。
 * 名稱的字級是 --font-size-xs（12px × 字級），字級有三種（FontScaleContext：1、1.1、1.25）。spike 的寬度估算只對「一般」字級：
 * 大字級時會把名稱塞進放不下的段（黑板計畫 PR2 改動 6）。
 * 這裡不鎖估算公式，只鎖該有的性質；三種字級的實際畫面另看（計畫完成條件 6）。
 */

const BAR_PX = 220
const SCALES = [1, 1.1, 1.25]
const NAMES = LOCALES.flatMap(locale => OUTCOME_KEYS.map(key => translate(locale, OUTCOME_I18N_KEY[key])))

/** 放得下的最小佔比（0.001 一格）；整條都放不下回 Infinity */
function minShare(name: string, scale: number): number {
  for (let i = 0; i <= 1000; i++) {
    if (segmentLabelFits(name, i / 1000, BAR_PX, scale)) return i / 1000
  }
  return Infinity
}

describe('segmentLabelFits', () => {
  it('outcome 名稱中英文各 5 個', () => {
    expect(NAMES).toHaveLength(10)
    expect(new Set(NAMES).size).toBe(10)
  })

  it.each(SCALES)('字級 %s：整條長條放得下每個 outcome 名稱（中英文）', scale => {
    const tooLong = NAMES.filter(name => !segmentLabelFits(name, 1, BAR_PX, scale))
    expect(tooLong, `整條 ${BAR_PX}px 放不下：${tooLong.join('、')}`).toEqual([])
  })

  it('佔比 0 或算不出來（這個專案一筆都沒有 → 0 / 0 = NaN）時不寫名稱', () => {
    for (const scale of SCALES) {
      for (const name of NAMES) {
        expect(segmentLabelFits(name, 0, BAR_PX, scale), `${name} 佔比 0`).toBe(false)
        expect(segmentLabelFits(name, NaN, BAR_PX, scale), `${name} 佔比 NaN`).toBe(false)
      }
    }
  })

  it('字級越大要的空間越多：每個名稱在三種字級要的最小佔比依序變大', () => {
    for (const name of NAMES) {
      const [normal, large, xlarge] = SCALES.map(scale => minShare(name, scale))
      expect(normal, `${name} 一般字級整條都放不下`).toBeLessThan(Infinity)
      expect(large, `${name}：大字級要的空間沒有比一般多`).toBeGreaterThan(normal)
      expect(xlarge, `${name}：特大字級要的空間沒有比大字級多`).toBeGreaterThan(large)
    }
  })

  it('中文字比英文字寬：同樣字數，中文要的佔比比較大', () => {
    for (const scale of SCALES) {
      const latin = minShare('abc', scale)
      expect(latin, `字級 ${scale}：三個英文字母整條都放不下`).toBeLessThan(Infinity)
      expect(minShare('已提交', scale), `字級 ${scale}：三個中文字要的空間沒有比三個英文字母多`).toBeGreaterThan(latin)
    }
  })

  it('長條寬度有算進去：220px 差一格放不下的佔比，換到兩倍寬的長條放得下', () => {
    for (const scale of SCALES) {
      for (const name of NAMES) {
        const min = minShare(name, scale)
        expect(min, `${name} 字級 ${scale} 整條都放不下`).toBeLessThan(Infinity)
        const share = min - 0.001
        expect(segmentLabelFits(name, share, BAR_PX, scale), `${name} 字級 ${scale} 在 ${BAR_PX}px`).toBe(false)
        expect(segmentLabelFits(name, share, BAR_PX * 2, scale), `${name} 字級 ${scale} 在 ${BAR_PX * 2}px`).toBe(true)
      }
    }
  })
})
