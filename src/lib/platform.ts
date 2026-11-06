/** True on iPhone and iPad (iPadOS reports itself as a Mac with a touch screen). */
export const isIOS =
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)

/** True when opened from the home screen icon rather than a browser tab. */
export function isInstalled() {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function browserName(): 'chrome' | 'firefox' | 'edge' | 'safari' | 'other' {
  const ua = navigator.userAgent
  // Order matters: Edge also says "Chrome", and every iOS browser says "Safari".
  if (/EdgiOS|Edg\//.test(ua)) return 'edge'
  if (/FxiOS|Firefox/.test(ua)) return 'firefox'
  if (/CriOS|Chrome/.test(ua)) return 'chrome'
  if (/Safari/.test(ua)) return 'safari'
  return 'other'
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}
