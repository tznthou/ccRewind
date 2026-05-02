import { useState, useEffect, useCallback } from 'react'
import type { IndexerStatus } from '../../shared/types'

export function useIndexerStatus() {
  const [status, setStatus] = useState<IndexerStatus | null>(null)

  useEffect(() => {
    const cleanup = window.api.onIndexerStatus(setStatus)
    return cleanup
  }, [])

  const triggerSync = useCallback(async () => {
    await window.api.reindex()
  }, [])

  return { status, triggerSync }
}
