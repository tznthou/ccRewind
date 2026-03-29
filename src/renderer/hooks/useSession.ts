import { useEffect, useReducer } from 'react'
import type { Message } from '../../shared/types'

interface State {
  messages: Message[]
  loading: boolean
  error: string | null
  fetchedId: string | null
}

type Action =
  | { type: 'RESET'; sessionId: string | null }
  | { type: 'SUCCESS'; messages: Message[] }
  | { type: 'ERROR'; error: string }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'RESET':
      return { messages: [], loading: action.sessionId !== null, error: null, fetchedId: action.sessionId }
    case 'SUCCESS':
      return { ...state, messages: action.messages, loading: false }
    case 'ERROR':
      return { ...state, error: action.error, loading: false }
  }
}

const initialState: State = { messages: [], loading: false, error: null, fetchedId: null }

export function useSession(sessionId: string | null) {
  const [state, dispatch] = useReducer(reducer, initialState)

  // sessionId 變更時在 render phase 重置
  if (sessionId !== state.fetchedId) {
    dispatch({ type: 'RESET', sessionId })
  }

  useEffect(() => {
    if (!sessionId) return

    let cancelled = false

    window.api.loadSession(sessionId)
      .then((data) => {
        if (!cancelled) dispatch({ type: 'SUCCESS', messages: data })
      })
      .catch((err: unknown) => {
        if (!cancelled) dispatch({ type: 'ERROR', error: err instanceof Error ? err.message : String(err) })
      })

    return () => { cancelled = true }
  }, [sessionId])

  return { messages: state.messages, loading: state.loading, error: state.error }
}
