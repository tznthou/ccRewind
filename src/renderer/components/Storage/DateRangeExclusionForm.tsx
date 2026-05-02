import { useState, useEffect, useMemo } from 'react'
import type { ExclusionPreview, ExclusionRuleInput, ProjectBreakdown } from '../../../shared/types'
import { useI18n } from '../../i18n/useI18n'
import { lastSegment } from '../../utils/pathDisplay'
import ExclusionPreviewSummary from './ExclusionPreviewSummary'
import styles from './Storage.module.css'

interface Props {
  projects: ProjectBreakdown[]
  onSubmit: (rule: ExclusionRuleInput) => void
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export default function DateRangeExclusionForm({ projects, onSubmit }: Props) {
  const { t } = useI18n()
  const [projectId, setProjectId] = useState<string>('')
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
    const timer = setTimeout(() => {
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
            setPreviewError(err instanceof Error ? err.message : t('common.errorPreview'))
          }
        })
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [rule, t])

  const canSubmit = rule !== null && preview !== null && preview.sessionCount > 0

  return (
    <details className={styles.details}>
      <summary>{t('storage.dateRange.summary')}</summary>
      <div className={styles.detailsBody}>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>{t('storage.dateRange.field.project')}</label>
            <select
              className={styles.select}
              value={projectId}
              onChange={e => { setProjectId(e.target.value); resetPreview() }}
            >
              <option value="">{t('storage.dateRange.field.allProjects')}</option>
              {projects.map(p => (
                <option key={p.projectId} value={p.projectId}>{lastSegment(p.displayName)}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>{t('storage.dateRange.field.dateFrom')}</label>
            <input
              type="date"
              className={styles.input}
              value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); resetPreview() }}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>{t('storage.dateRange.field.dateTo')}</label>
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
            <span className={styles.previewEmpty}>{t('storage.dateRange.preview.empty')}</span>
          ) : previewError ? (
            <span className={styles.errorText}>{t('storage.dateRange.preview.failed', { message: previewError })}</span>
          ) : !preview ? (
            <span className={styles.previewEmpty}>{t('storage.dateRange.preview.loading')}</span>
          ) : preview.sessionCount === 0 ? (
            <span className={styles.previewEmpty}>{t('storage.dateRange.preview.noMatch')}</span>
          ) : (
            <ExclusionPreviewSummary preview={preview} />
          )}
        </div>

        <div>
          <button
            className={`${styles.button} ${styles.dangerButton}`}
            disabled={!canSubmit}
            onClick={() => rule && onSubmit(rule)}
          >
            {t('storage.dateRange.submit')}
          </button>
        </div>
      </div>
    </details>
  )
}
