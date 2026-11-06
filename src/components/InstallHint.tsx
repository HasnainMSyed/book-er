import { useEffect, useState } from 'react'
import { browserName, isInstalled, isIOS } from '../lib/platform'
import { Icon } from './Icon'

const KEY = 'booker:install-hint-dismissed'

type InstallEvent = Event & { prompt: () => Promise<void> }

function iosSteps() {
  switch (browserName()) {
    case 'safari':
      return (
        <>
          Tap <strong>Share</strong> <Icon name="share" size={16} /> at the bottom of Safari, then{' '}
          <strong>Add to Home Screen</strong>.
        </>
      )
    case 'chrome':
      return (
        <>
          Tap <strong>Share</strong> <Icon name="share" size={16} /> in the address bar, then{' '}
          <strong>Add to Home Screen</strong>.
        </>
      )
    default:
      return (
        <>
          Open your browser's <strong>Share</strong> <Icon name="share" size={16} /> menu, then tap{' '}
          <strong>Add to Home Screen</strong>.
        </>
      )
  }
}

/** Explains how to put Book-er on the home screen, until it's installed or dismissed. */
export function InstallHint() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1'
    } catch {
      return false
    }
  })
  const [androidPrompt, setAndroidPrompt] = useState<InstallEvent | null>(null)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setAndroidPrompt(e as InstallEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  if (dismissed || isInstalled() || (!isIOS && !androidPrompt)) return null

  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      // Hint will just show again next time.
    }
  }

  return (
    <aside className="notice" aria-label="Install Book-er">
      <div>
        <p>
          <strong>Put Book-er on your home screen.</strong> It opens like an app, works offline, and your books
          are kept safer.
        </p>
        {isIOS ? (
          <>
            <p>{iosSteps()}</p>
            <p className="small">
              The home-screen app keeps its own library, so add your books after installing.
            </p>
          </>
        ) : (
          <button className="btn" style={{ marginTop: 8 }} onClick={() => void androidPrompt?.prompt()}>
            Install app
          </button>
        )}
      </div>
      <button className="icon-btn" onClick={dismiss} aria-label="Dismiss">
        <Icon name="close" size={20} />
      </button>
    </aside>
  )
}
