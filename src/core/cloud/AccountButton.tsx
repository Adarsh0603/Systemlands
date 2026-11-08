import { useEffect, useRef, useState } from 'react'
import { askConfirm } from '../ConfirmDialog'
import { openSignIn, setUser, useSession } from './session'

type Cloud = typeof import('./cloud')

// Sign in with Google to keep progress across devices. The sign-in code loads
// in its own chunk, so it never slows the first paint.
export default function AccountButton() {
  const [cloud, setCloud] = useState<Cloud | null>(null)
  const { user } = useSession()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  // A press anywhere outside the menu, or Escape, closes it.
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', escape)
    }
  }, [open])

  useEffect(() => {
    let dead = false
    let off: (() => void) | undefined
    void import('./cloud')
      .then((m) => {
        if (dead) return
        setCloud(m)
        off = m.watchUser(setUser)
      })
      .catch(() => {})
    return () => {
      dead = true
      off?.()
    }
  }, [])

  if (!cloud) return null
  if (!user) {
    return (
      <button
        onClick={openSignIn}
        className="rounded-full border border-line px-3 py-1 font-mono text-xs text-muted transition hover:text-fg"
      >
        Sign in
      </button>
    )
  }
  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Account"
        className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-line bg-bg font-mono text-xs transition hover:border-fg"
      >
        {user.photo ? <img src={user.photo} alt="" referrerPolicy="no-referrer" className="h-full w-full" /> : user.name.slice(0, 1)}
      </button>
      {open && (
        <div className="absolute right-0 top-9 w-56 rounded-xl border border-line bg-bg p-3 text-sm shadow-lg">
          <div className="truncate font-medium">{user.name}</div>
          <div className="truncate text-xs text-muted">{user.email}</div>
          <p className="mt-2 text-xs text-muted">Your progress and builds are saved to your account.</p>
          <button
            onClick={async () => {
              setOpen(false)
              const ok = await askConfirm({
                title: 'Sign out?',
                body: 'This clears the progress and builds on this device. They stay saved in your account.',
                confirm: 'Sign out',
              })
              if (ok) void cloud.logOut()
            }}
            className="mt-3 w-full rounded-lg border border-line px-3 py-1.5 text-xs transition hover:border-fg"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
