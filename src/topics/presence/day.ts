// The last chapter plays one day in a fixed order: tunnels, then a server restart,
// then the phone dies. Each event is judged once it has played out.

import type { Act, PresenceMetrics } from './engine'
import { OPEN } from './world'

export const DAY: Act[] = ['tunnel', 'crash', 'die']

export const DAY_LABEL: Partial<Record<Act, string>> = {
  tunnel: 'Sam drives through two tunnels',
  crash: 'Restart the server',
  die: 'Sam’s phone dies',
}

// What is happening while an event plays out.
export const DAY_WATCH: Partial<Record<Act, string>> = {
  tunnel: 'Sam is in the tunnels. Watch the dot…',
  crash: 'The server is coming back. Watch the dot…',
  die: 'The phone is dark. Waiting for the server to notice…',
}

export type PartState = 'todo' | 'pass' | 'fail'
export interface Part {
  label: string
  state: PartState
}

const judge = (done: boolean, ok: boolean): PartState => (!done ? 'todo' : ok ? 'pass' : 'fail')

export function dayParts(m: PresenceMetrics): Part[] {
  const { tunnel, crash, die } = m.marks
  return [
    { label: 'Tunnels: the dot stays steady', state: judge(!!tunnel, !!tunnel && tunnel.flips === 0 && tunnel.right) },
    { label: 'Restart: back by itself, no pings lost', state: judge(!!crash, !!crash && crash.right && crash.lost === 0) },
    { label: 'Phone dies: offline within 40s', state: judge(!!die, !!die && die.right && die.late <= 40 && die.lost === 0) },
    { label: 'Only open chats are told', state: judge(!!die, m.perChange <= OPEN) },
  ]
}

// Where the day stands: the next event to play, one playing out, or the end.
export type DayStep = { next: Act } | { playing: Act } | { over: true; won: boolean }

export function dayStep(m: PresenceMetrics): DayStep {
  const count: Partial<Record<Act, number>> = { tunnel: m.tunnels, crash: m.crashes, die: m.dies }
  for (const act of DAY) {
    if (!count[act]) return { next: act }
    if (!m.marks[act]) return { playing: act }
  }
  return { over: true, won: dayParts(m).every((p) => p.state === 'pass') }
}
