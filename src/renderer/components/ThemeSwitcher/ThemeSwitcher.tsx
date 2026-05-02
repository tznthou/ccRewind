import { useCallback, useRef, type KeyboardEvent } from 'react'
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
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
      let nextIndex = currentIndex
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          nextIndex = (currentIndex + 1) % themes.length
          break
        case 'ArrowLeft':
        case 'ArrowUp':
          nextIndex = (currentIndex - 1 + themes.length) % themes.length
          break
        case 'Home':
          nextIndex = 0
          break
        case 'End':
          nextIndex = themes.length - 1
          break
        default:
          return
      }
      event.preventDefault()
      setTheme(themes[nextIndex].id)
      buttonRefs.current[nextIndex]?.focus()
    },
    [setTheme],
  )

  return (
    <div className={styles.container} role="radiogroup" aria-label={t('theme.aria.label')}>
      {themes.map(({ id, labelKey, icon }, index) => {
        const label = t(labelKey)
        const isActive = theme === id
        return (
          <button
            key={id}
            ref={(el) => {
              buttonRefs.current[index] = el
            }}
            className={`${styles.button} ${isActive ? styles.active : ''}`}
            onClick={() => setTheme(id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            role="radio"
            aria-checked={isActive}
            tabIndex={isActive ? 0 : -1}
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
