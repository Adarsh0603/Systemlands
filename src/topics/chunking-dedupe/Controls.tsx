import { Segmented } from '../../core/controls'
import type { PanelProps } from '../../core/types'
import type { ChunkMetrics, ChunkSim } from './engine'
import type { Beat, ChunkState, Mode } from './types'

const MODES: { value: Mode; label: string }[] = [
  { value: 'whole', label: 'Whole file' },
  { value: 'fixed', label: 'Every so many lines' },
  { value: 'content', label: 'Where the content says' },
]

const SIZES: { value: number; label: string }[] = [2, 3, 4, 6, 8, 12].map((n) => ({ value: n, label: `${n} lines` }))

const ASK: { value: 'send' | 'ask'; label: string }[] = [
  { value: 'send', label: 'Send every chunk' },
  { value: 'ask', label: 'Ask the store first' },
]

const Row = ({ children }: { children: React.ReactNode }) => <div className="mt-4">{children}</div>

const Button = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button onClick={onClick} className="rounded-xl bg-fg px-5 py-2 text-sm font-medium text-bg transition hover:opacity-90">
    {children}
  </button>
)

export default function Controls({ beat, st, update }: PanelProps<ChunkState, ChunkSim, ChunkMetrics, Beat>) {
  const controls = new Set(beat.controls ?? [])
  return (
    <>
      {(controls.has('edit') || controls.has('insert') || controls.has('copy')) && (
        <Row>
          <div className="flex flex-wrap gap-2">
            {controls.has('edit') && <Button onClick={() => update((prev) => ({ edit: prev.edit + 1 }))}>Change a line</Button>}
            {controls.has('insert') && <Button onClick={() => update((prev) => ({ insert: prev.insert + 1 }))}>Add a line at the top</Button>}
            {controls.has('copy') && <Button onClick={() => update((prev) => ({ copy: prev.copy + 1 }))}>Another person uploads it</Button>}
          </div>
        </Row>
      )}
      {controls.has('mode') && (
        <Row>
          <Segmented scroll value={st.mode} options={MODES} onChange={(v) => update(() => ({ mode: v }))} />
        </Row>
      )}
      {controls.has('size') && (
        <Row>
          <Segmented scroll value={st.size} options={SIZES} onChange={(v) => update(() => ({ size: v }))} />
        </Row>
      )}
      {controls.has('ask') && (
        <Row>
          <Segmented scroll value={st.ask ? 'ask' : 'send'} options={ASK} onChange={(v) => update(() => ({ ask: v === 'ask' }))} />
        </Row>
      )}
    </>
  )
}
