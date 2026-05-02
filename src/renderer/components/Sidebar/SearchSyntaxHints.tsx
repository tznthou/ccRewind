import { useI18n } from '../../i18n/useI18n'
import type { MessageKey } from '../../i18n/messages'
import styles from './SearchResults.module.css'

interface Tip {
  codeKey: MessageKey
  descKey: MessageKey
}

const MESSAGE_TIPS: Tip[] = [
  { codeKey: 'sidebar.searchResults.tips.exact.code',  descKey: 'sidebar.searchResults.tips.exact' },
  { codeKey: 'sidebar.searchResults.tips.prefix.code', descKey: 'sidebar.searchResults.tips.prefix' },
  { codeKey: 'sidebar.searchResults.tips.or.code',     descKey: 'sidebar.searchResults.tips.or' },
  { codeKey: 'sidebar.searchResults.tips.not.code',    descKey: 'sidebar.searchResults.tips.not' },
]

const SESSION_TIPS: Tip[] = [
  { codeKey: 'sidebar.searchResults.tips.exact.code',  descKey: 'sidebar.searchResults.tips.exact' },
  { codeKey: 'sidebar.searchResults.tips.prefix.code', descKey: 'sidebar.searchResults.tips.prefix' },
]

interface SearchSyntaxHintsProps {
  variant?: 'messages' | 'sessions'
}

export default function SearchSyntaxHints({ variant = 'messages' }: SearchSyntaxHintsProps) {
  const { t } = useI18n()
  const tips = variant === 'sessions' ? SESSION_TIPS : MESSAGE_TIPS
  return (
    <div className={styles.tipSection}>
      <span className={styles.tipsTitle}>{t('sidebar.searchResults.tips.title')}</span>
      <div className={styles.tipsList}>
        {tips.map(({ codeKey, descKey }) => (
          <div key={codeKey} className={styles.tip}>
            <code className={styles.tipCode}>{t(codeKey)}</code>
            <span className={styles.tipDesc}>{t(descKey)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
