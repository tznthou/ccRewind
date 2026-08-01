import { useI18n } from '../../i18n/useI18n'
import type { FormattedError } from './errorFormat'
import styles from './ErrorBoundary.module.css'

interface FallbackProps {
  error: FormattedError
}

function detailText(error: FormattedError): string {
  return error.message ? `${error.name}: ${error.message}` : error.name
}

/** app 主體掛掉時的整頁 fallback */
export function AppErrorFallback({ error }: FallbackProps) {
  const { t } = useI18n()
  return (
    <div className={styles.appFallback} role="alert">
      <svg
        width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      >
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <h2 className={styles.appTitle}>{t('errorBoundary.app.title')}</h2>
      <p className={styles.appHint}>{t('errorBoundary.app.hint')}</p>
      <code className={styles.detail}>{detailText(error)}</code>
    </div>
  )
}

/** 單則訊息壞掉時的行內 fallback，同 session 的其他訊息不受影響 */
export function MessageErrorFallback({ error }: FallbackProps) {
  const { t } = useI18n()
  return (
    <div className={styles.messageFallback} role="alert">
      <span className={styles.messageLabel}>{t('errorBoundary.message.title')}</span>
      <code className={styles.detail}>{detailText(error)}</code>
    </div>
  )
}
