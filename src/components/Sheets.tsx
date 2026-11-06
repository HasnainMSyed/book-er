import { useEffect, type CSSProperties, type ReactNode } from 'react'
import type { ReadMode, TocItem } from '../lib/db'
import { FONT_STACKS, THEME_BG, getSettings, updateSettings, useSettings, type FontChoice, type Settings, type Theme } from '../lib/settings'
import { Icon } from './Icon'

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <section className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </section>
    </>
  )
}

function Choices<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: ReactNode; style?: CSSProperties }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="choices">
      {options.map((o) => (
        <button
          key={String(o.value)}
          className="choice"
          aria-pressed={o.value === value}
          style={o.style}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

const MIN_SIZE = 14
const MAX_SIZE = 40

export function SettingsSheet({ mode, onClose }: { mode: ReadMode; onClose: () => void }) {
  const s = useSettings()
  const set = (patch: Partial<Settings>) => updateSettings(patch)
  const clamp = (n: number) => Math.min(MAX_SIZE, Math.max(MIN_SIZE, n))
  // Read the latest size so quick repeated taps all count.
  const step = (d: number) => set({ fontSize: clamp(getSettings().fontSize + d) })

  const fonts: { value: FontChoice; label: string }[] = [
    { value: 'serif', label: 'Serif' },
    { value: 'book', label: 'Book' },
    { value: 'sans', label: 'Sans' },
    { value: 'mono', label: 'Mono' },
  ]
  const themes: { value: Theme; label: string }[] = [
    { value: 'auto', label: 'Auto' },
    { value: 'light', label: 'Light' },
    { value: 'sepia', label: 'Sepia' },
    { value: 'dark', label: 'Dark' },
  ]

  return (
    <Sheet title="Reading settings" onClose={onClose}>
      {mode === 'page' && (
        <p className="preview" style={{ fontSize: 14, margin: '0 0 8px' }}>
          Text size and fonts apply in <strong>Text</strong> view. In <strong>Page</strong> view, use the zoom
          buttons and margin trimming below.
        </p>
      )}

      <div className="setting">
        <span className="setting-label" id="size-label">
          Text size
        </span>
        <div className="size-row">
          <button className="icon-btn" style={{ fontSize: 15 }} onClick={() => step(-1)} aria-label="Smaller text">
            A
          </button>
          <input
            className="slider"
            type="range"
            min={MIN_SIZE}
            max={MAX_SIZE}
            step={1}
            value={s.fontSize}
            aria-labelledby="size-label"
            onChange={(e) => set({ fontSize: clamp(Number(e.target.value)) })}
          />
          <button className="icon-btn" style={{ fontSize: 24 }} onClick={() => step(1)} aria-label="Bigger text">
            A
          </button>
          <span className="size-value">{s.fontSize}</span>
        </div>
      </div>

      <div className="setting">
        <span className="setting-label">Font</span>
        <Choices
          value={s.font}
          onChange={(font) => set({ font })}
          options={fonts.map((f) => ({ ...f, style: { fontFamily: FONT_STACKS[f.value] } }))}
        />
      </div>

      <div className="setting">
        <span className="setting-label">Line spacing</span>
        <Choices
          value={s.lineHeight}
          onChange={(lineHeight) => set({ lineHeight })}
          options={[
            { value: 1.4, label: 'Tight' },
            { value: 1.6, label: 'Normal' },
            { value: 1.85, label: 'Relaxed' },
            { value: 2.1, label: 'Loose' },
          ]}
        />
      </div>

      <div className="setting">
        <span className="setting-label">Side margins</span>
        <Choices
          value={s.margin}
          onChange={(margin) => set({ margin })}
          options={[
            { value: 'narrow', label: 'Narrow' },
            { value: 'normal', label: 'Normal' },
            { value: 'wide', label: 'Wide' },
          ]}
        />
      </div>

      <div className="setting">
        <span className="setting-label">Theme</span>
        <Choices
          value={s.theme}
          onChange={(theme) => set({ theme })}
          options={themes.map((t) => ({
            value: t.value,
            label: (
              <>
                {t.value !== 'auto' && <span className="swatch" style={{ background: THEME_BG[t.value] }} />}
                {t.label}
              </>
            ),
          }))}
        />
      </div>

      <div className="setting">
        <label className="toggle-row">
          Justify text (straight right edge)
          <input type="checkbox" checked={s.justify} onChange={(e) => set({ justify: e.target.checked })} />
        </label>
        <label className="toggle-row">
          Trim page margins (Page view)
          <input type="checkbox" checked={s.trim} onChange={(e) => set({ trim: e.target.checked })} />
        </label>
      </div>
    </Sheet>
  )
}

export function TocSheet({
  toc,
  currentBlock,
  currentPage,
  mode,
  onPick,
  onClose,
}: {
  toc: TocItem[]
  currentBlock: number
  currentPage: number
  mode: ReadMode
  onPick: (item: TocItem) => void
  onClose: () => void
}) {
  let current = -1
  toc.forEach((t, i) => {
    if (mode === 'reflow' ? t.block <= currentBlock : t.page <= currentPage) current = i
  })

  return (
    <Sheet title="Chapters" onClose={onClose}>
      {toc.length === 0 ? (
        <p style={{ color: 'var(--muted)', lineHeight: 1.5 }}>
          This PDF doesn't have a chapter list, and no chapter headings were found. Use the slider at the bottom
          to move around the book.
        </p>
      ) : (
        <ol className="toc-list">
          {toc.map((t, i) => (
            <li key={i}>
              <button className={i === current ? 'current' : undefined} onClick={() => onPick(t)}>
                <span>{t.title}</span>
                <span className="toc-page">{t.page}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </Sheet>
  )
}
