import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { resolveTheme } from './resolveTheme'

export type ThemeId = 'timeline' | 'board'

interface ThemeContextValue {
  theme: ThemeId
  setTheme: (id: ThemeId) => void
}

const STORAGE_KEY = 'ccrewind-theme'

const ThemeContext = createContext<ThemeContextValue | null>(null)

/** 存的是已移除的檔案室／終端機時換成時間線／黑板；下面的 effect 第一次 render 後寫回，遷移只發生一次 */
function getInitialTheme(): ThemeId {
  return resolveTheme(localStorage.getItem(STORAGE_KEY))
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
