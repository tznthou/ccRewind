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
  const [fetchedPhase, setFetchedPhase] = useState(indexerPhase)

  // projectId 或 indexerPhase 變更時在 render phase 重置
  if (projectId !== fetchedId) {
    setFetchedId(projectId)
    setSessions([])
    setLoading(projectId !== null)
    setError(null)
    setFetchedPhase(indexerPhase)
  } else if (indexerPhase !== fetchedPhase) {
    setFetchedPhase(indexerPhase)
    setLoading(true)
    setError(null)
  }

  useEffect(() => {
    if (!projectId) return

    let cancelled = false

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
