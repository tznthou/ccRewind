import { useState } from 'react'
import { useI18n } from '../../i18n/useI18n'
import MarkdownRenderer from './MarkdownRenderer'
import styles from './ThinkingBlock.module.css'

interface ThinkingBlockProps {
  thinking: string
  searchQuery?: string
}

/**
 * 折疊顯示 assistant 的 thinking（推理過程）。原始 JSONL 一直保留在
 * message_content.content_json，過去 UI 不渲染；預設收合，因單則可達數萬字。
 * 收合時不掛載 MarkdownRenderer（lazy）——避免大量長 thinking 在收合狀態仍付出
 * markdown 解析成本；首次展開後保持掛載，避免反覆開合重解析。
 */
export default function ThinkingBlock({ thinking, searchQuery }: ThinkingBlockProps) {
  const { t } = useI18n()
  const [opened, setOpened] = useState(false)
  return (
    <details
      className={styles.thinkingBlock}
      onToggle={(e) => { if (e.currentTarget.open) setOpened(true) }}
    >
      <summary className={styles.summary}>
        <span className={styles.icon} aria-hidden="true">🧠</span>
        <span className={styles.label}>{t('chatView.message.thinking')}</span>
      </summary>
      {opened && (
        <div className={styles.content}>
          <MarkdownRenderer content={thinking} searchQuery={searchQuery} />
        </div>
      )}
    </details>
  )
}
