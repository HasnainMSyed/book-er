// Turns the positioned text fragments in a PDF back into headings and
// paragraphs that can be re-wrapped at any font size.
//
// PDFs don't store paragraphs, only "draw this text at x,y". So we:
//   1. group fragments into lines on each page,
//   2. drop running headers, footers and page numbers,
//   3. learn the book's normal text size, line spacing and margins,
//   4. decide where paragraphs start (indent, extra space, short last line),
//   5. rejoin words that were hyphenated across lines.

import type { Block, BookText, TocItem } from './db'
import type { PDFDocumentProxy } from './pdf'

type Line = { text: string; x: number; xEnd: number; y: number; size: number }
type PageLines = { lines: Line[]; top: number; bottom: number; width: number; height: number }

/**
 * Bump this whenever a change here would produce better text for books that
 * were already added. The app then quietly re-prepares those books.
 */
export const EXTRACT_VERSION = 2

/** Fraction of a page's height treated as the header/footer zone. */
const EDGE_ZONE = 0.12

export async function extractBook(
  doc: PDFDocumentProxy,
  onProgress?: (fraction: number) => void,
): Promise<BookText & { scannedRatio: number }> {
  const pages: PageLines[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    pages.push(await readLines(page))
    page.cleanup()
    if (n % 5 === 0 || n === doc.numPages) onProgress?.(n / doc.numPages)
  }

  removeHeadersAndFooters(pages)
  const blocks = buildBlocks(pages)
  const toc = await buildToc(doc, blocks)
  const scanned = pages.filter((p) => p.lines.length === 0).length
  return { blocks, toc, scannedRatio: pages.length ? scanned / pages.length : 0 }
}

// ---------- 1. lines ----------

type PageLike = Awaited<ReturnType<PDFDocumentProxy['getPage']>>

async function readLines(page: PageLike): Promise<PageLines> {
  const [x0, y0, x1, y1] = page.view
  const content = await page.getTextContent()
  const lines: Line[] = []
  let cur: (Line & { space: boolean; mainLength: number }) | null = null

  const push = () => {
    if (cur) {
      const text = cur.text.replace(/\s+/g, ' ').trim()
      if (text) lines.push({ text, x: cur.x, xEnd: cur.xEnd, y: cur.y, size: cur.size })
    }
    cur = null
  }

  const skip = findDuplicateDraws(content.items)

  for (const [index, item] of content.items.entries()) {
    if (!('str' in item) || skip.has(index)) continue
    const t = item.transform as number[]
    // Skip rotated text (stamps, sideways margin notes).
    if (Math.abs(t[1]) > 0.01 * Math.abs(t[0] || 1)) continue
    const size = Math.abs(t[3]) || item.height || 0
    const s = item.str

    if (!s.trim()) {
      if (cur && s.length) cur.space = true
      if (item.hasEOL) push()
      continue
    }

    const x = t[4]
    const y = t[5]
    // Same line = about the same height AND carrying on to the right. Text that
    // jumps back to the left is the next line, even if it sits very close
    // (like the first line of a chapter right under its big heading).
    const maxSize = cur ? Math.max(size, cur.size) : size
    const sameLine: boolean = cur !== null && Math.abs(y - cur.y) < maxSize * 0.5 && x > cur.xEnd - maxSize
    if (cur && sameLine) {
      const gap = x - cur.xEnd
      if (!cur.text.endsWith(' ') && !s.startsWith(' ') && (cur.space || gap > size * 0.15)) cur.text += ' '
      cur.text += s
      cur.xEnd = Math.max(cur.xEnd, x + item.width)
      // The line's size comes from its longest piece of text, so a big first
      // letter (drop cap) or a tiny footnote mark doesn't change it.
      if (s.length > cur.mainLength) {
        cur.mainLength = s.length
        cur.size = size
        cur.y = y
      }
      cur.space = false
    } else {
      push()
      cur = { text: s, x, xEnd: x + item.width, y, size, space: false, mainLength: s.length }
    }
    if (item.hasEOL) push()
  }
  push()

  return { lines, top: Math.max(y0, y1), bottom: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) }
}

type TextPiece = { str: string; transform: number[]; width: number; height: number }

/**
 * Some PDFs print the same text several times, slightly offset, to fake bold
 * or a shadow. Real text never shares its spot on a line with other text, so
 * any piece that sits inside a longer matching piece on the same line is a copy.
 */
