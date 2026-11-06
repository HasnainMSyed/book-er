import { db, type BookMeta, type Progress, type ReadMode } from './db'
import { extractBook } from './extract'
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
  try {
    const file = await getFile(id)
    if (!file) throw new Error('The PDF file is missing.')
    doc = await openPdf(file)

    const info = await doc.getMetadata().catch(() => null)
    const raw = (info?.info ?? {}) as { Title?: unknown; Author?: unknown }
    const title = cleanTitle(typeof raw.Title === 'string' ? raw.Title : '')
    const author = typeof raw.Author === 'string' ? raw.Author.trim() : ''
    const cover = await renderCover(doc)
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
      void patchBook(id, { processed: fraction }).then(notify)
    })

    const d = await db()
    await d.put('texts', { blocks: text.blocks, toc: text.toc }, id)
    // Mostly scanned books read better as original pages until we support OCR.
    const book = await getBook(id)
    const mode: ReadMode = text.scannedRatio > 0.5 && !book?.lastOpenedAt ? 'page' : (book?.mode ?? 'reflow')
    await patchBook(id, { status: 'ready', processed: 1, scannedRatio: text.scannedRatio, mode, error: undefined })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await patchBook(id, {
      status: 'error',
      error: /password/i.test(message) ? 'This PDF is password-protected.' : message,
    })
  } finally {
    running.delete(id)
    void closePdf(doc)
    notify()
  }
}

/** Restarts any book that was still being prepared when the app was closed. */
export async function resumeProcessing() {
  for (const book of await listBooks()) {
    if (book.status === 'processing') await processBook(book.id)
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
