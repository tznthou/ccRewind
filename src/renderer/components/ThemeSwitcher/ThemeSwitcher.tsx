import { useTheme, type ThemeId } from '../../context/ThemeContext'
import { useI18n } from '../../i18n/useI18n'
import type { MessageKey } from '../../i18n/messages'
import styles from './ThemeSwitcher.module.css'

const themes: { id: ThemeId; labelKey: MessageKey; icon: React.ReactNode }[] = [
  {
    id: 'archive',
    labelKey: 'theme.archive',
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
    labelKey: 'theme.timeline',
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
    labelKey: 'theme.terminal',
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
  const { t } = useI18n()

  return (
    <div className={styles.container} role="radiogroup" aria-label={t('theme.aria.label')}>
      {themes.map(({ id, labelKey, icon }) => {
        const label = t(labelKey)
        return (
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
        )
      })}
    </div>
  )
}
