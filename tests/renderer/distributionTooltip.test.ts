import { describe, it, expect } from 'vitest'
import { formatDistributionTooltip } from '../../src/renderer/components/Dashboard/distributionTooltip'

describe('formatDistributionTooltip', () => {
  // tooltip 的字一律是主題文字色，認不出是哪一塊時只剩名稱可看：名稱若被單位取代，就不知道數字是哪個工具或標籤的
  it('名稱留著類別（工具或標籤），單位接在數量後面', () => {
    expect(formatDistributionTooltip(12, 'Read', '次使用')).toEqual(['12 次使用', 'Read'])
    expect(formatDistributionTooltip(173, 'refactor', 'sessions')).toEqual(['173 sessions', 'refactor'])
  })

  it('數量加千分位', () => {
    expect(formatDistributionTooltip(19797, 'Bash', 'uses')[0]).toBe(`${(19797).toLocaleString()} uses`)
  })
})
