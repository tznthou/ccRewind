import { describe, it, expect } from 'vitest'
import { appReducer, initialState, type AppState } from '../src/renderer/context/AppContext'

const stateWithSearch: AppState = {
  ...initialState,
  selectedProjectId: 'proj-A',
  selectedSessionId: 'sess-old',
  searchQuery: 'hello',
  searchResults: [
    { sessionId: 'x', sessionTitle: null, projectId: 'proj-A', projectName: 'A', messageId: 1, snippet: 's', timestamp: null, sessionStartedAt: null },
  ],
  searchHasMore: true,
  searchProjectId: null,
  targetMessageId: 42,
}

describe('appReducer / NAVIGATE_TO_SESSION', () => {
  it('atomically updates projectId + sessionId', () => {
    const next = appReducer(stateWithSearch, {
      type: 'NAVIGATE_TO_SESSION',
      projectId: 'proj-B',
      sessionId: 'sess-new',
    })
    expect(next.selectedProjectId).toBe('proj-B')
    expect(next.selectedSessionId).toBe('sess-new')
  })

  it('preserves search state across cross-project navigation', () => {
    const next = appReducer(stateWithSearch, {
      type: 'NAVIGATE_TO_SESSION',
      projectId: 'proj-B',
      sessionId: 'sess-new',
    })
    expect(next.searchQuery).toBe('hello')
    expect(next.searchResults).toBe(stateWithSearch.searchResults)
    expect(next.searchHasMore).toBe(true)
  })

  it('sets targetMessageId to null when messageId omitted', () => {
    const next = appReducer(stateWithSearch, {
      type: 'NAVIGATE_TO_SESSION',
      projectId: 'proj-B',
      sessionId: 'sess-new',
    })
    expect(next.targetMessageId).toBeNull()
  })

  it('sets targetMessageId when messageId provided (message-search flow)', () => {
    const next = appReducer(stateWithSearch, {
      type: 'NAVIGATE_TO_SESSION',
      projectId: 'proj-B',
      sessionId: 'sess-new',
      messageId: 999,
    })
    expect(next.targetMessageId).toBe(999)
  })

  it('works for same-project navigation (idempotent on projectId)', () => {
    const next = appReducer(stateWithSearch, {
      type: 'NAVIGATE_TO_SESSION',
      projectId: 'proj-A',
      sessionId: 'sess-other',
    })
    expect(next.selectedProjectId).toBe('proj-A')
    expect(next.selectedSessionId).toBe('sess-other')
    expect(next.searchQuery).toBe('hello')
  })
})

describe('appReducer / ANNOUNCE', () => {
  it('starts with empty message and seq=0', () => {
    expect(initialState.liveAnnouncement).toEqual({ message: '', seq: 0 })
  })

  it('increments seq each ANNOUNCE so same message re-fires', () => {
    const a = appReducer(initialState, { type: 'ANNOUNCE', message: 'found 3 results' })
    expect(a.liveAnnouncement).toEqual({ message: 'found 3 results', seq: 1 })

    const b = appReducer(a, { type: 'ANNOUNCE', message: 'found 3 results' })
    expect(b.liveAnnouncement).toEqual({ message: 'found 3 results', seq: 2 })
  })

  it('preserves liveAnnouncement across SELECT_PROJECT (transient channel)', () => {
    const announced = appReducer(initialState, { type: 'ANNOUNCE', message: 'sync complete' })
    const next = appReducer(announced, { type: 'SELECT_PROJECT', projectId: 'proj-X' })
    expect(next.liveAnnouncement).toEqual({ message: 'sync complete', seq: 1 })
    expect(next.selectedProjectId).toBe('proj-X')
    expect(next.searchResults).toEqual([])
  })
})
