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
  it.each(['v1.28.0', 'v10.20.30'])('keeps the release page of %s', (tag) => {
    const url = `https://github.com/tznthou/ccRewind/releases/tag/${tag}`
    expect(safeReleaseUrl(url, tag)).toBe(url)
  })

  it.each([
    ['the page of another tag', 'https://github.com/tznthou/ccRewind/releases/tag/v1.27.3', 'v1.28.0'],
    ['a release download', 'https://github.com/tznthou/ccRewind/releases/download/v1.28.0/ccrewind-1.28.0-mac-arm64.zip', 'v1.28.0'],
    ['the latest release', 'https://github.com/tznthou/ccRewind/releases/latest', 'v1.28.0'],
    ['"..;" segments, which github.com reads as ".."', 'https://github.com/tznthou/ccRewind/releases/..;/..;/..;/electron/electron/releases/tag/v44.9.3', 'v44.9.3'],
    ['a dot segment in the tag page', 'https://github.com/tznthou/ccRewind/releases/tag/./v1.28.0', 'v1.28.0'],
    ['a tag with path characters', 'https://github.com/tznthou/ccRewind/releases/tag/v1.28.0/../../../someone/repo', 'v1.28.0/../../../someone/repo'],
    ['a tag ending in ";"', 'https://github.com/tznthou/ccRewind/releases/tag/v1.28.0;', 'v1.28.0;'],
    ['a tag with a line break', 'https://github.com/tznthou/ccRewind/releases/tag/v1.28.0\n/../../../../../someone/repo', 'v1.28.0\n/../../../../../someone/repo'],
    ['a tag that only ends like a version', 'https://github.com/tznthou/ccRewind/releases/tag/..;/..;/..;/..;/someone/repo/releases/tag/v9.9.9', '..;/..;/..;/..;/someone/repo/releases/tag/v9.9.9'],
    ['a path after the tag page', 'https://github.com/tznthou/ccRewind/releases/tag/v1.28.0/..;/..;/..;/..;/someone/repo', 'v1.28.0'],
    ['a tag without the v', 'https://github.com/tznthou/ccRewind/releases/tag/1.28.0', '1.28.0'],
    ['a pre-release tag', 'https://github.com/tznthou/ccRewind/releases/tag/v2.0.0-beta.1', 'v2.0.0-beta.1'],
    ['another host', 'https://evil.example/tznthou/ccRewind/releases/tag/v1.28.0', 'v1.28.0'],
    ['a host that starts with github.com', 'https://github.com.evil.example/tznthou/ccRewind/releases/tag/v1.28.0', 'v1.28.0'],
    ['http', 'http://github.com/tznthou/ccRewind/releases/tag/v1.28.0', 'v1.28.0'],
    ['another repo', 'https://github.com/someone/ccRewind/releases/tag/v1.28.0', 'v1.28.0'],
    ['the page in upper case', 'HTTPS://GITHUB.COM/tznthou/ccRewind/releases/tag/v1.28.0', 'v1.28.0'],
    ['encoded dot segments', 'https://github.com/tznthou/ccRewind/releases/%2e%2e/%2E%2e/evil/x', 'v1.28.0'],
    ['backslashes', 'https://github.com/tznthou/ccRewind/releases/..\\..\\evil\\x', 'v1.28.0'],
    ['a javascript: URL', 'javascript:alert(1)', 'v1.28.0'],
    ['a file: URL', 'file:///Applications/Calculator.app', 'v1.28.0'],
    ['text that is not a URL', 'not a url', 'v1.28.0'],
    ['an empty string', '', 'v1.28.0'],
  ])('falls back to the releases page for %s', (_label, url, tag) => {
    expect(safeReleaseUrl(url, tag)).toBe(RELEASES_PAGE)
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

  it('opens the html_url when it is this release\'s page', async () => {
    const url = 'https://github.com/tznthou/ccRewind/releases/tag/v99.0.0'
    respondWith({ tag_name: 'v99.0.0', html_url: url })
    expect(await checkForUpdates()).toMatchObject({ status: 'available', releaseUrl: url })
    openReleasePage()
    expect(shell.openExternal).toHaveBeenCalledWith(url)
  })

  it('opens the releases page instead of an html_url that is not this release\'s page', async () => {
    respondWith({ tag_name: 'v99.0.0', html_url: 'https://evil.example/download' })
    expect(await checkForUpdates()).toMatchObject({ status: 'available', releaseUrl: RELEASES_PAGE })
    openReleasePage()
    expect(shell.openExternal).toHaveBeenCalledWith(RELEASES_PAGE)
  })

  it('opens the latest release when the response has no html_url', async () => {
    respondWith({ tag_name: 'v99.0.0' })
    expect(await checkForUpdates()).toMatchObject({ status: 'available', releaseUrl: `${RELEASES_PAGE}/latest` })
    openReleasePage()
    expect(shell.openExternal).toHaveBeenCalledWith(`${RELEASES_PAGE}/latest`)
  })
})
