import { useTheme, type ThemeId } from '../../context/ThemeContext'
import styles from './ThemeSwitcher.module.css'

const themes: { id: ThemeId; label: string; icon: React.ReactNode }[] = [
  {
    id: 'archive',
    label: '檔案室',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="1" width="10" height="12" />
        <line x1="2" y1="5" x2="12" y2="5" />
        <line x1="5" y1="5" x2="5" y2="1" />
      </svg>
    ),
  },
  {
    id: 'timeline',
    label: '時間線',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="4" y1="1" x2="4" y2="13" />
        <circle cx="4" cy="4" r="2" fill="currentColor" />
        <circle cx="4" cy="10" r="2" />
        <line x1="7" y1="4" x2="12" y2="4" />
        <line x1="7" y1="10" x2="12" y2="10" />
      </svg>
    ),
  },
  {
    id: 'terminal',
    label: '終端機',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="2,4 5,7 2,10" />
        <line x1="7" y1="10" x2="12" y2="10" />
      </svg>
    ),
  },
]

export default function ThemeSwitcher() {
  const { theme, setTheme } = useTheme()

  return (
    <div className={styles.container} role="radiogroup" aria-label="佈景主題">
      {themes.map(({ id, label, icon }) => (
        <button
          key={id}
          className={`${styles.button} ${theme === id ? styles.active : ''}`}
          onClick={() => setTheme(id)}
          role="radio"
          aria-checked={theme === id}
          aria-label={label}
          title={label}
        >
          {icon}
        </button>
      ))}
    </div>
  )
}
