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

  return (
    <div className={styles.container} role="radiogroup" aria-label={t('fontSize.aria.label')}>
      {scales.map(({ id, labelKey, symbol }) => {
        const label = t(labelKey)
        return (
          <button
            key={id}
            className={`${styles.button} ${styles[`size_${id}`]} ${scale === id ? styles.active : ''}`}
            onClick={() => setScale(id)}
            role="radio"
            aria-checked={scale === id}
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
