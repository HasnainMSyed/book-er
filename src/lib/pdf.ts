// Must come first: fills in features pdf.js needs on iPhone.
import './polyfills'
// The legacy build includes fallbacks for older iPhones' Safari engine.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type { PDFDocumentProxy, PDFPageProxy }

const base = `${import.meta.env.BASE_URL}pdfjs/`

// pdf.js closes documents through the task that opened them.
const tasks = new WeakMap<PDFDocumentProxy, { destroy: () => Promise<void> }>()

export async function openPdf(file: Blob): Promise<PDFDocumentProxy> {
  // pdf.js takes ownership of the buffer, so always hand it a fresh copy.
  const data = new Uint8Array(await file.arrayBuffer())
  const task = pdfjs.getDocument({
    data,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    iccUrl: `${base}iccs/`,
  })
  const doc = await task.promise
  tasks.set(doc, task)
  return doc
}

/** Frees the memory and worker used by an open PDF. */
export async function closePdf(doc: PDFDocumentProxy | null | undefined) {
  if (doc) await tasks.get(doc)?.destroy()
}

/** Area of the page to show, in page units at scale 1 (top-left origin). */
export type Box = { x: number; y: number; w: number; h: number }

// iOS refuses to draw canvases larger than about 16.7 million pixels.
const MAX_CANVAS_PIXELS = 16_000_000

/**
 * Draws `box` of the page onto `canvas` so it is `cssWidth` CSS pixels wide,
 * sharp on high-density screens.
 */
export function renderPage(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  cssWidth: number,
  box?: Box,
): RenderTask {
  const vp1 = page.getViewport({ scale: 1 })
  const b = box ?? { x: 0, y: 0, w: vp1.width, h: vp1.height }
  const cssScale = cssWidth / b.w
  let dpr = Math.min(window.devicePixelRatio || 1, 3)
  const pixels = (s: number) => b.w * s * (b.h * s)
  while (dpr > 1 && pixels(cssScale * dpr) > MAX_CANVAS_PIXELS) dpr -= 0.25
  const scale = cssScale * dpr

  const viewport = page.getViewport({ scale, offsetX: -b.x * scale, offsetY: -b.y * scale })
  canvas.width = Math.floor(b.w * scale)
  canvas.height = Math.floor(b.h * scale)
  canvas.style.width = `${cssWidth}px`
  canvas.style.height = `${(b.h * cssScale).toFixed(1)}px`
  return page.render({ canvas, viewport })
}

/**
 * Finds the area of the page that has anything printed on it (text or
 * pictures), by drawing a small version and looking for non-white pixels.
 * Used to trim the empty margins in page view.
 */
export async function findContentBox(page: PDFPageProxy): Promise<Box> {
  const vp1 = page.getViewport({ scale: 1 })
  const full = { x: 0, y: 0, w: vp1.width, h: vp1.height }
  const scale = 300 / vp1.width
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  try {
    await page.render({ canvas, viewport }).promise
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return full
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)

    const dark = (x: number, y: number) => {
      const i = (y * width + x) * 4
      return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 225
    }

    // A row counts as content if enough of it is dark (skips dust on scans).
    const minRow = Math.max(1, Math.round(width * 0.004))
    const rowHasInk: boolean[] = []
    for (let y = 0; y < height; y++) {
      let n = 0
      for (let x = 0; x < width && n < minRow; x++) if (dark(x, y)) n++
      rowHasInk.push(n >= minRow)
    }

    // Group inked rows into bands separated by blank space.
    const bands: { start: number; end: number }[] = []
    for (let y = 0; y < height; y++) {
      if (!rowHasInk[y]) continue
      const last = bands[bands.length - 1]
      if (last && y - last.end <= Math.round(height * 0.012)) last.end = y
      else bands.push({ start: y, end: y })
    }
    if (!bands.length) return full

    // A thin band set apart at the very top or bottom is a running header,
    // footer or page number: leave it out so the text can be bigger.
    const thin = height * 0.03
    const apart = height * 0.02
    if (bands.length > 1 && bands[0].end - bands[0].start < thin && bands[1].start - bands[0].end > apart) bands.shift()
    const n = bands.length
    if (n > 1 && bands[n - 1].end - bands[n - 1].start < thin && bands[n - 1].start - bands[n - 2].end > apart) bands.pop()

    let top = bands[0].start
    let bottom = bands[bands.length - 1].end
    const minCol = Math.max(1, Math.round((bottom - top) * 0.004))
    const colHasInk = (x: number) => {
      let c = 0
      for (let y = top; y <= bottom && c < minCol; y++) if (dark(x, y)) c++
      return c >= minCol
    }
    let left = 0
    while (left < width - 1 && !colHasInk(left)) left++
    let right = width - 1
    while (right > left && !colHasInk(right)) right--

    const pad = 8 // pixels at this small scale
    top = Math.max(0, top - pad)
    left = Math.max(0, left - pad)
    bottom = Math.min(height, bottom + pad)
    right = Math.min(width, right + pad)

    const box = { x: left / scale, y: top / scale, w: (right - left) / scale, h: (bottom - top) / scale }
    // Nothing to gain (or a nearly blank page): show the whole page.
    if (box.w < full.w * 0.2 || box.w > full.w * 0.97) return full
    return box
  } catch {
    return full
  } finally {
    canvas.width = canvas.height = 0
  }
}

/** Draws page 1 as a small JPEG for the library shelf. */
export async function renderCover(doc: PDFDocumentProxy): Promise<Blob | undefined> {
  const page = await doc.getPage(1)
  const canvas = document.createElement('canvas')
  try {
    const vp1 = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: 360 / vp1.width })
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas: null, canvasContext: ctx, viewport }).promise
    return await new Promise<Blob | undefined>((resolve) =>
      canvas.toBlob((b) => resolve(b ?? undefined), 'image/jpeg', 0.8),
    )
  } catch {
    return undefined
  } finally {
    canvas.width = canvas.height = 0
    page.cleanup()
  }
}
