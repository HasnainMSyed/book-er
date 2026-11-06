import { useEffect, useRef } from 'react'
import { renderPage, type PDFDocumentProxy } from '../lib/pdf'

/**
 * Shows a whole PDF page as a picture inside the text view, for pages that
 * have no text (illustrations, scanned pages). Drawn only when scrolled near.
 */
export function PageImage({
  page,
  ar,
  getDoc,
}: {
  page: number
  ar: number
  getDoc: () => Promise<PDFDocumentProxy>
}) {
  const holder = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = holder.current
    if (!el) return
    let cancelled = false
    let task: ReturnType<typeof renderPage> | null = null

    const draw = async () => {
      const doc = await getDoc()
      const p = await doc.getPage(page)
      if (cancelled) return
      const canvas = document.createElement('canvas')
      task = renderPage(p, canvas, el.clientWidth)
      await task.promise
      if (!cancelled) el.replaceChildren(canvas)
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect()
          draw().catch(() => {
            // Cancelled or unreadable page: leave the blank placeholder.
          })
        }
      },
      { rootMargin: '800px 0px' },
    )
    io.observe(el)
    return () => {
      cancelled = true
      io.disconnect()
      task?.cancel()
    }
  }, [page, getDoc])

  return (
    <figure className="page-img-block">
      <div className="page-img" ref={holder} style={{ aspectRatio: `1 / ${ar}` }} />
      <figcaption className="page-img-label">Page {page}</figcaption>
    </figure>
  )
}
