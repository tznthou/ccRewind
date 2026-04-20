import type { ExclusionPreview } from '../../../shared/types'
import { formatBytes } from '../../utils/formatBytes'

interface Props {
  preview: ExclusionPreview
}

/** 共用預覽摘要文：ConfirmDialog 與 DateRangeExclusionForm 顯示相同影響描述 */
export default function ExclusionPreviewSummary({ preview }: Props) {
  return (
    <>
      將刪除 <strong>{preview.sessionCount}</strong> 個 session · <strong>{preview.messageCount.toLocaleString()}</strong> 條訊息 · 約 <strong>{formatBytes(preview.estimatedBytes)}</strong>
    </>
  )
}
