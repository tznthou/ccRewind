import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { watchIdle } from '../../src/renderer/components/ChatView/idleWatcher'

const IDLE_MS = 2000

describe('watchIdle', () => {
  let target: EventTarget
  let calls: boolean[]
  const fire = (type = 'scroll') => target.dispatchEvent(new Event(type))

  beforeEach(() => {
    vi.useFakeTimers()
    target = new EventTarget()
    calls = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports nothing before the first event', () => {
    watchIdle(target, ['scroll'], IDLE_MS, a => calls.push(a))
    vi.advanceTimersByTime(IDLE_MS * 5)
    expect(calls).toEqual([])
  })

  it('reports active once on the first event and stays silent while events keep coming', () => {
    watchIdle(target, ['scroll'], IDLE_MS, a => calls.push(a))
    fire()
    vi.advanceTimersByTime(IDLE_MS - 500)
    fire()
    vi.advanceTimersByTime(IDLE_MS - 500)
    fire()
    expect(calls).toEqual([true])
  })

  it('reports inactive exactly when the idle window passes without events', () => {
    watchIdle(target, ['scroll'], IDLE_MS, a => calls.push(a))
    fire()
    vi.advanceTimersByTime(IDLE_MS - 1)
    expect(calls).toEqual([true])
    vi.advanceTimersByTime(1)
    expect(calls).toEqual([true, false])
  })

  it('wakes again on the next event after going idle', () => {
    watchIdle(target, ['scroll'], IDLE_MS, a => calls.push(a))
    fire()
    vi.advanceTimersByTime(IDLE_MS)
    fire()
    expect(calls).toEqual([true, false, true])
  })

  it('treats every listed event type as activity', () => {
    watchIdle(target, ['scroll', 'mousemove'], IDLE_MS, a => calls.push(a))
    fire('mousemove')
    vi.advanceTimersByTime(IDLE_MS - 500)
    fire('scroll') // 重置計時, 所以原本的到期點不該回報 idle
    vi.advanceTimersByTime(500)
    expect(calls).toEqual([true])
    vi.advanceTimersByTime(IDLE_MS - 500)
    expect(calls).toEqual([true, false])
  })

  it('ignores event types it was not asked to watch', () => {
    watchIdle(target, ['scroll'], IDLE_MS, a => calls.push(a))
    fire('click')
    vi.advanceTimersByTime(IDLE_MS)
    expect(calls).toEqual([])
  })

  it('dispose removes the listeners and cancels the pending idle report', () => {
    const dispose = watchIdle(target, ['scroll', 'mousemove'], IDLE_MS, a => calls.push(a))
    fire()
    dispose()
    vi.advanceTimersByTime(IDLE_MS * 5)
    fire('scroll')
    fire('mousemove')
    expect(calls).toEqual([true])
  })
})
