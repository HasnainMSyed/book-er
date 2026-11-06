// A backup is one file: "BOOKER01", a 4-byte header length, a JSON header
// describing each book, then each book's PDF bytes back to back.
// Extracted text and covers are rebuilt on restore, so they aren't included.

import { db, type BookMeta } from './db'
import { getFile, listBooks, processBook } from './library'

const MAGIC = 'BOOKER01'

type HeaderBook = Omit<BookMeta, 'cover' | 'status' | 'processed' | 'error'> & { bytes: number }
type Header = { app: 'book-er'; version: 1; createdAt: number; books: HeaderBook[] }

export async function createBackup(): Promise<File> {
  const books = await listBooks()
  const parts: Blob[] = []
  const header: Header = { app: 'book-er', version: 1, createdAt: Date.now(), books: [] }
  for (const book of books) {
    const file = await getFile(book.id)
    if (!file) continue
    const { cover: _c, status: _s, processed: _p, error: _e, ...rest } = book
    header.books.push({ ...rest, bytes: file.size })
    parts.push(file)
  }
  const headerBytes = new TextEncoder().encode(JSON.stringify(header))
  const len = new Uint8Array(4)
  new DataView(len.buffer).setUint32(0, headerBytes.length, true)
  const date = new Date().toISOString().slice(0, 10)
  return new File([MAGIC, len, headerBytes, ...parts], `book-er-backup-${date}.booker`, {
    type: 'application/octet-stream',
  })
}

/** Restores books from a backup file. Books already in the library are skipped. */
export async function restoreBackup(file: File): Promise<{ added: number; skipped: number }> {
  const magic = await file.slice(0, 8).text()
  if (magic !== MAGIC) throw new Error("This isn't a Book-er backup file.")
  const len = new DataView(await file.slice(8, 12).arrayBuffer()).getUint32(0, true)
  const header = JSON.parse(await file.slice(12, 12 + len).text()) as Header
  if (header.app !== 'book-er' || header.version !== 1) throw new Error('Unsupported backup version.')

  const d = await db()
  let offset = 12 + len
  let added = 0
  let skipped = 0
  const toProcess: string[] = []
  for (const { bytes, ...meta } of header.books) {
    const pdf = file.slice(offset, offset + bytes, 'application/pdf')
    offset += bytes
    if (await d.get('books', meta.id)) {
      skipped++
      continue
    }
    // Raw bytes (see asBlob in db.ts), read before the transaction starts.
    const pdfBytes = await pdf.arrayBuffer()
    const tx = d.transaction(['books', 'files'], 'readwrite')
    await Promise.all([
      tx.objectStore('files').put(pdfBytes, meta.id),
      tx.objectStore('books').put({ ...meta, status: 'processing', processed: 0 }),
      tx.done,
    ])
    toProcess.push(meta.id)
    added++
  }
  void (async () => {
    for (const id of toProcess) await processBook(id)
  })()
  return { added, skipped }
}

/** Hands the backup to the phone's share sheet ("Save to Files"), or downloads it. */
export async function saveBackup(file: File) {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: 'Book-er backup' })
      return
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return // user closed the sheet
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
