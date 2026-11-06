import { db, type BookMeta, type Progress, type ReadMode } from './db'
import { EXTRACT_VERSION, extractBook } from './extract'
import { closePdf, openPdf, renderCover } from './pdf'

// ---------- change notifications ----------

const listeners = new Set<() => void>()
export function onLibraryChange(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
const notify = () => listeners.forEach((fn) => fn())

// ---------- reading ----------

export async function listBooks(): Promise<BookMeta[]> {
  const books = await (await db()).getAll('books')
  return books.sort((a, b) => Math.max(b.lastOpenedAt, b.addedAt) - Math.max(a.lastOpenedAt, a.addedAt))
}

export async function getBook(id: string) {
  return (await db()).get('books', id)
}

export async function getFile(id: string) {
  return (await db()).get('files', id)
}

export async function getText(id: string) {
  return (await db()).get('texts', id)
}

// ---------- writing ----------

async function patchBook(id: string, patch: Partial<BookMeta>) {
  const d = await db()
  const tx = d.transaction('books', 'readwrite')
  const book = await tx.store.get(id)
  if (book) await tx.store.put({ ...book, ...patch })
  await tx.done
}

export async function addBooks(files: File[]) {
  requestPersistentStorage()
  const d = await db()
  const ids: string[] = []
  for (const file of files) {
    const id = newId()
    const meta: BookMeta = {
      id,
      title: file.name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim() || 'Untitled',
      author: '',
      fileName: file.name,
      size: file.size,
      addedAt: Date.now(),
      lastOpenedAt: 0,
      pageCount: 0,
      status: 'processing',
      processed: 0,
      mode: 'reflow',
      progress: { block: 0, page: 1, percent: 0 },
    }
    const tx = d.transaction(['books', 'files'], 'readwrite')
    await Promise.all([tx.objectStore('files').put(file, id), tx.objectStore('books').put(meta), tx.done])
    ids.push(id)
  }
  notify()
  // Process one at a time so the phone doesn't run out of memory.
  for (const id of ids) await processBook(id)
}

const running = new Set<string>()

/** Pulls the text out of a stored PDF and saves it, ready for reading. */
export async function processBook(id: string) {
  if (running.has(id)) return
  running.add(id)
  let doc: Awaited<ReturnType<typeof openPdf>> | null = null
  // A book that's already readable is being re-prepared with better extraction.
  // It stays readable throughout, and keeps its old text if anything fails.
  const upgrading = (await getBook(id))?.status === 'ready'
  try {
    const file = await getFile(id)
    if (!file) throw new Error('The PDF file is missing.')
    doc = await openPdf(file)

    const info = await doc.getMetadata().catch(() => null)
    const raw = (info?.info ?? {}) as { Title?: unknown; Author?: unknown }
    const title = cleanTitle(typeof raw.Title === 'string' ? raw.Title : '')
    const author = typeof raw.Author === 'string' ? raw.Author.trim() : ''
    const existing = await getBook(id)
    const cover = upgrading && existing?.cover ? existing.cover : await renderCover(doc)
    await patchBook(id, {
      pageCount: doc.numPages,
      cover,
      ...(title ? { title } : {}),
      ...(author ? { author } : {}),
    })
    notify()

    let lastSaved = 0
    const text = await extractBook(doc, (fraction) => {
      // Saving every update would be slow; a few times a second is plenty.
      if (Date.now() - lastSaved < 400) return
      lastSaved = Date.now()
      if (!upgrading) void patchBook(id, { processed: fraction }).then(notify)
    })

    const d = await db()
    await d.put('texts', { blocks: text.blocks, toc: text.toc }, id)
    // Mostly scanned books read better as original pages until we support OCR.
    const book = await getBook(id)
    const mode: ReadMode = text.scannedRatio > 0.5 && !book?.lastOpenedAt ? 'page' : (book?.mode ?? 'reflow')
    await patchBook(id, {
      status: 'ready',
      processed: 1,
      scannedRatio: text.scannedRatio,
      mode,
      error: undefined,
      extractVersion: EXTRACT_VERSION,
    })
  } catch (err) {
    // Upgrade failed: keep the old text, and don't retry on every launch.
    if (upgrading) await patchBook(id, { extractVersion: EXTRACT_VERSION })
    else await patchBook(id, { status: 'error', error: friendlyError(err) })
  } finally {
    running.delete(id)
    void closePdf(doc)
    notify()
  }
}

/**
 * Restarts any book that was still being prepared when the app was closed,
 * then re-prepares books made with an older version of the text extraction.
 */
export async function resumeProcessing() {
  const books = await listBooks()
  for (const book of books) {
    if (book.status === 'processing') await processBook(book.id)
  }
  for (const book of books) {
    if (book.status === 'ready' && (book.extractVersion ?? 1) < EXTRACT_VERSION) await processBook(book.id)
  }
}

export async function retryBook(id: string) {
  await patchBook(id, { status: 'processing', processed: 0, error: undefined })
  notify()
  await processBook(id)
}

export async function deleteBook(id: string) {
  const d = await db()
  const tx = d.transaction(['books', 'files', 'texts'], 'readwrite')
  await Promise.all([
    tx.objectStore('books').delete(id),
    tx.objectStore('files').delete(id),
    tx.objectStore('texts').delete(id),
    tx.done,
  ])
  notify()
}

export async function saveProgress(id: string, progress: Progress) {
  await patchBook(id, { progress, lastOpenedAt: Date.now() })
}

export async function saveMode(id: string, mode: ReadMode) {
  await patchBook(id, { mode })
}

export async function markOpened(id: string) {
  await patchBook(id, { lastOpenedAt: Date.now() })
}

// ---------- helpers ----------

/** Turns pdf.js errors into something a reader can act on. */
function friendlyError(err: unknown): string {
  const name = err instanceof Error ? err.name : ''
  const message = err instanceof Error ? err.message : String(err)
  if (name === 'PasswordException' || /password/i.test(message)) {
    return 'This PDF is password-protected, so it can’t be opened.'
  }
  if (name === 'InvalidPDFException' || /invalid pdf|unexpected end|missing pdf/i.test(message)) {
    return 'This file is incomplete or damaged — it may not have finished downloading or saving. Try saving or downloading it again.'
  }
  if (/is not a function|is not defined/i.test(message)) {
    return `This browser is too old to open PDFs here. On iPhone, update to iOS 17.4 or newer. (${message})`
  }
  return `This PDF couldn’t be read. (${message})`
}

/** crypto.randomUUID only exists on https pages, so fall back for local testing. */
function newId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

function cleanTitle(t: string) {
  const title = t
    .replace(/^Microsoft (Word|PowerPoint) - /i, '')
    .replace(/\.(docx?|pdf|indd|tex)$/i, '')
    .trim()
  // Ignore placeholder titles that PDF tools often leave behind.
  if (title.length < 2 || /^(untitled|title|document\d*|unknown)$/i.test(title)) return ''
  return title
}

let persistAsked = false
/** Asks the browser not to clear our storage when the phone runs low on space. */
export function requestPersistentStorage() {
  if (persistAsked) return
  persistAsked = true
  void navigator.storage?.persist?.().catch(() => false)
}

export async function storageUsage(): Promise<{ used: number; quota: number } | null> {
  try {
    const est = await navigator.storage?.estimate?.()
    return est ? { used: est.usage ?? 0, quota: est.quota ?? 0 } : null
  } catch {
    return null
  }
}
