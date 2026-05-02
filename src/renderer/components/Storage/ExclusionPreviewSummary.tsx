import type { ExclusionPreview } from '../../../shared/types'
import { useI18n } from '../../i18n/useI18n'
import { formatBytes } from '../../utils/formatBytes'

interface Props {
  preview: ExclusionPreview
}

export default function ExclusionPreviewSummary({ preview }: Props) {
  const { t } = useI18n()
  return (
    <>
      {t('storage.preview.willDelete.start')}
      <strong>{preview.sessionCount}</strong>
      {t('storage.preview.willDelete.midSession')}
      <strong>{preview.messageCount.toLocaleString()}</strong>
      {t('storage.preview.willDelete.midMessage')}
      <strong>{formatBytes(preview.estimatedBytes)}</strong>
    </>
  )
}
