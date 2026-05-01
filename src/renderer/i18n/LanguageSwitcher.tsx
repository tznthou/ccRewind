import { LOCALES, type Locale } from './messages'
import { useI18n } from './useI18n'
import styles from './LanguageSwitcher.module.css'

const LABEL_KEYS = {
  'zh-TW': 'app.languageSwitcher.zh',
  en: 'app.languageSwitcher.en',
} as const

export default function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n()

  return (
    <div className={styles.container} role="radiogroup" aria-label={t('app.languageSwitcher.label')}>
      {LOCALES.map((l: Locale) => (
        <button
          key={l}
          className={`${styles.button} ${locale === l ? styles.active : ''}`}
          onClick={() => setLocale(l)}
          role="radio"
          aria-checked={locale === l}
        >
          {t(LABEL_KEYS[l])}
        </button>
      ))}
    </div>
  )
}
