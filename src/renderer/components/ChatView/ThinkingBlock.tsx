import { useState } from 'react'
import { useI18n } from '../../i18n/useI18n'
import MarkdownRenderer from './MarkdownRenderer'
import { isOmittedThinking, type ThinkingBlock as ThinkingBlockData } from './contentBlocks'
import styles from './ThinkingBlock.module.css'

interface ThinkingBlockProps {
  block: ThinkingBlockData
  searchQuery?: string
}

/**
 * 折疊顯示 assistant 的 thinking（推理過程）。原始 JSONL 一直保留在
 * message_content.content_json，過去 UI 不渲染；預設收合，因單則可達數萬字。
 * 收合時不掛載 MarkdownRenderer（lazy）——避免大量長 thinking 在收合狀態仍付出
 * markdown 解析成本；首次展開後保持掛載，避免反覆開合重解析。
 *
 * thinking 為空時改走單行提示：這種 block 是 API 端 display:"omitted" 的產物
 * （見 isOmittedThinking），給展開鈕只會讓人打開一個空框、誤判成程式故障。
 * 仍然要顯示而非整個藏起來——「這裡本來有推理」對考古來說就是資訊，
 * 藏了會讓同一則訊息在不同時期看起來像模型沒思考過。
 */
export default function ThinkingBlock({ block, searchQuery }: ThinkingBlockProps) {
  const { t } = useI18n()
  const [opened, setOpened] = useState(false)

  if (block.thinking === '') {
    return (
      <p className={styles.omitted}>
        <span className={styles.icon} aria-hidden="true">🧠</span>
        {isOmittedThinking(block)
          ? t('chatView.message.thinkingOmitted')
          : t('chatView.message.thinkingEmpty')}
      </p>
    )
  }

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
          <MarkdownRenderer content={block.thinking} searchQuery={searchQuery} />
        </div>
      )}
    </details>
  )
}
