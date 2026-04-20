import { useState, useEffect, useCallback } from 'react'
import type { StorageOverview, ExclusionRuleInput, ExclusionPreviewResult } from '../../../shared/types'
import StorageOverviewCards from './StorageOverviewCards'
import ProjectBreakdownList from './ProjectBreakdown'
import DateRangeExclusionForm from './DateRangeExclusionForm'
import ExclusionRulesList from './ExclusionRulesList'
import ConfirmExclusionDialog from './ConfirmExclusionDialog'
import styles from './Storage.module.css'

interface PendingExclusion {
  preview: ExclusionPreviewResult
  title: string
}

export default function StoragePage() {
  const [overview, setOverview] = useState<StorageOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingExclusion | null>(null)
  const [isApplying, setIsApplying] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const data = await window.api.getStorageOverview()
      setOverview(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const openConfirm = useCallback(async (rule: ExclusionRuleInput, title: string) => {
    try {
      const preview = await window.api.previewExclusion(rule)
      if (preview.sessionCount === 0) {
        // 防禦：沒影響就不開 dialog（也不消費 main 剛產的 token，讓它自然過期）
        return
      }
      setPending({ preview, title })
    } catch (err) {
      setError(err instanceof Error ? err.message : '預覽失敗')
    }
  }, [])

  const confirmApply = useCallback(async () => {
    // Re-entrant guard：若正在 apply，後續按鈕點擊直接 no-op；snapshot pending 避免 cleanup 時 race
    if (!pending || isApplying) return
    const snapshot = pending
    setIsApplying(true)
    try {
      await window.api.applyExclusion(snapshot.preview.applyToken)
      setPending(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '套用失敗')
    } finally {
      setIsApplying(false)
    }
  }, [pending, isApplying, refresh])

  const removeRule = useCallback(async (id: number) => {
    try {
      await window.api.removeExclusionRule(id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '移除失敗')
    }
  }, [refresh])

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>載入中...</div>
      </div>
    )
  }

  if (error && !overview) {
    return (
      <div className={styles.page}>
        <div className={styles.errorText}>{error}</div>
      </div>
    )
  }

  if (!overview) return null

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.title}>儲存管理</div>
        <div className={styles.subtitle}>檢視索引資料庫佔用，管理排除規則以釋放空間</div>
      </div>

      {error && <div className={styles.errorText}>{error}</div>}

      <div className={styles.section}>
        <div className={styles.sectionTitle}>總覽</div>
        <StorageOverviewCards stats={overview.stats} />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>專案佔用</div>
        <ProjectBreakdownList
          projects={overview.projects}
          onExcludeProject={(projectId, displayName) => {
            openConfirm(
              { projectId, dateFrom: null, dateTo: null },
              `排除專案：${displayName}`,
            )
          }}
        />
      </div>

      <DateRangeExclusionForm
        projects={overview.projects}
        onSubmit={rule => openConfirm(rule, '依日期範圍排除')}
      />

      <div className={styles.section}>
        <div className={styles.sectionTitle}>現有規則</div>
        <ExclusionRulesList
          rules={overview.rules}
          projects={overview.projects}
          onRemove={removeRule}
        />
      </div>

      {pending && (
        <ConfirmExclusionDialog
          title={pending.title}
          preview={pending.preview}
          totalSessions={overview.stats.sessionCount}
          isApplying={isApplying}
          onConfirm={confirmApply}
          onCancel={() => { if (!isApplying) setPending(null) }}
        />
      )}
    </div>
  )
}
