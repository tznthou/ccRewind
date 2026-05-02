import { useState, useEffect, useCallback } from 'react'
import type { StorageOverview, ExclusionRuleInput, ExclusionPreviewResult } from '../../../shared/types'
import { useI18n } from '../../i18n/useI18n'
import StorageOverviewCards from './StorageOverviewCards'
import ProjectBreakdownList from './ProjectBreakdown'
import DateRangeExclusionForm from './DateRangeExclusionForm'
import ExclusionRulesList from './ExclusionRulesList'
import ConfirmExclusionDialog from './ConfirmExclusionDialog'
import DatabaseMaintenanceCard from './DatabaseMaintenanceCard'
import styles from './Storage.module.css'

interface PendingExclusion {
  preview: ExclusionPreviewResult
  title: string
}

export default function StoragePage() {
  const { t } = useI18n()
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
      setError(err instanceof Error ? err.message : t('common.errorLoading'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    refresh()
  }, [refresh])

  const openConfirm = useCallback(async (rule: ExclusionRuleInput, title: string) => {
    try {
      const preview = await window.api.previewExclusion(rule)
      if (preview.sessionCount === 0) {
        return
      }
      setPending({ preview, title })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errorPreview'))
    }
  }, [t])

  const confirmApply = useCallback(async () => {
    if (!pending || isApplying) return
    const snapshot = pending
    setIsApplying(true)
    try {
      await window.api.applyExclusion(snapshot.preview.applyToken)
      setPending(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errorApply'))
    } finally {
      setIsApplying(false)
    }
  }, [pending, isApplying, refresh, t])

  const removeRule = useCallback(async (id: number) => {
    try {
      await window.api.removeExclusionRule(id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errorRemove'))
    }
  }, [refresh, t])

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>{t('common.loading')}</div>
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
        <div className={styles.title}>{t('storage.page.title')}</div>
        <div className={styles.subtitle}>{t('storage.page.subtitle')}</div>
      </div>

      {error && <div className={styles.errorText}>{error}</div>}

      <div className={styles.section}>
        <div className={styles.sectionTitle}>{t('storage.section.overview')}</div>
        <StorageOverviewCards stats={overview.stats} />
      </div>

      <DatabaseMaintenanceCard onAfterCompact={refresh} />

      <div className={styles.section}>
        <div className={styles.sectionTitle}>{t('storage.section.projects')}</div>
        <ProjectBreakdownList
          projects={overview.projects}
          onExcludeProject={(projectId, displayName) => {
            openConfirm(
              { projectId, dateFrom: null, dateTo: null },
              t('storage.projects.excludeTitle', { name: displayName }),
            )
          }}
        />
      </div>

      <DateRangeExclusionForm
        projects={overview.projects}
        onSubmit={rule => openConfirm(rule, t('storage.dateRange.title'))}
      />

      <div className={styles.section}>
        <div className={styles.sectionTitle}>{t('storage.section.rules')}</div>
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
