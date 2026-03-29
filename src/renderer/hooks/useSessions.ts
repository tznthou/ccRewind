import { useState, useEffect } from 'react'
import type { SessionMeta } from '../../shared/types'
import { useIndexerStatus } from './useIndexerStatus'

export function useSessions(projectId: string | null) {
  const indexerStatus = useIndexerStatus()
  const indexerPhase = indexerStatus?.phase ?? null
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fetchedId, setFetchedId] = useState<string | null>(null)

  // projectId 變更時在 render phase 重置（React 支援的 getDerivedStateFromProps 模式）
  if (projectId !== fetchedId) {
    setFetchedId(projectId)
    setSessions([])
    setLoading(projectId !== null)
    setError(null)
  }

  useEffect(() => {
    if (!projectId) return

    let cancelled = false
    setLoading(true)
    setError(null)

    window.api.getSessions(projectId)
      .then((data) => {
        if (!cancelled) {
          const sorted = [...data].sort((a, b) => {
            const ta = a.startedAt ?? ''
            const tb = b.startedAt ?? ''
            return tb.localeCompare(ta)
          })
          setSessions(sorted)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [projectId, indexerPhase])

  return { sessions, loading, error }
}
