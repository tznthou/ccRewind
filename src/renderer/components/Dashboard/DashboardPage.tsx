import { useState, useEffect, useCallback } from 'react'
import type { DailyUsage, ProjectStats, DistributionItem, WorkPatterns, DailyEfficiency, WasteSession, ProjectHealth } from '../../../shared/types'
import { useAppDispatch } from '../../context/AppContext'
import UsageTrendChart from './UsageTrendChart'
import EfficiencyTrendChart from './EfficiencyTrendChart'
import WasteDetection from './WasteDetection'
import ProjectHealthComponent from './ProjectHealth'
import ToolDistribution from './ToolDistribution'
import TagDistribution from './TagDistribution'
import WorkPatternHeatmap from './WorkPatternHeatmap'
import styles from './Dashboard.module.css'

const RANGE_OPTIONS = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
  { label: 'All', days: 0 },
] as const

interface ProjectOption {
  id: string
  name: string
}

export default function DashboardPage() {
  const [range, setRange] = useState(30)
  const [projectFilter, setProjectFilter] = useState<string | null>(null)
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [trendView, setTrendView] = useState<'usage' | 'efficiency'>('usage')
  const dispatch = useAppDispatch()

  // Data states
  const [usage, setUsage] = useState<DailyUsage[]>([])
  const [projectStats, setProjectStats] = useState<ProjectStats[]>([])
  const [tools, setTools] = useState<DistributionItem[]>([])
  const [tags, setTags] = useState<DistributionItem[]>([])
  const [patterns, setPatterns] = useState<WorkPatterns | null>(null)
  const [efficiency, setEfficiency] = useState<DailyEfficiency[]>([])
  const [waste, setWaste] = useState<WasteSession[]>([])
  const [projectHealth, setProjectHealth] = useState<ProjectHealth[]>([])
  const [loading, setLoading] = useState(true)

  // Load project list + health once (independent — one failing must not block the other)
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

  const loadData = useCallback(async () => {
    setLoading(true)
    let cancelled = false
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
        if (results[5].status === 'fulfilled') setWaste(results[5].value)
      }
    } catch {
      /* IPC error — graceful degrade */
    } finally {
      if (!cancelled) setLoading(false)
    }
    return () => { cancelled = true }
  }, [projectFilter, range])

  useEffect(() => { loadData() }, [loadData])

  return (
    <div className={styles.dashboard}>
      <div className={styles.header}>
        <h1 className={styles.title}>Dashboard</h1>
        <div className={styles.controls}>
          <select
            className={styles.filterSelect}
            value={projectFilter ?? ''}
            onChange={e => setProjectFilter(e.target.value || null)}
          >
            <option value="">All Projects</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          <div className={styles.rangeGroup}>
            {RANGE_OPTIONS.map(opt => (
              <button
                key={opt.days}
                className={`${styles.rangeButton} ${range === opt.days ? styles.rangeActive : ''}`}
                onClick={() => setRange(opt.days)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading...</div>
      ) : (
        <div className={styles.grid}>
          <div className={`${styles.card} ${styles.cardWide}`}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle} style={{ marginBottom: 0 }}>
                {trendView === 'usage' ? 'Usage Trend' : 'Efficiency Trend'}
              </div>
              <div className={styles.rangeGroup}>
                <button
                  className={`${styles.rangeButton} ${trendView === 'usage' ? styles.rangeActive : ''}`}
                  onClick={() => setTrendView('usage')}
                >Usage</button>
                <button
                  className={`${styles.rangeButton} ${trendView === 'efficiency' ? styles.rangeActive : ''}`}
                  onClick={() => setTrendView('efficiency')}
                >Efficiency</button>
              </div>
            </div>
            {trendView === 'usage'
              ? <UsageTrendChart data={usage} />
              : <EfficiencyTrendChart data={efficiency} />
            }
          </div>

          {!projectFilter && (
            <div className={styles.card}>
              <div className={styles.cardTitle}>Project Health</div>
              <ProjectHealthComponent data={projectHealth} />
            </div>
          )}

          <div className={styles.card}>
            <div className={styles.cardTitle}>Work Patterns</div>
            <WorkPatternHeatmap data={patterns} />
          </div>

          <div className={`${styles.card} ${styles.cardWide}`}>
            <div className={styles.cardTitle}>Waste Detection</div>
            <WasteDetection
              data={waste}
              onSessionClick={(sessionId) => {
                dispatch({ type: 'SET_VIEW_MODE', mode: 'sessions' })
                dispatch({ type: 'SELECT_SESSION', sessionId })
              }}
            />
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Tool Usage</div>
            <ToolDistribution data={tools} />
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Tags</div>
            <TagDistribution data={tags} />
          </div>
        </div>
      )}
    </div>
  )
}
