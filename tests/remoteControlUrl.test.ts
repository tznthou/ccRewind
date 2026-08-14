// bridgeSessionId → claude.ai 連結的組成規則。
//
// 規律來源：JSONL 的 bridge-session entry 帶 `cse_<id>`，而該 session 在 claude.ai 上的
// 網址是 `https://claude.ai/code/session_<同一個 id>`。2026-08-14 用兩個 session 驗證過，
// 其中一個是先推導出網址、再實際開啟確認內容相符（不是拿已知網址反推）。
//
// bridgeSessionId 來自 JSONL，屬於外部輸入，所以格式採白名單而非「拼上去就好」——
// 一個帶 ../ 或含冒號的值若直接串進網址，點下去會把使用者帶到非預期的地方。
import { describe, it, expect } from 'vitest'
import { buildRemoteControlUrl } from '../src/shared/remoteControl'

describe('buildRemoteControlUrl', () => {
  it('把 cse_ 前綴換成 session_ 組出 claude.ai 連結', () => {
    expect(buildRemoteControlUrl('cse_01EGNHv8EmxwAyZtUQUMD7uy'))
      .toBe('https://claude.ai/code/session_01EGNHv8EmxwAyZtUQUMD7uy')
  })

  it('沒有 bridgeSessionId 時回 null（多數歷史 session 屬於這類）', () => {
    expect(buildRemoteControlUrl(null)).toBeNull()
    expect(buildRemoteControlUrl(undefined)).toBeNull()
    expect(buildRemoteControlUrl('')).toBeNull()
  })

  it('前綴不是 cse_ 就回 null，不猜測未知格式', () => {
    expect(buildRemoteControlUrl('session_01EGNHv8EmxwAyZtUQUMD7uy')).toBeNull()
    expect(buildRemoteControlUrl('01EGNHv8EmxwAyZtUQUMD7uy')).toBeNull()
    expect(buildRemoteControlUrl('xyz_01EGNHv8EmxwAyZtUQUMD7uy')).toBeNull()
  })

  it('只有前綴、沒有 id 主體時回 null', () => {
    expect(buildRemoteControlUrl('cse_')).toBeNull()
  })

  it('id 主體含非英數字元一律拒絕（避免把使用者導到別的地方）', () => {
    expect(buildRemoteControlUrl('cse_../../evil.com')).toBeNull()
    expect(buildRemoteControlUrl('cse_abc/def')).toBeNull()
    expect(buildRemoteControlUrl('cse_abc?x=1')).toBeNull()
    expect(buildRemoteControlUrl('cse_abc#frag')).toBeNull()
    expect(buildRemoteControlUrl('cse_abc def')).toBeNull()
    expect(buildRemoteControlUrl('cse_@evil.com')).toBeNull()
    expect(buildRemoteControlUrl('cse_abc:80')).toBeNull()
  })

  it('拒絕長度異常的值（正常 id 是 24 碼）', () => {
    expect(buildRemoteControlUrl('cse_' + 'a'.repeat(200))).toBeNull()
  })

  it('組出來的網址一定落在 claude.ai/code/ 底下', () => {
    const url = buildRemoteControlUrl('cse_01EGNHv8EmxwAyZtUQUMD7uy')!
    const parsed = new URL(url)
    expect(parsed.protocol).toBe('https:')
    expect(parsed.host).toBe('claude.ai')
    expect(parsed.pathname.startsWith('/code/session_')).toBe(true)
  })
})
