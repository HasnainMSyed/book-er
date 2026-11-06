import { useSyncExternalStore } from 'react'

export type Theme = 'auto' | 'light' | 'sepia' | 'dark'
export type FontChoice = 'serif' | 'sans' | 'book' | 'mono'

export type Settings = {
  fontSize: number // CSS px
  font: FontChoice
  lineHeight: number
  margin: 'narrow' | 'normal' | 'wide'
  justify: boolean
  theme: Theme
  /** Page view: crop the empty margins around the printed area. */
  trim: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  fontSize: 20,
  font: 'serif',
  lineHeight: 1.6,
  margin: 'normal',
  justify: false,
  theme: 'auto',
  trim: true,
}

export const FONT_STACKS: Record<FontChoice, string> = {
  serif: 'ui-serif, "New York", Georgia, "Times New Roman", serif',
  book: '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  mono: 'ui-monospace, Menlo, Consolas, monospace',
}

export const MARGINS: Record<Settings['margin'], string> = { narrow: '12px', normal: '22px', wide: '36px' }

const KEY = 'booker:settings'

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    // Storage blocked or bad data: use defaults.
  }
  return DEFAULT_SETTINGS
}

let current = load()
const listeners = new Set<() => void>()

export function getSettings(): Settings {
  return current
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    // Not saved, but still applied for this visit.
  }
  listeners.forEach((fn) => fn())
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    () => current,
  )
}

// ---------- theme ----------

const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null

export function useResolvedTheme(): Exclude<Theme, 'auto'> {
  const { theme } = useSettings()
  const systemDark = useSyncExternalStore(
    (fn) => {
      darkQuery?.addEventListener('change', fn)
      return () => darkQuery?.removeEventListener('change', fn)
    },
    () => darkQuery?.matches ?? false,
  )
  if (theme === 'auto') return systemDark ? 'dark' : 'light'
  return theme
}

export const THEME_BG: Record<Exclude<Theme, 'auto'>, string> = {
  light: '#FFFFFF',
  sepia: '#F3E9D2',
  dark: '#121212',
}
