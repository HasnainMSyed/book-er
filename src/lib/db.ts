import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

/** One piece of reflowed text: a heading, a paragraph, or a page with no text (shown as an image). */
export type Block =
  | { t: 'h'; text: string; page: number }
  | { t: 'p'; text: string; page: number }
  | { t: 'img'; page: number; ar: number } // ar = page height / width

export type TocItem = { title: string; page: number; block: number }

export type BookText = { blocks: Block[]; toc: TocItem[] }

export type ReadMode = 'reflow' | 'page'

export type Progress = {
  block: number // first visible block in reflow mode
  page: number // 1-based PDF page
  percent: number // 0..1
  /** Start of the text at `block`, to find the same spot if the text is re-prepared. */
  anchor?: string
}

export type BookMeta = {
  id: string
  title: string
  author: string
  fileName: string
  size: number
  addedAt: number
  lastOpenedAt: number
  pageCount: number
  status: 'processing' | 'ready' | 'error'
  error?: string
  /** 0..1, how much of the extraction is done while status is 'processing'. */
  processed?: number
  /** Share of pages with no text at all (likely scanned). */
  scannedRatio?: number
  /** Which version of the text extraction prepared this book (missing = 1). */
  extractVersion?: number
  /** JPEG bytes (older books may have a Blob). */
  cover?: Blob | ArrayBuffer
  mode: ReadMode
  progress: Progress
}

interface BookerDB extends DBSchema {
  books: { key: string; value: BookMeta }
  files: { key: string; value: Blob | ArrayBuffer }
  texts: { key: string; value: BookText }
}

/**
 * iPhones (WebKit) can refuse to store a picked file or Blob in IndexedDB, so
 * binary data is saved as raw bytes and turned back into a Blob when read.
 */
export function asBlob(data: Blob | ArrayBuffer | undefined, type: string): Blob | undefined {
  if (data === undefined) return undefined
  return data instanceof Blob ? data : new Blob([data], { type })
}

let dbPromise: Promise<IDBPDatabase<BookerDB>> | null = null

export function db() {
  dbPromise ??= openDB<BookerDB>('booker', 1, {
    upgrade(d) {
      d.createObjectStore('books', { keyPath: 'id' })
      d.createObjectStore('files')
      d.createObjectStore('texts')
    },
  })
  return dbPromise
}
