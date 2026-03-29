import { useState, useEffect } from 'react'
import type { Project } from '../../shared/types'
import { useIndexerStatus } from './useIndexerStatus'

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const indexerStatus = useIndexerStatus()

  // indexer 完成時的 phase 作為 refetch 觸發點
  const indexerPhase = indexerStatus?.phase ?? null

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    window.api.getProjects()
      .then((data) => {
        if (!cancelled) {
          setProjects(data)
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
  }, [indexerPhase])

  return { projects, loading, error }
}
