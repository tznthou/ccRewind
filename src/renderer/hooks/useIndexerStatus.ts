import { useState, useEffect } from 'react'
import type { IndexerStatus } from '../../shared/types'

export function useIndexerStatus() {
  const [status, setStatus] = useState<IndexerStatus | null>(null)

  useEffect(() => {
    const cleanup = window.api.onIndexerStatus(setStatus)
    return cleanup
  }, [])

  return status
}
