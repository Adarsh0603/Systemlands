import { useTicker } from '../../core/flow/useTicker'
import type { Runtime, TopicSpec } from '../../core/types'
import { CHAPTERS } from './chapters'
import Controls from './Controls'
import { LockingSim, type LockingMetrics } from './engine'
import Scene from './Scene'
import Stats from './Stats'
import type { Beat, LockingState } from './types'
import { TICKS_PER_SECOND } from './world'

function useRuntime(stRef: { current: LockingState }, paused: boolean): Runtime<LockingSim, LockingMetrics> {
  const { sim, simRef, lastTickAt } = useTicker(
    () => {
      const s = new LockingSim()
      s.apply(stRef.current)
      return s
    },
    TICKS_PER_SECOND,
    paused,
  )
  return { sim, simRef, lastTickAt, metrics: sim.metrics, tick: sim.tick }
}

export const locking: TopicSpec<LockingState, LockingSim, LockingMetrics, Beat> = {
  chapters: CHAPTERS,
  useRuntime,
  sync: (sim, st) => sim.apply(st),
  Scene,
  Stats,
  Controls,
  feedback: () => ({}),
  dropCount: () => 0,
}
