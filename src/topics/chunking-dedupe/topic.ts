import { useTicker } from '../../core/flow/useTicker'
import type { Runtime, TopicSpec } from '../../core/types'
import { CHAPTERS } from './chapters'
import Controls from './Controls'
import { ChunkSim, type ChunkMetrics } from './engine'
import Scene from './Scene'
import Stats from './Stats'
import type { Beat, ChunkState } from './types'
import { TICKS_PER_SECOND } from './world'

function useRuntime(stRef: { current: ChunkState }, paused: boolean): Runtime<ChunkSim, ChunkMetrics> {
  const { sim, simRef, lastTickAt } = useTicker(
    () => {
      const s = new ChunkSim()
      s.apply(stRef.current)
      return s
    },
    TICKS_PER_SECOND,
    paused,
  )
  return { sim, simRef, lastTickAt, metrics: sim.metrics, tick: sim.tick }
}

export const chunkingDedupe: TopicSpec<ChunkState, ChunkSim, ChunkMetrics, Beat> = {
  chapters: CHAPTERS,
  useRuntime,
  sync: (sim, st) => sim.apply(st),
  Scene,
  Stats,
  Controls,
  feedback: () => ({}),
  dropCount: () => 0,
}
