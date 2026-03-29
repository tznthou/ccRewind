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
  const [fetchedPhase, setFetchedPhase] = useState(indexerPhase)

  // render-phase 重置（React 支援的 getDerivedStateFromProps 模式）
  if (indexerPhase !== fetchedPhase) {
    setFetchedPhase(indexerPhase)
    setLoading(true)
    setError(null)
  }

  useEffect(() => {
    let cancelled = false

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
