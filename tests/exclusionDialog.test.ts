import { describe, it, expect } from 'vitest'
import {
  DEFAULT_EXCLUSION_MODE,
  exclusionDialogView,
  removalNeedsConfirm,
} from '../src/renderer/components/Storage/exclusionDialog'
import type { ExclusionPreview } from '../src/shared/types'

function preview(sessionCount: number): ExclusionPreview {
  return { sessionCount, messageCount: sessionCount * 10, estimatedBytes: sessionCount * 1024 }
}

describe('exclusion dialog view', () => {
  it('opens on the non-destructive choice by default', () => {
    // 刪除不可逆：使用者什麼都不動直接按確認，結果必須是資料還在
    expect(DEFAULT_EXCLUSION_MODE).toBe('rule-only')
  })

  it('with nothing matching there is nothing to delete, so only keep-data is possible', () => {
    const view = exclusionDialogView(preview(0), 100, 'delete')
    expect(view.canDelete).toBe(false)
    expect(view.mode).toBe('rule-only')
    expect(view.needsAcknowledge).toBe(false)
    expect(view.highImpact).toBe(false)
  })

  it('keep-data never shows the impact ratio or the high-impact warning', () => {
    // 那兩個訊號描述的是「要刪掉多少」，保留資料時它們沒有對象
    const view = exclusionDialogView(preview(80), 100, 'rule-only')
    expect(view.mode).toBe('rule-only')
    expect(view.showImpactRatio).toBe(false)
    expect(view.highImpact).toBe(false)
    expect(view.needsAcknowledge).toBe(false)
  })

  it('delete over half of the data shows the ratio, warns, and asks for acknowledgement', () => {
    const view = exclusionDialogView(preview(60), 100, 'delete')
    expect(view.canDelete).toBe(true)
    expect(view.mode).toBe('delete')
    expect(view.showImpactRatio).toBe(true)
    expect(view.impactRatio).toBeCloseTo(0.6)
    expect(view.highImpact).toBe(true)
    expect(view.needsAcknowledge).toBe(true)
  })

  it('delete of exactly half does not count as high impact (strictly more than half)', () => {
    const view = exclusionDialogView(preview(50), 100, 'delete')
    expect(view.highImpact).toBe(false)
    expect(view.needsAcknowledge).toBe(true)
  })

  it('without a session total there is no ratio to show', () => {
    const view = exclusionDialogView(preview(5), 0, 'delete')
    expect(view.showImpactRatio).toBe(false)
    expect(view.highImpact).toBe(false)
  })
})

describe('removing a rule', () => {
  it('asks first only for rules that deleted data', () => {
    // delete 規則移除後，建規則時刪掉的資料不會跟著回來——要先講清楚；
    // rule-only 規則沒動過資料，直接移除即可
    expect(removalNeedsConfirm({ mode: 'delete' })).toBe(true)
    expect(removalNeedsConfirm({ mode: 'rule-only' })).toBe(false)
  })
})
