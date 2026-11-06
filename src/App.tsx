import { useEffect, useState } from 'react'
import { Library } from './components/Library'
import { Reader } from './components/Reader'
import { resumeProcessing } from './lib/library'
import { THEME_BG, useResolvedTheme } from './lib/settings'

/** "#/read/<id>" opens a book; anything else shows the library. */
function useRoute() {
  const parse = () => /^#\/read\/([\w-]+)$/.exec(location.hash)?.[1] ?? null
  const [bookId, setBookId] = useState(parse)
  useEffect(() => {
    const onHash = () => setBookId(parse())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return bookId
}

// True once a book was opened from the library during this visit, so closing
// it can go "back" (keeping the browser/Android back button in sync).
let openedFromLibrary = false

export default function App() {
  const bookId = useRoute()
  const theme = useResolvedTheme()

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_BG[theme])
  }, [theme])

  // Finish preparing any book that was interrupted when the app was closed.
  useEffect(() => {
    void resumeProcessing()
  }, [])

  const open = (id: string) => {
    openedFromLibrary = true
    location.hash = `#/read/${id}`
  }
  const close = () => {
    if (openedFromLibrary) history.back()
    else location.hash = ''
    openedFromLibrary = false
  }

  return bookId ? <Reader key={bookId} id={bookId} onClose={close} /> : <Library onOpen={open} />
}
