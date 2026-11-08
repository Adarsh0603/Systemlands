import type { BaseBeat, Chapter } from '../../core/types'
import type { PresenceMetrics, PresenceSim } from './engine'

// How the server learns that a phone is online:
//   flag: the phone says hello and goodbye, and the server believes the last thing it heard
//   beat: the phone also pings every `interval` seconds, and the server gives up on a phone that goes quiet
export type Mode = 'flag' | 'beat'

// Who is told when the status changes:
//   all:  every contact
//   open: only the people who have this chat on screen right now
export type Audience = 'all' | 'open'

// Where the server keeps the status: on disk, or in memory with an expiry.
export type Store = 'disk' | 'memory'

export interface PresenceState {
  mode: Mode
  interval: number // seconds between pings
  grace: number // seconds the server waits before saying "offline"
  audience: Audience
  store: Store
  leave: number // goes up each time the phone closes the app politely
  die: number // goes up each time the phone goes dark without a word
  back: number // goes up each time the phone comes back
  tunnel: number // goes up each time the phone drives through two tunnels
  crash: number // goes up each time the presence server restarts
  round: number // goes up to start again
}

export type TagId = 'parties' | 'status' | 'contacts' | 'load'
export type HudId = 'seen' | 'stale' | 'pings' | 'flips' | 'updates' | 'load' | 'fan'
export type ControlId = 'leave' | 'die' | 'back' | 'tunnel' | 'crash' | 'mode' | 'interval' | 'grace' | 'audience' | 'store'

export interface Beat extends BaseBeat<PresenceState, PresenceSim, PresenceMetrics> {
  tags?: TagId[]
  hud?: HudId[]
  controls?: ControlId[]
  day?: boolean // play tunnels, a restart and a dead phone one at a time, in that order
}

export type PresenceChapter = Chapter<PresenceState, Beat>
