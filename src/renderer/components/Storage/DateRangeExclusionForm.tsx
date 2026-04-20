import { useState, useEffect, useMemo } from 'react'
import type { ExclusionPreview, ExclusionRuleInput, ProjectBreakdown } from '../../../shared/types'
import { formatBytes } from '../../utils/formatBytes'
import { lastSegment } from '../../utils/pathDisplay'
import styles from './Storage.module.css'

interface Props {
  projects: ProjectBreakdown[]
  onSubmit: (rule: ExclusionRuleInput) => void
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export default function DateRangeExclusionForm({ projects, onSubmit }: Props) {
  const [projectId, setProjectId] = useState<string>('') // '' === 所有專案
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [preview, setPreview] = useState<ExclusionPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  // 組合當前 rule input；無任何條件 → null（後續 early return）
  const rule: ExclusionRuleInput | null = useMemo(() => {
    const pid = projectId || null
    const df = dateFrom && DATE_RE.test(dateFrom) ? dateFrom : null
    const dt = dateTo && DATE_RE.test(dateTo) ? dateTo : null
    if (!pid && !df && !dt) return null
    return { projectId: pid, dateFrom: df, dateTo: dt }
  }, [projectId, dateFrom, dateTo])

  // User 改任一欄位 → 立即清掉 preview（避免顯示舊規則的 stale 數字），
  // 由 effect 在 debounce 後重抓。做在 handler 而非 effect，避開 react-hooks/set-state-in-effect。
  const resetPreview = () => {
    setPreview(null)
    setPreviewError(null)
  }

  // debounce preview：rule 為 null 時不發請求（preview 已由 handler 清為 null）
  useEffect(() => {
    if (!rule) return
    let cancelled = false
    const t = setTimeout(() => {
      window.api.previewExclusion(rule)
        .then(p => {
          if (!cancelled) {
            setPreview(p)
            setPreviewError(null)
          }
        })
        .catch(err => {
          if (!cancelled) {
            setPreview(null)
            setPreviewError(err instanceof Error ? err.message : '預覽失敗')
          }
        })
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [rule])

  const canSubmit = rule !== null && preview !== null && preview.sessionCount > 0

  return (
    <details className={styles.details}>
      <summary>依日期範圍排除（進階）</summary>
      <div className={styles.detailsBody}>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>專案</label>
            <select
              className={styles.select}
              value={projectId}
              onChange={e => { setProjectId(e.target.value); resetPreview() }}
            >
              <option value="">所有專案</option>
              {projects.map(p => (
                <option key={p.projectId} value={p.projectId}>{lastSegment(p.displayName)}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>起始日期</label>
            <input
              type="date"
              className={styles.input}
              value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); resetPreview() }}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>結束日期</label>
            <input
              type="date"
              className={styles.input}
              value={dateTo}
              onChange={e => { setDateTo(e.target.value); resetPreview() }}
            />
          </div>
        </div>

        <div className={styles.previewBox}>
          {!rule ? (
            <span className={styles.previewEmpty}>選擇至少一個條件以預覽影響</span>
          ) : previewError ? (
            <span className={styles.errorText}>預覽失敗：{previewError}</span>
          ) : !preview ? (
            <span className={styles.previewEmpty}>預覽中...</span>
          ) : preview.sessionCount === 0 ? (
            <span className={styles.previewEmpty}>無符合條件的 session</span>
          ) : (
            <>
              將刪除 <strong>{preview.sessionCount}</strong> 個 session · <strong>{preview.messageCount.toLocaleString()}</strong> 條訊息 · 約 <strong>{formatBytes(preview.estimatedBytes)}</strong>
            </>
          )}
        </div>

        <div>
          <button
            className={`${styles.button} ${styles.dangerButton}`}
            disabled={!canSubmit}
            onClick={() => rule && onSubmit(rule)}
          >
            套用規則並刪除
          </button>
        </div>
      </div>
    </details>
  )
}
