import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { translate, type Locale, type MessageKey, type TranslateParams } from './messages'

interface I18nContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: MessageKey, params?: TranslateParams) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

const STORAGE_KEY = 'ccrewind.locale'

function detectInitialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'zh-TW' || stored === 'en') return stored
  } catch {
    // localStorage unavailable (rare in Electron renderer); fall through
  }
  if (typeof navigator !== 'undefined' && navigator.language?.startsWith('zh')) {
    return 'zh-TW'
  }
  return 'en'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectInitialLocale)

  const setLocale = useCallback((l: Locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      // ignore storage failures; in-memory state still updates
    }
    setLocaleState(l)
  }, [])

  const t = useCallback((key: MessageKey, params?: TranslateParams) => translate(locale, key, params), [locale])

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    return {
      locale: 'zh-TW',
      setLocale: () => {},
      t: (key, params) => translate('zh-TW', key, params),
    }
  }
  return ctx
}
