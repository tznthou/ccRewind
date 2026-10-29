import { describe, it, expect, vi, afterEach } from 'vitest'

// Mock electron — 必須在 import updater 之前
vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.5.2'),
  },
  shell: {
    openExternal: vi.fn(() => Promise.resolve()),
  },
}))

import { shell } from 'electron'
import { parseVersion, compareVersions, safeReleaseUrl, checkForUpdates, openReleasePage } from '../src/main/updater'

const RELEASES_PAGE = 'https://github.com/tznthou/ccRewind/releases'

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

describe('safeReleaseUrl', () => {
  it.each([
    'https://github.com/tznthou/ccRewind/releases/tag/v1.28.0',
    'https://github.com/tznthou/ccRewind/releases/latest',
  ])('keeps %s', (url) => {
    expect(safeReleaseUrl(url)).toBe(url)
  })

  it('returns the parsed URL, not the raw string', () => {
    expect(safeReleaseUrl('https://github.com/tznthou/ccRewind/releases/tag/./v1.28.0'))
      .toBe('https://github.com/tznthou/ccRewind/releases/tag/v1.28.0')
  })

  it.each([
    ['another host', 'https://evil.example/tznthou/ccRewind/releases/tag/v1.28.0'],
    ['a host that starts with github.com', 'https://github.com.evil.example/tznthou/ccRewind/releases/tag/v1.28.0'],
    ['http', 'http://github.com/tznthou/ccRewind/releases/tag/v1.28.0'],
    ['another repo', 'https://github.com/someone/ccRewind/releases/tag/v1.28.0'],
    ['a path that only starts with "releases"', 'https://github.com/tznthou/ccRewind/releasesx/tag/v1.28.0'],
    ['the prefix in upper case', 'HTTPS://GITHUB.COM/tznthou/ccRewind/releases/tag/v1.28.0'],
    ['dot segments', 'https://github.com/tznthou/ccRewind/releases/../../evil/releases/tag/v1'],
    ['encoded dot segments', 'https://github.com/tznthou/ccRewind/releases/%2e%2e/%2E%2e/evil/x'],
    ['backslashes', 'https://github.com/tznthou/ccRewind/releases/..\\..\\evil\\x'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a file: URL', 'file:///Applications/Calculator.app'],
    ['text that is not a URL', 'not a url'],
    ['an empty string', ''],
  ])('falls back to the releases page for %s', (_label, url) => {
    expect(safeReleaseUrl(url)).toBe(RELEASES_PAGE)
  })
})

describe('checkForUpdates and openReleasePage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.mocked(shell.openExternal).mockClear()
  })

  function respondWith(release: Record<string, unknown>): void {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => release })))
  }

  it('opens the html_url of a release in this repo', async () => {
    const url = 'https://github.com/tznthou/ccRewind/releases/tag/v99.0.0'
    respondWith({ tag_name: 'v99.0.0', html_url: url })
    expect(await checkForUpdates()).toMatchObject({ status: 'available', releaseUrl: url })
    openReleasePage()
    expect(shell.openExternal).toHaveBeenCalledWith(url)
  })

  it('opens the releases page instead of an html_url outside this repo\'s releases', async () => {
    respondWith({ tag_name: 'v99.0.0', html_url: 'https://evil.example/download' })
    expect(await checkForUpdates()).toMatchObject({ status: 'available', releaseUrl: RELEASES_PAGE })
    openReleasePage()
    expect(shell.openExternal).toHaveBeenCalledWith(RELEASES_PAGE)
  })

  it('opens the latest release when the response has no html_url', async () => {
    respondWith({ tag_name: 'v99.0.0' })
    expect(await checkForUpdates()).toMatchObject({ status: 'available', releaseUrl: `${RELEASES_PAGE}/latest` })
  })
})
