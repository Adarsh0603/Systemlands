import { Segmented } from '../../core/controls'
import type { PanelProps } from '../../core/types'
import type { LockingMetrics, LockingSim } from './engine'
import type { Beat, Crowd, Hold, LockingState, Mode } from './types'

const MODES: { value: Mode; label: string }[] = [
  { value: 'none', label: 'Read, then write' },
  { value: 'lock', label: 'Take a lock' },
  { value: 'version', label: 'Check the version' },
]

const HOLDS: { value: Hold; label: string }[] = [
  { value: 'pay', label: 'Hold it through the payment' },
  { value: 'seat', label: 'Hold it only to take the seat' },
]

const LEASES = [0, 1, 5, 60].map((n) => ({ value: n, label: n === 0 ? 'Never runs out' : `Lease of ${n}s` }))

const FENCES: { value: number; label: string }[] = [
  { value: 0, label: 'Any write' },
  { value: 1, label: 'Turn down old lock numbers' },
]

const CROWDS: { value: Crowd; label: string }[] = [
  { value: 'quiet', label: 'Quiet Tuesday' },
  { value: 'rush', label: 'Concert rush' },
]

const Row = ({ children }: { children: React.ReactNode }) => <div className="mt-3">{children}</div>

export default function Controls({ beat, st, m, update }: PanelProps<LockingState, LockingSim, LockingMetrics, Beat>) {
  const controls = new Set(beat.controls ?? [])
  const modes = beat.modes ? MODES.filter((o) => beat.modes!.includes(o.value)) : MODES
  return (
    <>
      {controls.has('crowd') && (
        <Row>
          <Segmented scroll value={st.crowd} options={CROWDS} onChange={(v) => update(() => ({ crowd: v }))} />
        </Row>
      )}
      {controls.has('mode') && (
        <Row>
          <Segmented scroll value={st.mode} options={modes} onChange={(v) => update(() => ({ mode: v }))} />
        </Row>
      )}
      {controls.has('hold') && (
        <Row>
          <Segmented scroll value={st.hold} options={HOLDS} onChange={(v) => update(() => ({ hold: v }))} />
        </Row>
      )}
      {controls.has('lease') && (
        <Row>
          <Segmented scroll value={st.lease} options={LEASES} onChange={(v) => update(() => ({ lease: v }))} />
        </Row>
      )}
      {controls.has('fence') && (
        <Row>
          <Segmented scroll value={st.fence ? 1 : 0} options={FENCES} onChange={(v) => update(() => ({ fence: v === 1 }))} />
        </Row>
      )}
      {controls.has('sale') && (
        <Row>
          <div className="flex items-center gap-3">
            <button
              onClick={() => update((prev) => ({ sale: prev.sale + 1 }))}
              className="rounded-xl bg-fg px-5 py-2 text-sm font-medium text-bg transition hover:opacity-90"
            >
              Open sales again
            </button>
            <span className="min-w-0 flex-1 text-xs text-muted" aria-live="polite">
              {m.stuck ? 'Everyone is waiting for a lock that will never be let go.' : m.done ? 'This sale is over.' : 'Selling…'}
            </span>
          </div>
        </Row>
      )}
    </>
  )
}
