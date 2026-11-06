import { useCallback, useEffect, useImperativeHandle, useRef, useState, type MouseEvent, type Ref, type TouchEvent } from 'react'
import { findContentBox, renderPage, type Box, type PDFDocumentProxy } from '../lib/pdf'
import type { Jump, ViewHandle } from './ReflowView'

type Props = {
  doc: PDFDocumentProxy | null
  pageCount: number
  initialPage: number
  jump: Jump | null
  zoom: number
  trim: boolean
  onPage: (page: number) => void
  onTapCenter: () => void
  onInteract: () => void
  ref?: Ref<ViewHandle>
}

/**
 * The original PDF page, fitted to the screen width with empty margins trimmed
 * so the text is as large as possible. Tap the edges or swipe to turn pages.
 */
export function PageView({ doc, pageCount, initialPage, jump, zoom, trim, onPage, onTapCenter, onInteract, ref }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const holder = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState(() => Math.min(Math.max(1, initialPage), Math.max(1, pageCount)))
  const [width, setWidth] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const boxes = useRef(new Map<number, Box>())
  // Where to scroll after the next page is drawn ('keep' = leave as is, e.g. after zooming).
  const landAt = useRef<'top' | 'bottom' | 'keep'>('top')

  // Track the available width (rotating the phone, resizing the window).
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const contentBox = useCallback(
    async (n: number) => {
      if (!doc) return undefined
      const cached = boxes.current.get(n)
      if (cached) return cached
      const p = await doc.getPage(n)
      const box = await findContentBox(p)
      boxes.current.set(n, box)
      return box
    },
    [doc],
  )

  // Draw the current page into a fresh canvas, then swap it in (no blank flash).
  useEffect(() => {
    if (!doc || !width) return
    let cancelled = false
    let task: ReturnType<typeof renderPage> | null = null
    ;(async () => {
      const p = await doc.getPage(page)
      const box = trim ? await contentBox(page) : undefined
      if (cancelled) return
      const canvas = document.createElement('canvas')
      task = renderPage(p, canvas, Math.floor(width * zoom), box)
      await task.promise
      if (cancelled || !holder.current) return
      holder.current.replaceChildren(canvas)
      setError(null)
      const sc = scroller.current
      if (sc && landAt.current !== 'keep') sc.scrollTop = landAt.current === 'bottom' ? sc.scrollHeight : 0
      landAt.current = 'keep'
      // Get the next page's trim ready so turning feels instant.
      if (trim && page < pageCount) void contentBox(page + 1).catch(() => undefined)
    })().catch((err: unknown) => {
      if (!cancelled && !(err instanceof Error && err.name === 'RenderingCancelledException')) {
        setError('This page could not be displayed.')
      }
    })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, page, width, zoom, trim, pageCount, contentBox])

  const goTo = useCallback(
    (n: number, land: 'top' | 'bottom' = 'top') => {
      const next = Math.min(Math.max(1, n), pageCount)
      landAt.current = land
      setPage(next)
      onPage(next)
    },
    [pageCount, onPage],
  )

  useEffect(() => {
    if (jump?.page != null) goTo(jump.page)
  }, [jump, goTo])

  const turn = useCallback(
    (dir: 1 | -1) => {
      const sc = scroller.current
      onInteract()
      if (!sc) return
      const step = sc.clientHeight * 0.85
      if (dir > 0) {
        if (sc.scrollTop + sc.clientHeight < sc.scrollHeight - 4) sc.scrollTop += step
        else if (page < pageCount) goTo(page + 1, 'top')
      } else {
        if (sc.scrollTop > 4) sc.scrollTop -= step
        else if (page > 1) goTo(page - 1, 'bottom')
      }
    },
    [page, pageCount, goTo, onInteract],
  )
  useImperativeHandle(ref, () => ({ turn }), [turn])

  const onClick = (e: MouseEvent) => {
    const w = scroller.current?.clientWidth ?? window.innerWidth
    if (e.clientX < w * 0.3) turn(-1)
    else if (e.clientX > w * 0.7) turn(1)
    else onTapCenter()
  }

  // Sideways swipe = next/previous page (only when not zoomed in).
  const touch = useRef<{ x: number; y: number; t: number } | null>(null)
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0]
    touch.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY, t: Date.now() } : null
  }
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch.current
    touch.current = null
    if (!start || zoom > 1) return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50 && Date.now() - start.t < 600) {
      onInteract()
      if (dx < 0 && page < pageCount) goTo(page + 1, 'top')
      if (dx > 0 && page > 1) goTo(page - 1, 'top')
    }
  }

  return (
    <div
      className={`reader-scroll${zoom > 1 ? ' zoomed' : ''}`}
      ref={scroller}
      onClick={onClick}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchMove={onInteract}
    >
      <div className={`page-view${zoom > 1 ? ' zoomed' : ''}`}>
        {!doc && <p className="page-loading">Opening pages…</p>}
        {error && <p className="page-loading">{error}</p>}
        <div ref={holder} aria-label={`Page ${page} of ${pageCount}`} role="img" />
      </div>
    </div>
  )
}
