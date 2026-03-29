import { describe, it, expect, vi } from 'vitest'

// Mock electron — 必須在 import updater 之前
vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.5.2'),
  },
  shell: {
    openExternal: vi.fn(),
  },
}))

import { parseVersion, compareVersions } from '../src/main/updater'

describe('parseVersion', () => {
  it('strips leading v and splits into numbers', () => {
    expect(parseVersion('v0.5.2')).toEqual([0, 5, 2])
  })

  it('handles version without v prefix', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3])
  })

  it('handles single segment', () => {
    expect(parseVersion('5')).toEqual([5])
  })

  it('treats non-numeric segments as 0', () => {
    expect(parseVersion('1.beta.3')).toEqual([1, 0, 3])
  })
})

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('0.5.2', '0.5.2')).toBe(0)
  })

  it('returns 0 for equal versions with v prefix', () => {
    expect(compareVersions('v0.5.2', '0.5.2')).toBe(0)
  })

  it('returns 1 when a > b', () => {
    expect(compareVersions('0.6.0', '0.5.2')).toBe(1)
  })

  it('returns -1 when a < b', () => {
    expect(compareVersions('0.5.2', '0.6.0')).toBe(-1)
  })

  it('compares numerically, not lexically (0.5.10 > 0.5.2)', () => {
    expect(compareVersions('0.5.10', '0.5.2')).toBe(1)
  })

  it('handles different segment lengths', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.1', '1.0')).toBe(1)
  })

  it('handles major version differences', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1)
  })
})
