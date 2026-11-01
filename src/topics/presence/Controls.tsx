import { Segmented } from '../../core/controls'
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

const Row = ({ children }: { children: React.ReactNode }) => <div className="mt-4">{children}</div>

const Button = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button onClick={onClick} className="rounded-xl bg-fg px-5 py-2 text-sm font-medium text-bg transition hover:opacity-90">
    {children}
  </button>
)

export default function Controls({ beat, st, update }: PanelProps<PresenceState, PresenceSim, PresenceMetrics, Beat>) {
  const controls = new Set(beat.controls ?? [])
  const acts = (['leave', 'die', 'back', 'tunnel', 'crash'] as const).filter((k) => controls.has(k))
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
      {controls.has('mode') && (
        <Row>
          <Segmented scroll value={st.mode} options={MODES} onChange={(v) => update(() => ({ mode: v }))} />
        </Row>
      )}
      {controls.has('interval') && (
        <Row>
          <Segmented scroll value={st.interval} options={INTERVALS} onChange={(v) => update(() => ({ interval: v }))} />
        </Row>
      )}
      {controls.has('grace') && (
        <Row>
          <Segmented scroll value={st.grace} options={GRACES} onChange={(v) => update(() => ({ grace: v }))} />
        </Row>
      )}
      {controls.has('audience') && (
        <Row>
          <Segmented scroll value={st.audience} options={AUDIENCES} onChange={(v) => update(() => ({ audience: v }))} />
        </Row>
      )}
      {controls.has('store') && (
        <Row>
          <Segmented scroll value={st.store} options={STORES} onChange={(v) => update(() => ({ store: v }))} />
        </Row>
      )}
    </>
  )
}
