import { describe, it, expect } from 'vitest'
import { ESLint } from 'eslint'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * `.claude/`（本機的驗證工具）和 `.draft/`（截圖與草稿）都在 .gitignore 裡，CI 看不到它們；
 * 但 flat config 不讀 .gitignore，本機跑 `pnpm lint`（`eslint . --fix`）會掃進去報錯，還會就地改那些檔。
 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

describe('eslint 略過本機的工具與草稿資料夾', () => {
  const eslint = new ESLint({ cwd: REPO_ROOT })

  it.each([
    '.claude/ui-verify-tools/drive-tb.mjs',
    '.claude/mockup-tools/shot-electron.cjs',
    '.claude/ui-verify-tools/crosscheck.ts',
    '.draft/probe.js',
  ])('略過 %s', async file => {
    expect(await eslint.isPathIgnored(path.join(REPO_ROOT, file))).toBe(true)
  })

  // 對照組：ignore 寫得太寬（例如整個副檔名）時這裡會紅
  it.each(['src/renderer/main.tsx', 'scripts/readme-fixture.mjs', 'tests/eslintIgnores.test.ts'])('照掃 %s', async file => {
    expect(await eslint.isPathIgnored(path.join(REPO_ROOT, file))).toBe(false)
  })
})