function findDuplicateDraws(items: readonly unknown[]): Set<number> {
  const pieces = items
    .map((it, index) => ({ it: it as TextPiece, index }))
    .filter(({ it }) => typeof it.str === 'string' && it.str.trim() !== '')
    .map(({ it, index }) => ({
      index,
      str: it.str.trim(),
      x: it.transform[4],
      y: it.transform[5],
      w: it.width,
      size: Math.abs(it.transform[3]) || it.height || 1,
    }))
  // Longest first, so the fullest copy is the one kept.
  pieces.sort((a, b) => b.str.length - a.str.length || a.index - b.index)
  const kept: typeof pieces = []
  const skip = new Set<number>()
  for (const p of pieces) {
    const tol = p.size * 0.6
    const copy = kept.some(
      (k) =>
        Math.abs(k.y - p.y) < tol &&
        p.x >= k.x - tol &&
        p.x + p.w <= k.x + k.w + tol &&
        k.str.includes(p.str),
    )
    if (copy) skip.add(p.index)
    else kept.push(p)
  }
  return skip
}

// ---------- 2. headers, footers, page numbers ----------

const PAGE_NUMBER = /^[\s\-–—|•·.]*(page\s*)?(\d{1,4}|[ivxlcdm]{1,7})(\s*(of|\/)\s*\d{1,4})?[\s\-–—|•·.]*$/i

function edgeKey(text: string) {
  return text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()
}

function edgeCandidates(p: PageLines): Line[] {
  const zone = p.height * EDGE_ZONE
  const byY = [...p.lines].sort((a, b) => b.y - a.y)
  const atTop = byY.slice(0, 2).filter((l) => l.y > p.top - zone)
  const atBottom = byY.slice(-2).filter((l) => l.y < p.bottom + zone)
  return [...new Set([...atTop, ...atBottom])]
}

