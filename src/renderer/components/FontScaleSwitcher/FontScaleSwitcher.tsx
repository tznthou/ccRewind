import { useCallback, useRef, type KeyboardEvent } from 'react'
import { useFontScale, type FontScaleId } from '../../context/FontScaleContext'
import { useI18n } from '../../i18n/useI18n'
import type { MessageKey } from '../../i18n/messages'
import styles from './FontScaleSwitcher.module.css'

const scales: { id: FontScaleId; labelKey: MessageKey; symbol: string }[] = [
  { id: 'normal', labelKey: 'fontSize.normal', symbol: 'A' },
  { id: 'large', labelKey: 'fontSize.large', symbol: 'A' },
  { id: 'xlarge', labelKey: 'fontSize.xlarge', symbol: 'A' },
]

export default function FontScaleSwitcher() {
  const { scale, setScale } = useFontScale()
  const { t } = useI18n()
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
      let nextIndex = currentIndex
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          nextIndex = (currentIndex + 1) % scales.length
          break
        case 'ArrowLeft':
        case 'ArrowUp':
          nextIndex = (currentIndex - 1 + scales.length) % scales.length
          break
        case 'Home':
          nextIndex = 0
          break
        case 'End':
          nextIndex = scales.length - 1
          break
        default:
          return
      }
      event.preventDefault()
      setScale(scales[nextIndex].id)
      buttonRefs.current[nextIndex]?.focus()
    },
    [setScale],
  )

  return (
    <div className={styles.container} role="radiogroup" aria-label={t('fontSize.aria.label')}>
      {scales.map(({ id, labelKey, symbol }, index) => {
        const label = t(labelKey)
        const isActive = scale === id
        return (
          <button
            key={id}
            ref={(el) => {
              buttonRefs.current[index] = el
            }}
            className={`${styles.button} ${styles[`size_${id}`]} ${isActive ? styles.active : ''}`}
            onClick={() => setScale(id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            role="radio"
            aria-checked={isActive}
            tabIndex={isActive ? 0 : -1}
            aria-label={label}
            title={label}
          >
            {symbol}
          </button>
        )
      })}
    </div>
  )
}
