import { useState, useEffect, useMemo, useRef } from 'react'
import type { ExclusionPreview, ExclusionRuleInput, ProjectBreakdown } from '../../../shared/types'
import { useI18n } from '../../i18n/useI18n'
import { lastSegment } from '../../utils/pathDisplay'
import ExclusionPreviewSummary from './ExclusionPreviewSummary'
import { buildDateRangeRule } from './dateRangeRule'
import styles from './Storage.module.css'

interface Props {
  projects: ProjectBreakdown[]
  onSubmit: (rule: ExclusionRuleInput) => void
}

export default function DateRangeExclusionForm({ projects, onSubmit }: Props) {
  const { t } = useI18n()
  const [projectId, setProjectId] = useState<string>('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [dateFromIncomplete, setDateFromIncomplete] = useState(false)
  const [dateToIncomplete, setDateToIncomplete] = useState(false)
  const dateFromRef = useRef<HTMLInputElement>(null)
  const dateToRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<ExclusionPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  // 組合當前 rule input；沒條件、或日期有填卻不是真的日期 → 沒有 rule（不預覽、不能送出）
  const ruleState = useMemo(
    () => buildDateRangeRule({ projectId, dateFrom, dateTo, dateFromIncomplete, dateToIncomplete }),
    [projectId, dateFrom, dateTo, dateFromIncomplete, dateToIncomplete],
  )
  const rule: ExclusionRuleInput | null = ruleState.status === 'ready' ? ruleState.rule : null

  // 只填了一部分的日期欄位 value 是空字串：從空欄位打起時值沒變、onChange 不一定會觸發，
  // 所以輸入時與離開欄位時都讀一次 validity.badInput（滑鼠點排除鈕前，欄位會先失去焦點）
  const syncIncomplete = () => {
    setDateFromIncomplete(dateFromRef.current?.validity.badInput ?? false)
    setDateToIncomplete(dateToRef.current?.validity.badInput ?? false)
  }

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

  // 0 筆也能送出：對話框會只開放「保留資料，停止之後的索引」，用來預先擋住之後符合的 session
  const canSubmit = rule !== null && preview !== null

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
              ref={dateFromRef}
              className={styles.input}
              value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); syncIncomplete(); resetPreview() }}
              onBlur={syncIncomplete}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>{t('storage.dateRange.field.dateTo')}</label>
            <input
              type="date"
              ref={dateToRef}
              className={styles.input}
              value={dateTo}
              onChange={e => { setDateTo(e.target.value); syncIncomplete(); resetPreview() }}
              onBlur={syncIncomplete}
            />
          </div>
        </div>

        <div className={styles.previewBox}>
          {ruleState.status === 'invalid-date' ? (
            <span className={styles.errorText}>{t('storage.dateRange.preview.invalidDate')}</span>
          ) : !rule ? (
            <span className={styles.previewEmpty}>{t('storage.dateRange.preview.empty')}</span>
          ) : previewError ? (
            <span className={styles.errorText}>{t('storage.dateRange.preview.failed', { message: previewError })}</span>
          ) : !preview ? (
            <span className={styles.previewEmpty}>{t('storage.dateRange.preview.loading')}</span>
          ) : preview.sessionCount === 0 ? (
            <span className={styles.previewEmpty}>{t('storage.dateRange.preview.noMatch')}</span>
          ) : (
            <ExclusionPreviewSummary preview={preview} verb="matches" />
          )}
        </div>

        <div>
          <button
            className={styles.button}
            disabled={!canSubmit}
            onClick={() => {
              // 最後再看一次欄位：只填了一部分的日期不能被當成沒填送出去
              if (dateFromRef.current?.validity.badInput || dateToRef.current?.validity.badInput) {
                syncIncomplete()
                return
              }
              if (rule) onSubmit(rule)
            }}
          >
            {t('storage.dateRange.submit')}
          </button>
        </div>
      </div>
    </details>
  )
}
