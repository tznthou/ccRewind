import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export type FontScaleId = 'normal' | 'large' | 'xlarge'

interface FontScaleContextValue {
  scale: FontScaleId
  setScale: (id: FontScaleId) => void
}

const STORAGE_KEY = 'ccrewind-font-scale'
const DEFAULT_SCALE: FontScaleId = 'normal'

const SCALE_VALUES: Record<FontScaleId, number> = {
  normal: 1.0,
  large: 1.1,
  xlarge: 1.25,
}

const FontScaleContext = createContext<FontScaleContextValue | null>(null)

function getInitialScale(): FontScaleId {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'normal' || stored === 'large' || stored === 'xlarge') {
    return stored
  }
  return DEFAULT_SCALE
}

export function FontScaleProvider({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState<FontScaleId>(getInitialScale)

  useEffect(() => {
    document.documentElement.style.setProperty('--font-scale', String(SCALE_VALUES[scale]))
    localStorage.setItem(STORAGE_KEY, scale)
  }, [scale])

  return (
    <FontScaleContext.Provider value={{ scale, setScale }}>
      {children}
    </FontScaleContext.Provider>
  )
}

export function useFontScale(): FontScaleContextValue {
  const ctx = useContext(FontScaleContext)
  if (!ctx) throw new Error('useFontScale must be used within FontScaleProvider')
  return ctx
}
