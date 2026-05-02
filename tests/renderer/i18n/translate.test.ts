import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { translate, messages, LOCALES, type MessageKey } from '../../../src/renderer/i18n/messages'

describe('translate', () => {
  it('returns zh-TW translation when locale is zh-TW', () => {
    expect(translate('zh-TW', 'sidebar.indexer.scanning')).toBe('掃描中')
    expect(translate('zh-TW', 'sidebar.section.projects')).toBe('專案')
    expect(translate('zh-TW', 'app.tooltip.dashboard')).toBe('儀表板')
  })

  it('returns en translation when locale is en', () => {
    expect(translate('en', 'sidebar.indexer.scanning')).toBe('Scanning')
    expect(translate('en', 'sidebar.section.projects')).toBe('Projects')
    expect(translate('en', 'app.tooltip.dashboard')).toBe('Dashboard')
  })

  it('returns the key itself when both locale and zh-TW miss', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ghostKey = 'nonexistent.key' as MessageKey
    expect(translate('zh-TW', ghostKey)).toBe('nonexistent.key')
    consoleSpy.mockRestore()
  })

  it('LOCALES contains both supported locales', () => {
    expect(LOCALES).toContain('zh-TW')
    expect(LOCALES).toContain('en')
    expect(LOCALES).toHaveLength(2)
  })

  it('en and zh-TW have identical key set', () => {
    const zhKeys = Object.keys(messages['zh-TW']).sort()
    const enKeys = Object.keys(messages.en).sort()
    expect(enKeys).toEqual(zhKeys)
  })
})

describe('translate params', () => {
  it('substitutes {key} placeholders', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ghostKey = 'demo.greeting' as MessageKey
    const localMessages = messages['zh-TW'] as unknown as Record<string, string>
    localMessages[ghostKey] = '你好，{name}！'
    expect(translate('zh-TW', ghostKey, { name: '超超' })).toBe('你好，超超！')
    delete localMessages[ghostKey]
    consoleSpy.mockRestore()
  })

  it('substitutes multiple placeholders', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ghostKey = 'demo.count' as MessageKey
    const localMessages = messages['zh-TW'] as unknown as Record<string, string>
    localMessages[ghostKey] = '{count} 筆 / {total} 個 session'
    expect(translate('zh-TW', ghostKey, { count: 5, total: 2 })).toBe('5 筆 / 2 個 session')
    delete localMessages[ghostKey]
    consoleSpy.mockRestore()
  })

  it('coerces number params to string', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ghostKey = 'demo.num' as MessageKey
    const localMessages = messages['zh-TW'] as unknown as Record<string, string>
    localMessages[ghostKey] = '{n} items'
    expect(translate('zh-TW', ghostKey, { n: 42 })).toBe('42 items')
    delete localMessages[ghostKey]
    consoleSpy.mockRestore()
  })
})

describe('translate dev warn', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('warns once when key is missing', () => {
    const ghostKey = 'totally.missing' as MessageKey
    translate('zh-TW', ghostKey)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('totally.missing'))
  })
})
