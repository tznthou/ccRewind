#!/usr/bin/env node
// Every font file in the renderer build output must be one of the files listed in
// src/renderer/assets/fonts/licenses/fonts.json (matched by SHA-256), and no built CSS, JS or HTML may inline a font as
// a data: URL: no @font-face with a data: source, and no base64 data: URL whose bytes start with a font signature,
// whatever MIME type it claims (a font MIME check alone let data:application/x-woff and octet-stream through).
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
const FONT_FACE_DATA = /@font-face\s*\{[^}]*?data:/i
const BASE64_DATA_URL = /data:[^,'"()\s]*;base64,([A-Za-z0-9+/]{8})/g
// WOFF2, WOFF, OpenType (CFF), font collection, TrueType. Not Apple's old 'true': base64 JSON `true` starts the same.
const FONT_SIGNATURES = ['wOF2', 'wOFF', 'OTTO', 'ttcf', '\0\x01\0\0']

function inlinedFont(text) {
  if (FONT_FACE_DATA.test(text)) return '@font-face with a data: source'
  for (const m of text.matchAll(BASE64_DATA_URL)) {
    const head = Buffer.from(m[1], 'base64').toString('latin1').slice(0, 4)
    if (FONT_SIGNATURES.includes(head)) return `a data: URL holding a font (${JSON.stringify(head)})`
  }
  return null
}

const problems = []
const fonts = []
for (const rel of readdirSync(out, { recursive: true }).map(String)) {
  const file = path.join(out, rel)
  if (FONT_FILE.test(rel)) {
    const sha = createHash('sha256').update(readFileSync(file)).digest('hex')
    if (listed.has(sha)) fonts.push(`${rel} = ${listed.get(sha)}`)
    else problems.push(`${rel}: not in fonts.json (sha256 ${sha})`)
  } else if (TEXT_FILE.test(rel)) {
    const why = inlinedFont(readFileSync(file, 'utf8'))
    if (why) problems.push(`${rel}: inlines a font (${why})`)
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
