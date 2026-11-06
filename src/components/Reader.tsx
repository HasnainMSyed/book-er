import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { BookMeta, BookText, Progress, ReadMode, TocItem } from '../lib/db'
import { getBook, getFile, getText, markOpened, saveMode, saveProgress } from '../lib/library'
import { closePdf, openPdf, type PDFDocumentProxy } from '../lib/pdf'
import { FONT_STACKS, MARGINS, useSettings } from '../lib/settings'
import { Icon } from './Icon'
import { PageView } from './PageView'
import { ReflowView, type Jump, type ViewHandle } from './ReflowView'
import { SettingsSheet, TocSheet } from './Sheets'

const ZOOMS = [1, 1.5, 2, 3]

export function Reader({ id, onClose }: { id: string; onClose: () => void }) {
  const settings = useSettings()
  const [book, setBook] = useState<BookMeta | null>(null)
  const [text, setText] = useState<BookText | null>(null)
  const [missing, setMissing] = useState(false)
  const [mode, setMode] = useState<ReadMode>('reflow')
  const [pos, setPos] = useState<Progress>({ block: 0, page: 1, percent: 0 })
  const [chrome, setChrome] = useState(true)
  const [sheet, setSheet] = useState<'settings' | 'toc' | null>(null)
  const [jump, setJump] = useState<Jump | null>(null)
  const [zoom, setZoom] = useState(1)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const view = useRef<ViewHandle>(null)

  // ---------- load the book ----------
  useEffect(() => {
    let alive = true
    void Promise.all([getBook(id), getText(id)]).then(([b, t]) => {
      if (!alive) return
      if (!b || !t) return setMissing(true)
      setBook(b)
      setText(t)
      setMode(b.mode)
      setPos(b.progress)
      void markOpened(id)
    })
    return () => {
      alive = false
    }
  }, [id])

  // The PDF itself is only opened when needed (page view, or picture pages).
  const docPromise = useRef<Promise<PDFDocumentProxy> | null>(null)
  const getDoc = useCallback(() => {
    docPromise.current ??= getFile(id).then((f) => {
      if (!f) throw new Error('PDF missing')
      return openPdf(f)
    })
    return docPromise.current
  }, [id])
  useEffect(() => () => void docPromise.current?.then(closePdf).catch(() => undefined), [])
  useEffect(() => {
    if (mode === 'page' && !doc) void getDoc().then(setDoc).catch(() => setMissing(true))
  }, [mode, doc, getDoc])

  // ---------- save your place ----------
  const latest = useRef(pos)
  useEffect(() => {
    latest.current = pos
  }, [pos])
  const loaded = book !== null
  useEffect(() => {
    if (!loaded) return
    const t = setTimeout(() => void saveProgress(id, latest.current), 600)
    return () => clearTimeout(t)
  }, [pos, id, loaded])
  // iOS may close the app without warning once it's in the background.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden' && loaded) void saveProgress(id, latest.current)
    }
    document.addEventListener('visibilitychange', flush)
    return () => document.removeEventListener('visibilitychange', flush)
  }, [id, loaded])

  const blocks = text?.blocks
  const pageCount = book?.pageCount ?? 1

  const firstBlockOnPage = useCallback(
    (page: number) => {
      if (!blocks?.length) return 0
      const i = blocks.findIndex((b) => b.page >= page)
      return i < 0 ? blocks.length - 1 : i
    },
    [blocks],
  )

  const onBlock = useCallback(
    (block: number) => {
      if (!blocks?.length) return
      setPos({
        block,
        page: blocks[Math.min(block, blocks.length - 1)].page,
        percent: blocks.length > 1 ? block / (blocks.length - 1) : 1,
      })
    },
    [blocks],
  )
  const onPage = useCallback(
    (page: number) => {
      setPos({ page, block: firstBlockOnPage(page), percent: pageCount > 1 ? (page - 1) / (pageCount - 1) : 1 })
    },
    [firstBlockOnPage, pageCount],
  )

  const switchMode = (m: ReadMode) => {
    if (m === mode) return
    // Text → page: open the page you were reading. Page → text: start of that page.
    if (m === 'reflow') setPos((p) => ({ ...p, block: firstBlockOnPage(p.page) }))
    setMode(m)
    setJump(null)
    void saveMode(id, m)
  }

  const toggleChrome = useCallback(() => setChrome((c) => !c), [])
  const hideChrome = useCallback(() => setChrome(false), [])

  // Keyboard and Bluetooth page-turners.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheet || (e.target as HTMLElement).tagName === 'INPUT') return
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) {
        e.preventDefault()
        view.current?.turn(1)
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) {
        e.preventDefault()
        view.current?.turn(-1)
      } else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheet, onClose])

  const jumpTo = (target: { block?: number; page?: number }) => setJump((j) => ({ ...target, n: (j?.n ?? 0) + 1 }))

  const pickChapter = (t: TocItem) => {
    setSheet(null)
    setChrome(false)
    if (mode === 'reflow') jumpTo({ block: t.block })
    else jumpTo({ page: t.page })
  }

  const chapter = useMemo(() => {
    if (!text) return ''
    let title = ''
    for (const t of text.toc) if (mode === 'reflow' ? t.block <= pos.block : t.page <= pos.page) title = t.title
    return title
  }, [text, pos.block, pos.page, mode])

  const style = {
    '--font': FONT_STACKS[settings.font],
    '--font-size': `${settings.fontSize}px`,
    '--line-height': settings.lineHeight,
    '--margin': MARGINS[settings.margin],
    '--align': settings.justify ? 'justify' : 'left',
  } as CSSProperties
  const layoutKey = `${settings.fontSize}|${settings.font}|${settings.lineHeight}|${settings.margin}|${settings.justify}`

  if (missing) {
    return (
      <main className="reader">
        <div className="empty">
          <h2>This book couldn't be opened</h2>
          <p>It may have been deleted or not finished preparing.</p>
          <button className="btn" onClick={onClose}>
            Back to library
          </button>
        </div>
      </main>
    )
  }
  if (!book || !text || !blocks) return <main className="reader" />

  const percent = Math.round(pos.percent * 100)
  const noText = blocks.every((b) => b.t === 'img')

  return (
    <main className={`reader${chrome ? '' : ' chrome-hidden'}`} style={style}>
      {mode === 'reflow' ? (
        <ReflowView
          ref={view}
          blocks={blocks}
          initialBlock={pos.block}
          jump={jump}
          layoutKey={layoutKey}
          lineHeightPx={settings.fontSize * settings.lineHeight}
          onPosition={onBlock}
          onTapCenter={toggleChrome}
          onInteract={hideChrome}
          getDoc={getDoc}
        />
      ) : (
        <PageView
          ref={view}
          doc={doc}
          pageCount={pageCount}
          initialPage={pos.page}
          jump={jump}
          zoom={zoom}
          trim={settings.trim}
          onPage={onPage}
          onTapCenter={toggleChrome}
          onInteract={hideChrome}
        />
      )}

      {!chrome && (
        <div className="peek" aria-hidden="true">
          {mode === 'page' ? `Page ${pos.page} of ${pageCount}` : `${percent}%`}
        </div>
      )}

      <header className="bar bar-top" inert={!chrome}>
        <button className="icon-btn" onClick={onClose} aria-label="Back to library">
          <Icon name="back" />
        </button>
        <div className="bar-title">{book.title}</div>
        <button className="icon-btn" onClick={() => setSheet('toc')} aria-label="Chapters">
          <Icon name="list" />
        </button>
        <button className="icon-btn" onClick={() => setSheet('settings')} aria-label="Reading settings">
          <span className="label" style={{ fontFamily: 'ui-serif, Georgia, serif', fontSize: 19 }}>
            Aa
          </span>
        </button>
      </header>

      <footer className="bar bar-bottom" inert={!chrome}>
        {mode === 'reflow' ? (
          <input
            className="slider"
            type="range"
            min={0}
            max={Math.max(0, blocks.length - 1)}
            value={pos.block}
            aria-label="Position in book"
            onChange={(e) => jumpTo({ block: Number(e.target.value) })}
          />
        ) : (
          <input
            className="slider"
            type="range"
            min={1}
            max={pageCount}
            value={pos.page}
            aria-label="Page"
            onChange={(e) => jumpTo({ page: Number(e.target.value) })}
          />
        )}
        <div className="bar-row">
          <span className="where">
            {mode === 'page' ? `Page ${pos.page} of ${pageCount}` : `${percent}% · page ${pos.page}`}
            {chapter && <span className="where-chapter">{chapter}</span>}
          </span>
          {mode === 'page' && (
            <>
              <button
                className="icon-btn"
                aria-label="Zoom out"
                disabled={zoom === ZOOMS[0]}
                onClick={() => setZoom((z) => ZOOMS[Math.max(0, ZOOMS.indexOf(z) - 1)])}
              >
                <Icon name="zoomOut" />
              </button>
              <button
                className="icon-btn"
                aria-label="Zoom in"
                disabled={zoom === ZOOMS[ZOOMS.length - 1]}
                onClick={() => setZoom((z) => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + 1)])}
              >
                <Icon name="zoomIn" />
              </button>
            </>
          )}
          <div className="mode-switch" role="group" aria-label="View">
            <button aria-pressed={mode === 'reflow'} onClick={() => switchMode('reflow')} disabled={noText}>
              Text
            </button>
            <button aria-pressed={mode === 'page'} onClick={() => switchMode('page')}>
              Page
            </button>
          </div>
        </div>
      </footer>

      {sheet === 'settings' && <SettingsSheet mode={mode} onClose={() => setSheet(null)} />}
      {sheet === 'toc' && (
        <TocSheet
          toc={text.toc}
          currentBlock={pos.block}
          currentPage={pos.page}
          mode={mode}
          onPick={pickChapter}
          onClose={() => setSheet(null)}
        />
      )}
    </main>
  )
}
