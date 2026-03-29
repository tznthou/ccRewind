import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export type ThemeId = 'archive' | 'timeline' | 'terminal'

interface ThemeContextValue {
  theme: ThemeId
  setTheme: (id: ThemeId) => void
}

const STORAGE_KEY = 'ccrewind-theme'
const DEFAULT_THEME: ThemeId = 'timeline'

const ThemeContext = createContext<ThemeContextValue | null>(null)

function getInitialTheme(): ThemeId {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'archive' || stored === 'timeline' || stored === 'terminal') {
    return stored
  }
  return DEFAULT_THEME
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeId>(getInitialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
