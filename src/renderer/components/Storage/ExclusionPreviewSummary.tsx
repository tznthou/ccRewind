import type { ExclusionPreview } from '../../../shared/types'
import { useI18n } from '../../i18n/useI18n'
import { formatBytes } from '../../utils/formatBytes'

interface Props {
  preview: ExclusionPreview
  /** matches：還沒決定怎麼處理時的中性描述；delete：使用者已選擇刪除 */
  verb: 'matches' | 'delete'
}

export default function ExclusionPreviewSummary({ preview, verb }: Props) {
  const { t } = useI18n()
  return (
    <>
      {t(verb === 'delete' ? 'storage.preview.willDelete.start' : 'storage.preview.matches.start')}
      <strong>{preview.sessionCount}</strong>
      {t('storage.preview.midSession')}
      <strong>{preview.messageCount.toLocaleString()}</strong>
      {t('storage.preview.midMessage')}
      <strong>{formatBytes(preview.estimatedBytes)}</strong>
    </>
  )
}
