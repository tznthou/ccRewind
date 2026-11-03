#!/usr/bin/env node
// Every script and stylesheet the built renderer's index.html refers to must exist in the build output.
//
// index.html loads theme-init.js and font-scale-init.js as classic scripts: they have to run before React mounts, and
// the CSP allows no inline script. Vite neither bundles nor copies a script without type="module" unless it sits in the
// public directory, so from v0.5.0 the packaged app shipped an index.html pointing at two files that were not there, and
// the saved theme and font size were only applied once React ran. The dev server serves src/renderer as it is, so dev
// never showed it. Run after `pnpm build`; electron-smoke runs it on macOS and Windows.
//
// A reference starting with "/" fails too: the packaged app loads index.html from a file:// URL, where it would point
// at the root of the disk. So does one with a scheme (http:, data:, //host): the CSP only allows 'self'. So does one
// that resolves outside the output folder (../): the checkout may have that file, the package does not.
//
// Usage: node scripts/check-built-html-refs.mjs [out-dir]   (default: out/renderer, relative to the repo root)
// Exit:  0 every reference resolves; 1 a missing file, a root-relative or external reference, or no reference at all;
//        2 no index.html in the output.
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = path.resolve(root, process.argv[2] ?? 'out/renderer')
const indexFile = path.join(out, 'index.html')
if (!existsSync(indexFile)) {
  console.error(`ERROR: ${indexFile} does not exist (run pnpm build first)`)
  process.exit(2)
}

// Comments first: a commented-out tag is not loaded and must not count either way
const html = readFileSync(indexFile, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
const REF = /<(script|link)\b[^>]*?\s(src|href)\s*=\s*(["'])(.*?)\3/gi
const SCHEME = /^([a-z][a-z0-9+.-]*:|\/\/)/i

const problems = []
const found = []
for (const [, tag, attr, , value] of html.matchAll(REF)) {
  const ref = `<${tag} ${attr}="${value}">`
  if (SCHEME.test(value)) {
    problems.push(`${ref}: external or data: reference (the CSP only allows files of the app itself)`)
    continue
  }
  if (value.startsWith('/')) {
    problems.push(`${ref}: starts with "/", which points at the root of the disk under file://`)
    continue
  }
  const file = path.resolve(out, value.split(/[?#]/)[0])
  const rel = path.relative(out, file)
  // ../ can reach a file the checkout has but the package does not (electron-builder only takes out/**)
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    problems.push(`${ref}: points outside the build output (${rel})`)
  } else if (existsSync(file) && statSync(file).isFile()) {
    found.push(`${ref} -> ${rel}`)
  } else {
    problems.push(`${ref}: ${rel || '.'} is not a file in the build output`)
  }
}
// The built page always loads its bundle and stylesheet, so finding no reference means the parsing broke.
if (found.length === 0 && problems.length === 0) problems.push(`no <script src> or <link href> in ${indexFile}`)

if (problems.length > 0) {
  for (const p of problems) console.error(`ERROR: ${p}`)
  process.exit(1)
}
console.log(`OK: ${found.length} references in ${indexFile}, all in the build output`)
for (const f of found) console.log(`  ${f}`)
