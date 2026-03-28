import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { decodeProjectPath, scanProjects } from '../src/main/scanner'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ccrewind-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('decodeProjectPath', () => {
  it('decodes standard macOS path', () => {
    expect(decodeProjectPath('-Users-tznthou-Documents-ccRwind'))
      .toBe('/Users/tznthou/Documents/ccRwind')
  })

  it('decodes Linux path', () => {
    expect(decodeProjectPath('-home-user-projects-app'))
      .toBe('/home/user/projects/app')
  })

  it('path with hyphen in component gets decoded too (known limitation)', () => {
    // cc-mate → cc/mate — this is a known limitation
    const result = decodeProjectPath('-Users-tznthou-Documents-cc-mate')
    expect(result).toBe('/Users/tznthou/Documents/cc/mate')
  })
})

describe('scanProjects', () => {
  it('returns project list with sessions', async () => {
    // 建立兩個專案目錄
    const proj1 = path.join(tmpDir, '-Users-test-proj1')
    const proj2 = path.join(tmpDir, '-Users-test-proj2')
    await mkdir(proj1)
    await mkdir(proj2)

    // 寫入 JSONL 檔案
    await writeFile(path.join(proj1, 'aaa-111.jsonl'), '{"type":"user"}\n')
    await writeFile(path.join(proj1, 'bbb-222.jsonl'), '{"type":"user"}\n')
    await writeFile(path.join(proj2, 'ccc-333.jsonl'), '{"type":"user"}\n')

    const result = await scanProjects(tmpDir)
    expect(result).toHaveLength(2)

    const p1 = result.find(p => p.projectId === '-Users-test-proj1')
    expect(p1).toBeDefined()
    expect(p1!.displayName).toBe('/Users/test/proj1')
    expect(p1!.sessions).toHaveLength(2)
    expect(p1!.sessions[0].sessionId).toMatch(/^(aaa-111|bbb-222)$/)

    const p2 = result.find(p => p.projectId === '-Users-test-proj2')
    expect(p2).toBeDefined()
    expect(p2!.sessions).toHaveLength(1)
  })

  it('empty dir → returns empty array', async () => {
    const result = await scanProjects(tmpDir)
    expect(result).toEqual([])
  })

  it('non-existent dir → returns empty array', async () => {
    const result = await scanProjects(path.join(tmpDir, 'does-not-exist'))
    expect(result).toEqual([])
  })

  it('ignores directories not starting with -', async () => {
    await mkdir(path.join(tmpDir, 'memory'))
    await mkdir(path.join(tmpDir, '-Users-test-proj'))
    await writeFile(path.join(tmpDir, '-Users-test-proj', 'sess.jsonl'), '{}')

    const result = await scanProjects(tmpDir)
    expect(result).toHaveLength(1)
    expect(result[0].projectId).toBe('-Users-test-proj')
  })

  it('ignores non-jsonl files', async () => {
    const projDir = path.join(tmpDir, '-Users-test-proj')
    await mkdir(projDir)
    await writeFile(path.join(projDir, 'session.jsonl'), '{}')
    await writeFile(path.join(projDir, 'notes.txt'), 'not a session')
    await writeFile(path.join(projDir, 'meta.json'), '{}')

    const result = await scanProjects(tmpDir)
    expect(result[0].sessions).toHaveLength(1)
    expect(result[0].sessions[0].sessionId).toBe('session')
  })

  it('does not recurse into subdirectories', async () => {
    const projDir = path.join(tmpDir, '-Users-test-proj')
    const subDir = path.join(projDir, 'some-uuid', 'subagents')
    await mkdir(subDir, { recursive: true })
    await writeFile(path.join(projDir, 'main.jsonl'), '{}')
    await writeFile(path.join(subDir, 'agent-abc.jsonl'), '{}')

    const result = await scanProjects(tmpDir)
    expect(result[0].sessions).toHaveLength(1)
    expect(result[0].sessions[0].sessionId).toBe('main')
  })

  it('session has correct file metadata', async () => {
    const projDir = path.join(tmpDir, '-Users-test-proj')
    await mkdir(projDir)
    await writeFile(path.join(projDir, 'sess.jsonl'), '{"type":"user"}\n')

    const result = await scanProjects(tmpDir)
    const session = result[0].sessions[0]
    expect(session.fileSize).toBeGreaterThan(0)
    expect(session.fileMtime).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(session.filePath).toBe(path.join(projDir, 'sess.jsonl'))
  })
})
