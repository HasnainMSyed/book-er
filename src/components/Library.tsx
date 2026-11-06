import { useEffect, useRef, useState } from 'react'
import { createBackup, restoreBackup, saveBackup } from '../lib/backup'
import type { BookMeta } from '../lib/db'
import { addBooks, deleteBook, listBooks, onLibraryChange, retryBook, storageUsage } from '../lib/library'
import { formatBytes } from '../lib/platform'
import { Icon } from './Icon'
import { InstallHint } from './InstallHint'

function useBooks() {
  const [books, setBooks] = useState<BookMeta[] | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => void listBooks().then((b) => alive && setBooks(b))
    load()
    const off = onLibraryChange(load)
    return () => {
      alive = false
      off()
    }
  }, [])
  return books
}

/** Object URL for a cover image, released when no longer shown. */
function useBlobUrl(blob: Blob | undefined) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!blob) return setUrl(undefined)
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}

export function Library({ onOpen }: { onOpen: (id: string) => void }) {
  const books = useBooks()
  const fileInput = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [usage, setUsage] = useState<string | null>(null)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    void storageUsage().then((u) => u && setUsage(formatBytes(u.used)))
  }, [books])

  const onFiles = (list: FileList | null) => {
    const files = [...(list ?? [])]
    const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
    if (files.length && !pdfs.length) setToast('Book-er can only open PDF files for now.')
    if (pdfs.length) void addBooks(pdfs)
  }

  const backup = async () => {
    setMenuOpen(false)
    if (!books?.length) return setToast('Add a book first, then you can back up your library.')
    setToast('Preparing backup…')
    try {
      await saveBackup(await createBackup())
      setToast(null)
    } catch (err) {
      setToast(`Backup failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  const restore = async (file: File | undefined) => {
    setMenuOpen(false)
    if (!file) return
    try {
      const { added, skipped } = await restoreBackup(file)
      setToast(
        `Restored ${added} book${added === 1 ? '' : 's'}` + (skipped ? ` (${skipped} already here)` : '') + '.',
      )
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Could not read that backup.')
    }
  }

  return (
    <main className="library">
      <header className="library-header">
        <h1>Book-er</h1>
        <div className="menu">
          <button
            className="icon-btn"
            aria-label="Library menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <Icon name="more" />
          </button>
          {menuOpen && (
            <div className="menu-list" role="menu">
              <button role="menuitem" onClick={() => void backup()}>
                <Icon name="download" /> Back up library
              </button>
              <label role="menuitem">
                <Icon name="upload" /> Restore from backup
                <input
                  type="file"
                  className="visually-hidden"
                  onChange={(e) => {
                    void restore(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
              </label>
              <p className="menu-note">
                Your books are stored only on this device. A backup lets you move them or keep them safe.
              </p>
            </div>
          )}
        </div>
      </header>

      <InstallHint />

      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          onFiles(e.target.files)
          e.target.value = ''
        }}
      />

      {books === null ? null : books.length === 0 ? (
        <div className="empty">
          <Icon name="book" size={48} />
          <h2>Your shelf is empty</h2>
          <p>
            Add a PDF and Book-er will turn it into easy-to-read text you can resize — no more pinching and
            zooming.
          </p>
          <button className="btn" onClick={() => fileInput.current?.click()}>
            <Icon name="plus" /> Add a PDF
          </button>
        </div>
      ) : (
        <ul className="shelf">
          {books.map((b) => (
            <BookCard key={b.id} book={b} onOpen={onOpen} onToast={setToast} />
          ))}
        </ul>
      )}

      {usage && books?.length ? <p className="storage-line">Using {usage} on this device</p> : null}

      {books?.length ? (
        <button className="btn fab" onClick={() => fileInput.current?.click()}>
          <Icon name="plus" /> Add PDF
        </button>
      ) : null}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </main>
  )
}

function BookCard({
  book,
  onOpen,
  onToast,
}: {
  book: BookMeta
  onOpen: (id: string) => void
  onToast: (msg: string) => void
}) {
  const cover = useBlobUrl(book.cover)
  const [actions, setActions] = useState<'closed' | 'open' | 'confirm'>('closed')
  const percent = Math.round(book.progress.percent * 100)

  const open = () => {
    if (book.status === 'ready') onOpen(book.id)
    else if (book.status === 'processing') onToast('Still preparing this book — it will be ready in a moment.')
    else onToast(book.error ?? 'This PDF could not be read.')
  }

  return (
    <li className="book">
      <button className="book-open" onClick={open} aria-label={`Open ${book.title}`}>
        <div className="cover">
          {cover ? <img src={cover} alt="" /> : <div className="cover-placeholder">{book.title}</div>}
          {book.status === 'processing' && (
            <div className="cover-status">
              Preparing… {Math.round((book.processed ?? 0) * 100)}%
              <div className="meter">
                <span style={{ width: `${Math.round((book.processed ?? 0) * 100)}%` }} />
              </div>
            </div>
          )}
          {book.status === 'error' && <div className="cover-status error">Couldn't read this PDF</div>}
        </div>
        <div className="book-title">{book.title}</div>
      </button>
      <div className="book-sub">
        <span>
          {book.status === 'ready'
            ? percent > 0
              ? `${percent}% read`
              : `New · ${book.pageCount} pages`
            : book.author}
        </span>
        <button
          className="icon-btn"
          aria-label={`Options for ${book.title}`}
          aria-expanded={actions !== 'closed'}
          onClick={() => setActions((a) => (a === 'closed' ? 'open' : 'closed'))}
        >
          <Icon name="more" size={20} />
        </button>
      </div>
      {book.status === 'ready' && percent > 0 && (
        <div className="meter" aria-hidden="true">
          <span style={{ width: `${percent}%` }} />
        </div>
      )}
      {actions !== 'closed' && (
        <div className="book-actions">
          {book.status === 'error' && (
            <button className="btn secondary" onClick={() => void retryBook(book.id)}>
              <Icon name="retry" size={20} /> Try again
            </button>
          )}
          {actions === 'open' ? (
            <button className="btn secondary" onClick={() => setActions('confirm')}>
              <Icon name="trash" size={20} /> Delete
            </button>
          ) : (
            <button className="btn danger" onClick={() => void deleteBook(book.id)}>
              Tap again to delete
            </button>
          )}
        </div>
      )}
    </li>
  )
}
