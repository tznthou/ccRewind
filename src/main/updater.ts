import { app, shell } from 'electron'
import type { UpdateState } from '../shared/types'

const GITHUB_OWNER = 'tznthou'
const GITHUB_REPO = 'ccRewind'
const RELEASES_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
const REPO_RELEASES_PAGE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`

// ── 版本比對 ──

/** 解析版本字串為數字陣列，例如 "v0.5.10" → [0, 5, 10] */
export function parseVersion(version: string): number[] {
  const cleaned = version.replace(/^v/, '')
  return cleaned.split('.').map((s) => {
    const n = parseInt(s, 10)
    return Number.isNaN(n) ? 0 : n
  })
}

/** 比較兩個版本：回傳 1 (a > b), -1 (a < b), 0 (相等) */
export function compareVersions(a: string, b: string): number {
  const partsA = parseVersion(a)
  const partsB = parseVersion(b)
  const len = Math.max(partsA.length, partsB.length)
  for (let i = 0; i < len; i++) {
    const numA = partsA[i] ?? 0
    const numB = partsB[i] ?? 0
    if (numA > numB) return 1
    if (numA < numB) return -1
  }
  return 0
}

// ── 更新檢查 ──

/** 當次 session 被略過的版本（記憶體，重啟即清除） */
let dismissedVersion: string | null = null

let cachedState: UpdateState = {
  status: 'idle',
  currentVersion: '',
  latestVersion: null,
  releaseUrl: null,
}

let inflight: Promise<UpdateState> | null = null

export function getUpdateState(): UpdateState {
  return { ...cachedState }
}

export async function checkForUpdates(): Promise<UpdateState> {
  // 去重：同一時間只發一個請求
  if (inflight) return inflight

  inflight = doCheck().finally(() => { inflight = null })
  return inflight
}

async function doCheck(): Promise<UpdateState> {
  const currentVersion = app.getVersion()

  cachedState = { status: 'checking', currentVersion, latestVersion: null, releaseUrl: null }

  try {
    const res = await fetch(RELEASES_URL, {
      headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': `ccRewind/${currentVersion}` },
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      cachedState = { status: 'error', currentVersion, latestVersion: null, releaseUrl: null }
      return cachedState
    }

    const data: unknown = await res.json()
    if (!data || typeof data !== 'object' || !('tag_name' in data) || typeof (data as Record<string, unknown>).tag_name !== 'string') {
      cachedState = { status: 'error', currentVersion, latestVersion: null, releaseUrl: null }
      return cachedState
    }

    const release = data as { tag_name: string; html_url?: string }
    const latestVersion = release.tag_name.replace(/^v/, '')
    const releaseUrl = typeof release.html_url === 'string' ? release.html_url : `${REPO_RELEASES_PAGE}/latest`

    if (compareVersions(latestVersion, currentVersion) <= 0) {
      cachedState = { status: 'latest', currentVersion, latestVersion, releaseUrl }
      return cachedState
    }

    // 當次 session 已略過此版本
    if (dismissedVersion === latestVersion) {
      cachedState = { status: 'dismissed', currentVersion, latestVersion, releaseUrl }
      return cachedState
    }

    cachedState = { status: 'available', currentVersion, latestVersion, releaseUrl }
    return cachedState
  } catch (err) {
    console.warn('Update check failed:', err)
    cachedState = { status: 'error', currentVersion, latestVersion: null, releaseUrl: null }
    return cachedState
  }
}

// ── 使用者操作 ──

export function openReleasePage(): void {
  const url = cachedState.releaseUrl || `${REPO_RELEASES_PAGE}/latest`
  shell.openExternal(url).catch(() => {})
}

export function dismissUpdate(version: string): void {
  const normalized = version.replace(/^v/, '')
  dismissedVersion = normalized

  if (cachedState.latestVersion === normalized) {
    cachedState = { ...cachedState, status: 'dismissed' }
  }
}
