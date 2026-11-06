import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type MouseEvent,
  type Ref,
} from 'react'
import type { Block } from '../lib/db'
import type { PDFDocumentProxy } from '../lib/pdf'
import { PageImage } from './PageImage'

export type ViewHandle = { turn: (dir: 1 | -1) => void }
export type Jump = { block?: number; page?: number; n: number }

type Props = {
  blocks: Block[]
  initialBlock: number
  jump: Jump | null
  /** Changes whenever text size/spacing changes, so we can keep your place. */
  layoutKey: string
  lineHeightPx: number
  onPosition: (block: number) => void
  onTapCenter: () => void
  onInteract: () => void
  getDoc: () => Promise<PDFDocumentProxy>
  ref?: Ref<ViewHandle>
}

/** The book as re-wrapped text. Tap left/right edges to turn, middle for menus. */
export const ReflowView = memo(function ReflowView({
  blocks,
  initialBlock,
  jump,
  layoutKey,
  lineHeightPx,
  onPosition,
  onTapCenter,
  onInteract,
  getDoc,
  ref,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const article = useRef<HTMLElement>(null)
  // Where you are: which block is at the top, and how far into it.
  const anchor = useRef({ block: initialBlock, frac: 0 })
  const lastReported = useRef(-1)
  const frame = useRef(0)

  const blockEl = (i: number) => article.current?.children[i] as HTMLElement | undefined

  const scrollToBlock = useCallback((i: number, frac = 0) => {
    const el = blockEl(Math.max(0, Math.min(i, blocks.length - 1)))
    const sc = scroller.current
    if (!el || !sc) return
    sc.scrollTop = i === 0 && frac === 0 ? 0 : el.offsetTop + frac * el.offsetHeight - 12
  }, [blocks.length])

  const firstVisible = useCallback(() => {
    const sc = scroller.current
    const art = article.current
    if (!sc || !art) return { block: 0, frac: 0 }
    const top = sc.scrollTop + 12
    let lo = 0
    let hi = blocks.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const el = art.children[mid] as HTMLElement
      if (el.offsetTop + el.offsetHeight <= top) lo = mid + 1
      else hi = mid
    }
    const el = art.children[lo] as HTMLElement | undefined
    const frac = el && el.offsetHeight ? Math.max(0, Math.min(1, (top - el.offsetTop) / el.offsetHeight)) : 0
    return { block: lo, frac }
  }, [blocks.length])

  // Open at the saved spot.
  useLayoutEffect(() => {
    scrollToBlock(initialBlock)
    // Only on first show; later moves come from `jump`.
  }, [])

  // Text got bigger/smaller: stay on the same sentence.
  const firstLayout = useRef(true)
  useLayoutEffect(() => {
    if (firstLayout.current) {
      firstLayout.current = false
      return
    }
    scrollToBlock(anchor.current.block, anchor.current.frac)
  }, [layoutKey, scrollToBlock])

  useEffect(() => {
    if (jump?.block != null) {
      anchor.current = { block: jump.block, frac: 0 }
      scrollToBlock(jump.block)
    }
  }, [jump, scrollToBlock])

  const onScroll = () => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const pos = firstVisible()
      anchor.current = pos
      if (pos.block !== lastReported.current) {
        lastReported.current = pos.block
        onPosition(pos.block)
      }
    })
  }

  const turn = useCallback(
    (dir: 1 | -1) => {
      const sc = scroller.current
      if (!sc) return
      // Keep one line of overlap so you never lose your place.
      sc.scrollTop += dir * Math.max(100, sc.clientHeight - lineHeightPx * 1.6)
      onInteract()
    },
    [lineHeightPx, onInteract],
  )
  useImperativeHandle(ref, () => ({ turn }), [turn])

  const onClick = (e: MouseEvent) => {
    if (window.getSelection()?.toString()) return
    if ((e.target as HTMLElement).closest('button, a')) return
    const w = scroller.current?.clientWidth ?? window.innerWidth
    if (e.clientX < w * 0.3) turn(-1)
    else if (e.clientX > w * 0.7) turn(1)
    else onTapCenter()
  }

  return (
    <div className="reader-scroll" ref={scroller} onScroll={onScroll} onClick={onClick} onTouchMove={onInteract}>
      <article className="reflow" ref={article}>
        {blocks.map((b, i) =>
          b.t === 'h' ? (
            <h2 key={i}>{b.text}</h2>
          ) : b.t === 'p' ? (
            <p key={i}>{b.text}</p>
          ) : (
            <PageImage key={i} page={b.page} ar={b.ar} getDoc={getDoc} />
          ),
        )}
        <p className="the-end">— End —</p>
      </article>
    </div>
  )
})
