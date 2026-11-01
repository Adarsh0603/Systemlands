import { ArrowIcon, Chip, GaugeIcon, StackIcon } from '../../core/hud'
import type { PanelProps } from '../../core/types'
import type { ChunkMetrics, ChunkSim } from './engine'
import { FILE_UNITS } from './engine'
import type { Beat, ChunkState } from './types'

export default function Stats({ beat, m }: PanelProps<ChunkState, ChunkSim, ChunkMetrics, Beat>) {
  const hud = new Set(beat.hud ?? [])
  return (
    <>
      {hud.has('sent') && <Chip icon={<ArrowIcon />} title="Sent last time" value={`${m.sentLast} of ${FILE_UNITS} lines`} bad={m.uploads > 0 && m.sentLast > FILE_UNITS / 2} />}
      {hud.has('total') && <Chip icon={<ArrowIcon />} title="Sent in all" value={`${m.sentTotal} lines`} />}
      {hud.has('chunks') && <Chip icon={<StackIcon />} title="Chunks in the file" value={`${m.chunks}`} bad={m.chunks > 9} />}
      {hud.has('stored') && <Chip icon={<GaugeIcon />} title="Kept in the store" value={`${m.stored} lines`} bad={m.stored > m.unique} />}
      {hud.has('uploads') && <Chip icon={<StackIcon />} title="Uploads" value={`${m.uploads}`} />}
    </>
  )
}
