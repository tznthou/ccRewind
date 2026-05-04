import { useState, useEffect, useId, type ReactNode } from 'react'
import type { DailyUsage, ProjectStats, DistributionItem, WorkPatterns, DailyEfficiency, WasteSession, ProjectHealth } from '../../../shared/types'
import { useAppDispatch } from '../../context/AppContext'
import { useI18n } from '../../i18n/useI18n'
import type { MessageKey } from '../../i18n/messages'
import UsageTrendChart from './UsageTrendChart'
import EfficiencyTrendChart from './EfficiencyTrendChart'
import UnresolvedSessions from './UnresolvedSessions'
import ProjectHealthComponent from './ProjectHealth'
import ToolDistribution from './ToolDistribution'
import TagDistribution from './TagDistribution'
import WorkPatternHeatmap from './WorkPatternHeatmap'
import styles from './Dashboard.module.css'

const RANGE_OPTIONS: ReadonlyArray<{ days: number; labelKey: MessageKey }> = [
  { days: 7, labelKey: 'dashboard.range.7d' },
  { days: 30, labelKey: 'dashboard.range.30d' },
  { days: 90, labelKey: 'dashboard.range.90d' },
  { days: 0, labelKey: 'dashboard.range.all' },
] as const

interface ProjectOption {
  id: string
  name: string
}

interface CardProps {
  titleKey: MessageKey
  subtitleKey: MessageKey
  wide?: boolean
  headerExtra?: ReactNode
  children: ReactNode
}

function Card({ titleKey, subtitleKey, wide, headerExtra, children }: CardProps) {
  const { t } = useI18n()
  const titleId = useId()
  return (
    <section
      className={`${styles.card} ${wide ? styles.cardWide : ''}`.trim()}
      aria-labelledby={titleId}
    >
      <div className={styles.cardHeader}>
        <div className={styles.cardTitleGroup}>
          <h2 id={titleId} className={styles.cardTitle}>{t(titleKey)}</h2>
          <p className={styles.cardSubtitle}>{t(subtitleKey)}</p>
        </div>
        {headerExtra}
      </div>
      {children}
    </section>
  )
}

export default function DashboardPage() {
  const { t } = useI18n()
  const [range, setRange] = useState(30)
  const [projectFilter, setProjectFilter] = useState<string | null>(null)
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [trendView, setTrendView] = useState<'usage' | 'efficiency'>('usage')
  const dispatch = useAppDispatch()

  const [usage, setUsage] = useState<DailyUsage[]>([])
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [projectStats, setProjectStats] = useState<ProjectStats[]>([])
  const [tools, setTools] = useState<DistributionItem[]>([])
  const [tags, setTags] = useState<DistributionItem[]>([])
  const [patterns, setPatterns] = useState<WorkPatterns | null>(null)
  const [efficiency, setEfficiency] = useState<DailyEfficiency[]>([])
  const [unresolved, setUnresolved] = useState<WasteSession[]>([])
  const [projectHealth, setProjectHealth] = useState<ProjectHealth[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.getProjectStats()
      .then(ps => {
        setProjectStats(ps)
        setProjects(ps.map(p => ({ id: p.projectId, name: p.displayName })))
      })
      .catch(() => { /* graceful degrade */ })
    window.api.getProjectHealth()
      .then(ph => setProjectHealth(ph))
      .catch(() => { /* graceful degrade */ })
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const results = await Promise.allSettled([
          window.api.getUsageStats(projectFilter, range),
          window.api.getToolDistribution(projectFilter),
          window.api.getTagDistribution(projectFilter),
          window.api.getWorkPatterns(projectFilter),
          window.api.getEfficiencyTrend(projectFilter, range),
          window.api.getWasteSessions(projectFilter),
        ])
        if (!cancelled) {
          if (results[0].status === 'fulfilled') setUsage(results[0].value)
          if (results[1].status === 'fulfilled') setTools(results[1].value)
          if (results[2].status === 'fulfilled') setTags(results[2].value)
          if (results[3].status === 'fulfilled') setPatterns(results[3].value)
          if (results[4].status === 'fulfilled') setEfficiency(results[4].value)
          if (results[5].status === 'fulfilled') setUnresolved(results[5].value)
        }
      } catch {
        /* IPC error — graceful degrade */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [projectFilter, range])

  const trendTitleKey: MessageKey = trendView === 'usage'
    ? 'dashboard.card.usageTrend'
    : 'dashboard.card.efficiencyTrend'

  const trendToggle = (
    <div className={styles.rangeGroup}>
      <button
        type="button"
        aria-pressed={trendView === 'usage'}
        className={`${styles.rangeButton} ${trendView === 'usage' ? styles.rangeActive : ''}`}
        onClick={() => setTrendView('usage')}
      >{t('dashboard.trend.usage')}</button>
      <button
        type="button"
        aria-pressed={trendView === 'efficiency'}
        className={`${styles.rangeButton} ${trendView === 'efficiency' ? styles.rangeActive : ''}`}
        onClick={() => setTrendView('efficiency')}
      >{t('dashboard.trend.efficiency')}</button>
    </div>
  )

  return (
    <div className={styles.dashboard}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t('dashboard.title')}</h1>
        <div className={styles.controls}>
          <select
            className={styles.filterSelect}
            value={projectFilter ?? ''}
            onChange={e => setProjectFilter(e.target.value || null)}
            aria-label={t('dashboard.filter.allProjects')}
          >
            <option value="">{t('dashboard.filter.allProjects')}</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          <div className={styles.rangeGroup}>
            {RANGE_OPTIONS.map(opt => (
              <button
                key={opt.days}
                type="button"
                aria-pressed={range === opt.days}
                className={`${styles.rangeButton} ${range === opt.days ? styles.rangeActive : ''}`}
                onClick={() => setRange(opt.days)}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className={styles.loading}>{t('common.loading')}</div>
      ) : (
        <div className={styles.grid}>
          <Card
            titleKey={trendTitleKey}
            subtitleKey="dashboard.subtitle.trend"
            wide
            headerExtra={trendToggle}
          >
            {trendView === 'usage'
              ? <UsageTrendChart data={usage} />
              : <EfficiencyTrendChart data={efficiency} />
            }
          </Card>

          {!projectFilter && (
            <Card titleKey="dashboard.card.projectHealth" subtitleKey="dashboard.subtitle.projectHealth">
              <ProjectHealthComponent data={projectHealth} />
            </Card>
          )}

          <Card titleKey="dashboard.card.workPatterns" subtitleKey="dashboard.subtitle.workPatterns">
            <WorkPatternHeatmap data={patterns} />
          </Card>

          <Card titleKey="dashboard.card.unresolved" subtitleKey="dashboard.subtitle.unresolved" wide>
            <UnresolvedSessions
              data={unresolved}
              onSessionClick={(projectId, sessionId) => {
                dispatch({ type: 'SET_VIEW_MODE', mode: 'sessions' })
                dispatch({ type: 'NAVIGATE_TO_SESSION', projectId, sessionId })
              }}
            />
          </Card>

          <Card titleKey="dashboard.card.toolUsage" subtitleKey="dashboard.subtitle.toolUsage">
            <ToolDistribution data={tools} />
          </Card>

          <Card titleKey="dashboard.card.tags" subtitleKey="dashboard.subtitle.tags">
            <TagDistribution data={tags} />
          </Card>
        </div>
      )}
    </div>
  )
}
