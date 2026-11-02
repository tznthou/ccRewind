#!/usr/bin/env node
// Every font file in the renderer build output must be one of the files listed in
// src/renderer/assets/fonts/licenses/fonts.json (matched by SHA-256), and no built CSS, JS or HTML may inline a font as
// a data: URI.
//
// tests/fontLicenses.test.ts only sees font files under src/ and url('./…') in fonts.css. A font that reaches the bundle
// another way (an npm package's stylesheet, an absolute or ../ URL, another CSS file) would ship without a license file
// or a Reserved Font Name check. Vite copies the assets CSS refers to byte for byte and only adds a hash to the file
// name, so hashing the build output covers every route. Run after `pnpm build`; electron-smoke runs it before checking
// the packaged licenses.
//
// Usage: node scripts/check-built-fonts.mjs [out-dir]   (default: out/renderer, relative to the repo root)
// Exit:  0 every built font is listed; 1 an unlisted font, a data: font, or no font file at all; 2 no build output.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = path.resolve(root, process.argv[2] ?? 'out/renderer')
if (!existsSync(out)) {
  console.error(`ERROR: ${out} does not exist (run pnpm build first)`)
  process.exit(2)
}

const manifest = JSON.parse(readFileSync(path.join(root, 'src/renderer/assets/fonts/licenses/fonts.json'), 'utf8'))
const listed = new Map(manifest.fonts.map(e => [e.sha256, e.file]))
const FONT_FILE = /\.(woff2?|ttf|otf|ttc|otc|eot)$/i
const TEXT_FILE = /\.(css|js|mjs|html)$/i
const DATA_FONT = /data:(font\/|application\/(x-)?font)/i

const problems = []
const fonts = []
for (const rel of readdirSync(out, { recursive: true }).map(String)) {
  const file = path.join(out, rel)
  if (FONT_FILE.test(rel)) {
    const sha = createHash('sha256').update(readFileSync(file)).digest('hex')
    if (listed.has(sha)) fonts.push(`${rel} = ${listed.get(sha)}`)
    else problems.push(`${rel}: not in fonts.json (sha256 ${sha})`)
  } else if (TEXT_FILE.test(rel) && DATA_FONT.test(readFileSync(file, 'utf8'))) {
    problems.push(`${rel}: inlines a font as a data: URI`)
  }
}
// The app bundles fonts, so finding none means the walk looked in the wrong place.
if (fonts.length === 0 && problems.length === 0) problems.push(`no font files under ${out}`)

if (problems.length > 0) {
  for (const p of problems) console.error(`ERROR: ${p}`)
  process.exit(1)
}
console.log(`OK: ${fonts.length} font files under ${out}, all listed in fonts.json`)
for (const f of fonts) console.log(`  ${f}`)
