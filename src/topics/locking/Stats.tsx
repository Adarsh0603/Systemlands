import { ArrowIcon, Chip, ClockIcon, CrossIcon, GaugeIcon, StackIcon } from '../../core/hud'
import type { PanelProps } from '../../core/types'
import { RUSH_TRIES, type LockingMetrics, type LockingSim } from './engine'
import type { Beat, LockingState } from './types'

export default function Stats({ beat, m }: PanelProps<LockingState, LockingSim, LockingMetrics, Beat>) {
  const hud = new Set(beat.hud ?? [])
  const perTicket = m.tickets ? m.tries / m.tickets : 0
  return (
    <>
      {hud.has('left') && <Chip icon={<StackIcon />} title="Seats left" value={`${m.left} of ${m.seats}`} />}
      {hud.has('sold') && <Chip icon={<StackIcon />} title="Tickets sold" value={`${m.tickets}`} bad={m.tickets > m.seats || m.twice > 0} />}
      {hud.has('twice') && <Chip icon={<CrossIcon />} title="Seats sold twice" value={`${m.twice}`} bad={m.twice > 0} />}
      {hud.has('wait') && <Chip icon={<ClockIcon />} title={m.stuck ? 'Waiting for a lock that never frees' : 'Longest wait for the lock'} value={`${m.longest.toFixed(1)}s`} bad={m.stuck || m.longest > 15} />}
      {hud.has('avg') && <Chip icon={<ClockIcon />} title="Average time to buy" value={`${m.avg.toFixed(2)}s`} />}
      {hud.has('tries') && <Chip icon={<GaugeIcon />} title="Writes per ticket" value={perTicket.toFixed(1)} bad={perTicket > RUSH_TRIES} />}
      {hud.has('retries') && <Chip icon={<ArrowIcon />} title="Writes turned down" value={`${m.retries}`} />}
      {hud.has('rejected') && <Chip icon={<CrossIcon />} title="Late writes stopped" value={`${m.rejected}`} />}
    </>
  )
}