function removeHeadersAndFooters(pages: PageLines[]) {
  // Count how many pages each header/footer-looking line appears on
  // (with numbers ignored, so "Chapter 3 · 41" matches "Chapter 3 · 42").
  const counts = new Map<string, number>()
  for (const p of pages) {
    for (const key of new Set(edgeCandidates(p).map((l) => edgeKey(l.text)))) {
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  // Chapter-specific headers may only repeat across a few pages.
  const repeatThreshold = 3

  for (const p of pages) {
    const drop = new Set(
      edgeCandidates(p).filter(
        (l) => PAGE_NUMBER.test(l.text) || (pages.length >= 6 && (counts.get(edgeKey(l.text)) ?? 0) >= repeatThreshold),
      ),
    )
    if (drop.size) p.lines = p.lines.filter((l) => !drop.has(l))
  }
}

// ---------- 3. book-wide measurements ----------

function mode(values: number[]): number {
  const counts = new Map<number, number>()
  let best = values[0] ?? 0
  let bestCount = 0
  for (const v of values) {
    const c = (counts.get(v) ?? 0) + 1
    counts.set(v, c)
    if (c > bestCount) {
      best = v
      bestCount = c
    }
  }
  return best
}

const round = (n: number, step = 0.5) => Math.round(n / step) * step

function measure(pages: PageLines[]) {
  // Normal text size: the size that covers the most characters.
  const weight = new Map<number, number>()
  for (const p of pages) for (const l of p.lines) weight.set(round(l.size), (weight.get(round(l.size)) ?? 0) + l.text.length)
  let bodySize = 10
  let most = 0
  for (const [size, chars] of weight) if (chars > most) [bodySize, most] = [size, chars]

  const isBody = (l: Line) => Math.abs(l.size - bodySize) <= bodySize * 0.15

  // Normal distance between lines.
  const gaps: number[] = []
  for (const p of pages) {
    for (let i = 1; i < p.lines.length; i++) {
      const a = p.lines[i - 1]
      const b = p.lines[i]
      const gap = a.y - b.y
      if (isBody(a) && isBody(b) && gap > 0 && gap < bodySize * 3) gaps.push(round(gap))
    }
  }
  const lineGap = mode(gaps) || bodySize * 1.2

  // Left and right text edges per page (odd and even pages often differ).
  const margins = pages.map((p) => {
    const body = p.lines.filter(isBody)
    if (!body.length) return { left: 0, right: p.width }
    const xs = body.map((l) => Math.round(l.x))
    const seen = new Map<number, number>()
    for (const x of xs) seen.set(x, (seen.get(x) ?? 0) + 1)
    const repeated = xs.filter((x) => (seen.get(x) ?? 0) > 1)
    const left = Math.min(...(repeated.length ? repeated : xs))
    const right = Math.max(...body.map((l) => l.xEnd))
    return { left, right }
  })

  return { bodySize, lineGap, margins }
}

// ---------- 4 & 5. paragraphs ----------

const ENDS_SENTENCE = /[.!?…:;"”’)\]*—–]$/

/** Ends a sentence, ignoring a footnote number after it ("…any minute’.4"). */
function endsSentence(text: string) {
  return ENDS_SENTENCE.test(text.replace(/([.!?…"”’)])\s?[\d*†‡]{1,3}$/u, '$1'))
}

/** A short "Chapter 3" / "PART TWO" label printed above a chapter title. */
const CHAPTER_LABEL = /^(chapter|part|book|section)\s+[\p{L}\d]{1,12}\.?$/iu

/** "1. ", "a) ", "• " at the start of a line. */
const LIST_ITEM = /^(\d{1,3}[.)]|\(?[a-z]\)|[•●▪■◦∙‣])\s/u
const BULLET = /^[•●▪■◦∙‣]\s/u
/** The previous line could end a list item ("...rewards," / "...today;"). */
const ENDS_ITEM = /[.,;:!?)”’"]$/

/** Marks a line-end hyphen we can't judge yet ("waistcoat-" + "pocket" or "won-" + "derful"). */
const MAYBE_HYPHEN = ''

export function joinLines(a: string, b: string): string {
  if (a.endsWith('­')) return a.slice(0, -1) + b
  if (/\p{L}-$/u.test(a)) {
    // Lowercase after the hyphen: decided once the whole book is read.
    if (/^\p{Ll}/u.test(b)) return a.slice(0, -1) + MAYBE_HYPHEN + b
    // "Caucus-" + "Race" → "Caucus-Race" (a real hyphen that fell at the line end).
    if (/^\p{L}/u.test(b)) return a + b
  }
  return `${a} ${b}`
}

/**
 * For each word split across lines, checks how the book spells it elsewhere:
 * "book-shelves" stays hyphenated if that's how it appears, "won-derful" is
 * joined if "wonderful" appears or the hyphenated form never does.
 */
function resolveHyphens(blocks: Block[]) {
  const counts = new Map<string, number>()
  for (const b of blocks) {
    if (b.t === 'img') continue
    for (const w of b.text.toLowerCase().match(/[\p{L}-]+/gu) ?? []) counts.set(w, (counts.get(w) ?? 0) + 1)
  }
  const split = new RegExp(`(\\p{L}*)${MAYBE_HYPHEN}(\\p{L}*)`, 'gu')
  for (const b of blocks) {
    if (b.t === 'img' || !b.text.includes(MAYBE_HYPHEN)) continue
    b.text = b.text.replace(split, (_, left: string, right: string) => {
      const joined = (counts.get((left + right).toLowerCase()) ?? 0)
      const hyphenated = counts.get(`${left}-${right}`.toLowerCase()) ?? 0
      return hyphenated > joined ? `${left}-${right}` : left + right
    })
  }
}

/** Width of the first word of `next`, estimated from `next`'s own letter spacing. */
function firstWordWidth(next: Line) {
  const word = next.text.split(' ')[0] ?? ''
  const perChar = (next.xEnd - next.x) / Math.max(1, next.text.length)
  return word.length * perChar
}

function buildBlocks(pages: PageLines[]): Block[] {
  const { bodySize, lineGap, margins } = measure(pages)
  const blocks: Block[] = []
  let para: { text: string; page: number; x: number; list: boolean } | null = null
  let prev: { line: Line; right: number; heading: boolean } | null = null

  const flush = () => {
    if (para) blocks.push({ t: 'p', text: para.text, page: para.page })
    para = null
  }

  pages.forEach((p, idx) => {
    const pageNum = idx + 1
    const { left, right } = margins[idx]

    if (!p.lines.length) {
      flush()
      blocks.push({ t: 'img', page: pageNum, ar: p.height / p.width })
      prev = null
      return
    }

    p.lines.forEach((line, i) => {
      const isHeading = line.size > bodySize * 1.18 && line.text.length < 150

      // Big decorative first letter ("drop cap") on its own line, with the
      // text continuing to its right: glue it to the next line.
      const next = p.lines[i + 1]
      if (
        isHeading &&
        line.text.length <= 2 &&
        /\p{L}/u.test(line.text) &&
        next &&
        line.size > bodySize * 1.8 &&
        next.x >= line.xEnd - 1
      ) {
        p.lines[i + 1] = { ...next, text: line.text + next.text }
        return
      }

      if (isHeading) {
        flush()
        const last = blocks[blocks.length - 1]
        if (prev?.heading && last?.t === 'h' && last.page === pageNum) last.text = joinLines(last.text, line.text)
        else if (last?.t === 'p' && last.page === pageNum && CHAPTER_LABEL.test(last.text)) {
          // "CHAPTER 3" just above "Don't Feel Their Pain" → one heading.
          const sep = /[.:]$/.test(last.text) ? ' ' : ': '
          blocks[blocks.length - 1] = { t: 'h', text: last.text + sep + line.text, page: pageNum }
        } else blocks.push({ t: 'h', text: line.text, page: pageNum })
        prev = { line, right, heading: true }
        return
      }

      let newPara = !para || !prev || prev.heading
      if (!newPara && prev) {
        // The previous line stopped early even though this line's first word
        // would have fit there, so the paragraph must have ended.
        const room = prev.right - prev.line.xEnd
        const endedEarly =
          room > firstWordWidth(line) + bodySize * 0.6 &&
          (endsSentence(prev.line.text) || room > (right - left) * 0.25)
        // First-line indent. A full line at the same indent is the next line of
        // an indented block (like a quotation), not a new paragraph.
        const indent = line.x - left
        const indented = indent > bodySize * 0.7 && indent < (right - left) * 0.35
        const sameIndentAsPrev = Math.abs(line.x - prev.line.x) <= 1
        const sameColumnGap = i > 0 ? prev.line.y - line.y : 0
        // A new bullet, or a number after a line that could end the last item.
        const startsItem =
          BULLET.test(line.text) || (LIST_ITEM.test(line.text) && ENDS_ITEM.test(prev.line.text))
        // The wrapped second line of a list item sits under the item's text,
        // indented past its number or bullet.
        const continuesItem = para?.list && line.x > (para?.x ?? 0) + bodySize * 0.3
        // Centered lines (pull quotes, captions) that follow each other
        // closely belong together, even though each one starts and ends early.
        const centered = (l: Line) => {
          const leftGap = l.x - left
          const rightGap = right - l.xEnd
          return leftGap > bodySize && rightGap > bodySize && Math.abs(leftGap - rightGap) < bodySize * 1.5
        }
        const normalGap = i > 0 && sameColumnGap > 0 && sameColumnGap <= lineGap * 1.45
        const centeredBlock = normalGap && centered(prev.line) && centered(line) && !startsItem
        if (centeredBlock) newPara = false
        else if (endedEarly || startsItem) newPara = true
        // An indented line only starts a paragraph if the line before ended a
        // sentence; otherwise it's the ragged next line of a quote box.
        else if (indented && !sameIndentAsPrev && !continuesItem && endsSentence(prev.line.text)) newPara = true
        else if (i > 0 && (sameColumnGap > lineGap * 1.45 || sameColumnGap < -bodySize)) newPara = true
      }

      if (newPara) {
        flush()
        para = { text: line.text, page: pageNum, x: line.x, list: LIST_ITEM.test(line.text) }
      } else if (para) {
        para.text = joinLines(para.text, line.text)
      }
      prev = { line, right, heading: false }
    })
  })
  flush()
  resolveHyphens(blocks)
  return blocks
}

// ---------- table of contents ----------

async function buildToc(doc: PDFDocumentProxy, blocks: Block[]): Promise<TocItem[]> {
  const blockForPage = (page: number) => {
    const i = blocks.findIndex((b) => b.page >= page)
    return i < 0 ? Math.max(0, blocks.length - 1) : i
  }

  // Prefer the PDF's own bookmarks when it has them.
  try {
    const outline = await doc.getOutline()
    if (outline?.length) {
      const items: TocItem[] = []
      const walk = async (nodes: typeof outline, depth: number) => {
        for (const node of nodes) {
          const page = await destPage(doc, node.dest)
          if (page && node.title.trim()) items.push({ title: node.title.trim(), page, block: blockForPage(page) })
          if (depth < 1 && node.items?.length) await walk(node.items, depth + 1)
        }
      }
      await walk(outline, 0)
      if (items.length) return items
    }
  } catch {
    // Broken bookmarks: fall back to headings below.
  }

  return blocks.flatMap((b, i) => (b.t === 'h' ? [{ title: b.text, page: b.page, block: i }] : []))
}

async function destPage(doc: PDFDocumentProxy, dest: unknown): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest
    if (!Array.isArray(explicit) || explicit[0] == null) return null
    const ref = explicit[0]
    const index = typeof ref === 'number' ? ref : await doc.getPageIndex(ref)
    return index + 1
  } catch {
    return null
  }
}
