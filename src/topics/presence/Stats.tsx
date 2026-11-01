import { ArrowIcon, Chip, ClockIcon, GaugeIcon, StackIcon } from '../../core/hud'
import type { PanelProps } from '../../core/types'
import type { PresenceMetrics, PresenceSim } from './engine'
import type { Beat, PresenceState } from './types'

const count = (n: number) => n.toLocaleString('en-US')

export default function Stats({ beat, m }: PanelProps<PresenceState, PresenceSim, PresenceMetrics, Beat>) {
  const hud = new Set(beat.hud ?? [])
  return (
    <>
      {hud.has('seen') && <Chip icon={<StackIcon />} title="Watcher sees" value={m.shown ? 'Online' : 'Offline'} bad={m.shown !== m.up} />}
      {hud.has('stale') && <Chip icon={<ClockIcon />} title="Wrong for" value={`${m.stale}s`} bad={m.stale > 30} />}
      {hud.has('pings') && <Chip icon={<ArrowIcon />} title="Pings sent" value={`${m.pings}`} />}
      {hud.has('flips') && <Chip icon={<StackIcon />} title="Changes the watcher saw" value={`${m.flips}`} bad={m.flips > 2} />}
      {hud.has('updates') && <Chip icon={<ArrowIcon />} title="Updates sent" value={`${m.updates}`} />}
      {hud.has('load') && <Chip icon={<GaugeIcon />} title="Pings per second, 1 million phones" value={`${count(m.load)} of ${count(m.cap)}`} bad={m.load > m.cap} />}
      {hud.has('fan') && <Chip icon={<GaugeIcon />} title="Updates per second, 1 million phones" value={count(m.fan)} bad={m.fan > 100_000} />}
    </>
  )
}
