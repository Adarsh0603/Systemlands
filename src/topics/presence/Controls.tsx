import { Segmented, Select } from '../../core/controls'
import { DAY, DAY_LABEL, DAY_WATCH, dayStep } from './day'
import type { PanelProps } from '../../core/types'
import type { PresenceMetrics, PresenceSim } from './engine'
import type { Audience, Beat, Mode, PresenceState, Store } from './types'

const MODES: { value: Mode; label: string }[] = [
  { value: 'flag', label: 'Hello and goodbye' },
  { value: 'beat', label: 'Heartbeats' },
]

const INTERVALS = [1, 2, 5, 10, 20, 40].map((n) => ({ value: n, label: `Every ${n}s` }))
const GRACES = [0, 5, 10, 20].map((n) => ({ value: n, label: n === 0 ? 'No wait' : `Wait ${n}s` }))

const AUDIENCES: { value: Audience; label: string }[] = [
  { value: 'all', label: 'Tell every contact' },
  { value: 'open', label: 'Only chats on screen' },
]

const STORES: { value: Store; label: string }[] = [
  { value: 'disk', label: 'On disk' },
  { value: 'memory', label: 'In memory, with expiry' },
]

const OPTIONS = { mode: MODES, interval: INTERVALS, grace: GRACES, audience: AUDIENCES, store: STORES }
// Shorter wording for the packed dropdowns of the last chapter.
const SHORT = {
  mode: [
    { value: 'flag', label: 'Hello/bye' },
    { value: 'beat', label: 'Heartbeats' },
  ],
  interval: INTERVALS,
  grace: GRACES,
  audience: [
    { value: 'all', label: 'All contacts' },
    { value: 'open', label: 'Open chats' },
  ],
  store: [
    { value: 'disk', label: 'Disk' },
    { value: 'memory', label: 'Memory' },
  ],
}
const NAMES = { mode: 'How Sam reports', interval: 'Heartbeat interval', grace: 'Wait before offline', audience: 'Who is told', store: 'Where presence lives' }

const Row = ({ children }: { children: React.ReactNode }) => <div className="mt-4">{children}</div>

const Button = ({ onClick, wide, children }: { onClick: () => void; wide?: boolean; children: React.ReactNode }) => (
  <button
    onClick={onClick}
    className={`rounded-xl bg-fg px-5 py-2 text-sm font-medium text-bg transition hover:opacity-90 ${wide ? 'w-full sm:w-auto' : ''}`}
  >
    {children}
  </button>
)

const SETTINGS = ['mode', 'interval', 'grace', 'audience', 'store'] as const

export default function Controls({ beat, st, m, update }: PanelProps<PresenceState, PresenceSim, PresenceMetrics, Beat>) {
  const controls = new Set(beat.controls ?? [])
  const settings = SETTINGS.filter((k) => controls.has(k))
  // Many settings at once (the last chapter) would fill a phone screen as rows of pills, so they become dropdowns.
  const compact = settings.length > 2
  const acts = beat.day ? [] : (['leave', 'die', 'back', 'tunnel', 'crash'] as const).filter((k) => controls.has(k))
  const label = {
    leave: 'Sam closes the app',
    die: 'Sam’s phone dies',
    back: 'Sam is back',
    tunnel: 'Sam drives through two tunnels',
    crash: 'Restart the server',
  }
  return (
    <>
      {acts.length > 0 && (
        <Row>
          <div className="flex flex-wrap gap-2">
            {acts.map((k) => (
              <Button key={k} onClick={() => update((prev) => ({ [k]: prev[k] + 1 }))}>
                {label[k]}
              </Button>
            ))}
          </div>
        </Row>
      )}
      {compact ? (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {settings.map((k) => (
            <Select
              key={k}
              fill
              compact
              label={NAMES[k]}
              value={st[k] as string | number}
              options={SHORT[k] as { value: string | number; label: string }[]}
              onChange={(v) => update(() => ({ [k]: v }))}
            />
          ))}
        </div>
      ) : (
        settings.map((k) => (
          <Row key={k}>
            <Segmented
              scroll
              value={st[k] as string | number}
              options={OPTIONS[k] as { value: string | number; label: string }[]}
              onChange={(v) => update(() => ({ [k]: v }))}
            />
          </Row>
        ))
      )}
      {beat.day && <Day m={m} update={update} />}
    </>
  )
}

// One event at a time: the button for the next one, what to watch while it plays, or a retry.
function Day({ m, update }: Pick<PanelProps<PresenceState, PresenceSim, PresenceMetrics, Beat>, 'm' | 'update'>) {
  const step = dayStep(m)
  if ('over' in step) {
    if (step.won) return null
    return (
      <div className="mt-2 flex items-center gap-3">
        <span className="min-w-0 flex-1 text-xs text-muted">Not quite. Change a setting, or</span>
        <Button onClick={() => update((prev) => ({ round: prev.round + 1 }))}>Start the day again</Button>
      </div>
    )
  }
  const act = 'next' in step ? step.next : step.playing
  const n = DAY.indexOf(act) + 1
  return (
    <div className="mt-2">
      {'next' in step ? (
        <Button wide onClick={() => update((prev) => ({ [act]: prev[act] + 1 }))}>
          {n}/{DAY.length} · {DAY_LABEL[act]}
        </Button>
      ) : (
        <div className="flex h-9 items-center gap-2 text-sm text-muted" aria-live="polite">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-fg" />
          {DAY_WATCH[act]}
        </div>
      )}
    </div>
  )
}
