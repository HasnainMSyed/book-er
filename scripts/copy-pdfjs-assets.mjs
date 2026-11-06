// Copies the font, character map and image decoder files that pdf.js loads
// at runtime into public/pdfjs, so they are served (and cached offline).
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pdfjsRoot = dirname(require.resolve('pdfjs-dist/package.json'))
const out = join(import.meta.dirname, '..', 'public', 'pdfjs')

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
for (const dir of ['cmaps', 'standard_fonts', 'iccs']) {
  cpSync(join(pdfjsRoot, dir), join(out, dir), { recursive: true })
}
// Image decoders only. quickjs-eval is for PDF scripting, which we never enable.
cpSync(join(pdfjsRoot, 'wasm'), join(out, 'wasm'), {
  recursive: true,
  filter: (src) => !src.includes('quickjs'),
})
console.log('Copied pdf.js assets to public/pdfjs')
