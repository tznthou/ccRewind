import { useState, useEffect, useCallback } from 'react'
import type { DailyUsage, ProjectStats, DistributionItem, WorkPatterns } from '../../../shared/types'
import UsageTrendChart from './UsageTrendChart'
import ProjectRanking from './ProjectRanking'
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

  // Data states
  const [usage, setUsage] = useState<DailyUsage[]>([])
  const [projectStats, setProjectStats] = useState<ProjectStats[]>([])
  const [tools, setTools] = useState<DistributionItem[]>([])
  const [tags, setTags] = useState<DistributionItem[]>([])
  const [patterns, setPatterns] = useState<WorkPatterns | null>(null)
  const [loading, setLoading] = useState(true)

  // Load project list once (also populates projectStats for initial render)
  useEffect(() => {
    window.api.getProjectStats()
      .then(ps => {
        setProjectStats(ps)
        setProjects(ps.map(p => ({ id: p.projectId, name: p.displayName })))
      })
      .catch(() => { /* graceful degrade */ })
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    let cancelled = false
    try {
      const [u, t, tg, wp] = await Promise.all([
        window.api.getUsageStats(projectFilter, range),
        window.api.getToolDistribution(projectFilter),
        window.api.getTagDistribution(projectFilter),
        window.api.getWorkPatterns(projectFilter),
      ])
      if (!cancelled) {
        setUsage(u)
        setTools(t)
        setTags(tg)
        setPatterns(wp)
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
            <div className={styles.cardTitle}>Usage Trend</div>
            <UsageTrendChart data={usage} />
          </div>

          {!projectFilter && (
            <div className={styles.card}>
              <div className={styles.cardTitle}>Project Activity</div>
              <ProjectRanking data={projectStats} />
            </div>
          )}

          <div className={styles.card}>
            <div className={styles.cardTitle}>Work Patterns</div>
            <WorkPatternHeatmap data={patterns} />
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
