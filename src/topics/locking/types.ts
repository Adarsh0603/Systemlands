import type { BaseBeat, Chapter } from '../../core/types'
import type { LockingMetrics, LockingSim } from './engine'

// How a buyer keeps others away from the seats while buying:
//   none:    read how many are left, then write one fewer
//   lock:    take a lock from the lock service first, and let go once done
//   version: no lock; the write only counts if the row is still the version that was read
export type Mode = 'none' | 'lock' | 'version'

// What a lock holder does before letting go:
//   pay:  takes the seat and charges the card while holding the lock
//   seat: takes the seat and lets go; the card is charged after
export type Hold = 'pay' | 'seat'

// Who turns up when sales open, and how many seats there are.
export type Crowd = 'two' | 'four' | 'eight' | 'quiet' | 'rush'

// What goes wrong with the first buyer to take the lock in a sale.
export type Fault = 'none' | 'crash' | 'pause'

export interface LockingState {
  mode: Mode
  hold: Hold
  lease: number // seconds a lock lasts before the lock service lets go by itself; 0 means never
  fence: boolean // the database turns down writes that carry an older lock number
  crowd: Crowd
  fault: Fault
  sale: number // goes up to open a new sale; 0 means sales have not opened
  round: number // goes up to forget past results
}

export type TagId = 'parties' | 'left' | 'seats' | 'lock'
export type HudId = 'left' | 'sold' | 'twice' | 'wait' | 'avg' | 'tries' | 'retries' | 'rejected'
export type ControlId = 'mode' | 'hold' | 'lease' | 'fence' | 'crowd' | 'sale'

export interface Beat extends BaseBeat<LockingState, LockingSim, LockingMetrics> {
  tags?: TagId[]
  hud?: HudId[]
  controls?: ControlId[]
  // Which ways to buy the mode control offers, when not all of them.
  modes?: Mode[]
}

export type LockingChapter = Chapter<LockingState, Beat>
