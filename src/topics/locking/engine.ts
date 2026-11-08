// Selling the last seats.
//
//   buyers ──▶ lock service ──▶ database (seats left, version, highest lock number)
//
// The database keeps one row: how many seats are left. Every buyer reads it, does a little
// work, and writes one fewer. The seat a buyer gets is the one that count pointed at.
//
//   - none:    nothing stops two buyers reading the same count, so both take the same seat.
//   - lock:    a buyer first takes the lock. The lock service hands it to one buyer at a time
//              and keeps a line of the others. A lease lets go of the lock by itself, and each
//              hand-out carries a number that goes up (a fencing token).
//   - version: the write says "one fewer, if the row is still version v". If someone wrote in
//              between, it is turned down, and the buyer reads again.
//
// Faults hit the first buyer to hold the lock in a sale: a crash (it never lets go) or a pause
// (it freezes, then carries on as if nothing happened).

import type { Crowd, LockingState } from './types'
import { TICKS_PER_SECOND } from './world'

const DB_TRIP = 3 // ticks from a buyer to the database
const LOCK_TRIP = 8 // ticks from a buyer to the lock service
export const WORK = { pay: 60, seat: 4 } // ticks of work between reading and writing
export const PAUSE = 8 * TICKS_PER_SECOND // how long a paused holder freezes

// When each buyer arrives after sales open (ticks), and how many seats there are.
export const CROWDS: Record<Crowd, { at: number[]; seats: number }> = {
  two: { at: [0, 0], seats: 1 },
  four: { at: [0, 1, 2, 3], seats: 4 },
  eight: { at: [0, 1, 2, 3, 4, 5, 6, 7], seats: 8 },
  // A quiet day: two fans collide once, the rest come one by one.
  quiet: { at: [0, 1, 60, 120, 180, 240], seats: 6 },
  // A big on-sale: twelve fans within a moment.
  rush: { at: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], seats: 12 },
}

// What a day must achieve in the last chapter.
export const QUIET_AVG = 1.2 // seconds, average time to buy on a quiet day
export const RUSH_TRIES = 2 // writes per ticket in a rush

export type Phase =
  | 'coming' // has not arrived yet
  | 'asking' // asked the lock service for the lock
  | 'queued' // in line for the lock
  | 'reading' // asked the database how many are left
  | 'working' // charging the card, or filling in the form
  | 'paused' // frozen, still believing it holds the lock
  | 'writing' // sent the write
  | 'ticket' // has a ticket
  | 'soldout' // was told there are none left
  | 'crashed' // its server died

export interface Buyer {
  id: number
  phase: Phase
  arriveAt: number
  arrived: number // tick it arrived, or -1
  until: number // when the current work or pause ends
  read: { left: number; version: number } | null
  token: number // the lock number it holds, 0 for none
  waitedFrom: number // when it asked for the lock, or -1 once it has it
  waited: number // the longest it has waited for the lock, ticks
  boughtAt: number
  seat: number // the seat on its ticket, or -1
  faulted: boolean
}

export type Place = 'buyer' | 'lock' | 'db'
export type Kind = 'acquire' | 'grant' | 'release' | 'read' | 'value' | 'write' | 'ok' | 'no'

export interface Msg {
  id: number
  buyer: number
  from: Place
  to: Place
  kind: Kind
  sentAt: number
  arrive: number
  left?: number
  version?: number
  token?: number
}

// What one finished sale came to, kept per crowd for the last chapter.
export interface Mark {
  mode: LockingState['mode']
  twice: number
  avg: number // seconds
  tries: number // writes per ticket
}
export type Marks = Partial<Record<Crowd, Mark>>

export interface LockingMetrics {
  seats: number
  left: number
  version: number
  tickets: number // tickets handed out
  twice: number // tickets for a seat that already had one
  served: number // buyers holding a ticket
  soldOut: number
  crashed: number
  longest: number // seconds, the longest anyone has waited for the lock
  avg: number // seconds, the average time from arriving to holding a ticket
  tries: number // writes sent
  retries: number // writes turned down by the version check
  rejected: number // writes turned down for carrying an old lock number
  expired: number // leases that ran out
  holder: number // who the lock service thinks holds the lock, or -1
  line: number // buyers in line for the lock
  open: boolean // sales have opened
  done: boolean // every buyer is finished and nothing is on its way
  stuck: boolean // buyers in line behind a lock that will never be let go
  marks: Marks
}

export class LockingSim {
  tick = 0
  buyers: Buyer[] = []
  msgs: Msg[] = []
  owners: number[][] = [] // seat → buyers holding a ticket for it
  left = 0
  version = 0
  highest = 0 // the highest lock number the database has seen
  holder = -1
  grantedAt = 0
  line: number[] = []
  // Who the scene should point at, and what just happened to them.
  who = ''
  whoAt = -9999

  private st: LockingState = { mode: 'none', hold: 'seat', lease: 0, fence: false, crowd: 'two', fault: 'none', sale: 0, round: 0 }
  private cfg: string | null = null
  private round = -1
  private msgId = 0
  private tokens = 0
  private faultLeft = false
  private tries = 0
  private retries = 0
  private rejected = 0
  private expired = 0
  private marked = false
  private marks: Marks = {}

  apply(st: LockingState) {
    this.st = st
    if (st.round !== this.round) {
      this.round = st.round
      this.marks = {}
    }
    const cfg = [st.mode, st.hold, st.lease, st.fence, st.crowd, st.fault, st.sale, st.round].join('|')
    if (cfg !== this.cfg) {
      this.cfg = cfg
      this.reset()
    }
  }

  private reset() {
    const crowd = CROWDS[this.st.crowd]
    this.msgs = []
    this.owners = Array.from({ length: crowd.seats }, () => [])
    this.left = crowd.seats
    this.version = 7
    this.highest = 0
    this.holder = -1
    this.line = []
    this.tokens = 0
    this.faultLeft = this.st.fault !== 'none'
    this.tries = this.retries = this.rejected = this.expired = 0
    this.marked = false
    this.who = ''
    this.whoAt = -9999
    const open = this.st.sale > 0
    this.buyers = crowd.at.map((at, id) => ({
      id,
      phase: 'coming',
      arriveAt: open ? this.tick + 1 + at : Infinity,
      arrived: -1,
      until: 0,
      read: null,
      token: 0,
      waitedFrom: -1,
      waited: 0,
      boughtAt: -1,
      seat: -1,
      faulted: false,
    }))
  }

  private send(buyer: number, from: Place, to: Place, kind: Kind, extra: Partial<Msg> = {}) {
    const trip = from === 'lock' || to === 'lock' ? LOCK_TRIP : DB_TRIP
    this.msgs.push({ id: this.msgId++, buyer, from, to, kind, sentAt: this.tick, arrive: this.tick + trip, ...extra })
  }

  private say(what: string) {
    this.who = what
    this.whoAt = this.tick
  }

  private ask(b: Buyer) {
    if (this.st.mode === 'lock') {
      b.phase = 'asking'
      b.waitedFrom = this.tick
      this.send(b.id, 'buyer', 'lock', 'acquire')
    } else this.readFor(b)
  }

  private readFor(b: Buyer) {
    b.phase = 'reading'
    this.send(b.id, 'buyer', 'db', 'read')
  }

  // The lock service hands the lock to the next buyer in line.
  private grantNext() {
    while (this.holder === -1 && this.line.length) {
      const next = this.line.shift()!
      this.holder = next
      this.grantedAt = this.tick
      this.send(next, 'lock', 'buyer', 'grant', { token: ++this.tokens })
    }
  }

  // A buyer is finished with the lock, whether it bought a seat or not.
  private letGo(b: Buyer) {
    if (this.st.mode === 'lock' && b.token) this.send(b.id, 'buyer', 'lock', 'release', { token: b.token })
    b.token = 0
  }

  private deliver(m: Msg) {
    const b = this.buyers[m.buyer]
    if (m.to === 'lock') {
      if (m.kind === 'acquire') {
        this.line.push(m.buyer)
        this.grantNext()
      } else if (m.kind === 'release' && this.holder === m.buyer) {
        this.holder = -1
        this.grantNext()
      }
      return
    }
    if (m.to === 'db') {
      if (m.kind === 'read') {
        this.send(m.buyer, 'db', 'buyer', 'value', { left: this.left, version: this.version })
        return
      }
      // A write: one fewer than the count the buyer read.
      this.tries++
      const stale = this.st.fence && this.st.mode === 'lock' && (m.token ?? 0) < this.highest
      const moved = this.st.mode === 'version' && m.version !== this.version
      if (stale || moved) {
        if (stale) this.rejected++
        else this.retries++
        this.send(m.buyer, 'db', 'buyer', 'no')
        return
      }
      this.left = Math.max(0, (m.left ?? 1) - 1)
      this.version++
      if (m.token) this.highest = Math.max(this.highest, m.token)
      this.send(m.buyer, 'db', 'buyer', 'ok', { left: m.left })
      return
    }
    // To a buyer.
    if (b.phase === 'crashed') return
    if (m.kind === 'grant') {
      b.token = m.token ?? 0
      b.waited = Math.max(b.waited, this.tick - b.waitedFrom)
      b.waitedFrom = -1
      this.readFor(b)
    } else if (m.kind === 'value') {
      const left = m.left ?? 0
      if (left <= 0) {
        b.phase = 'soldout'
        this.letGo(b)
        return
      }
      b.read = { left, version: m.version ?? 0 }
      if (this.st.mode === 'lock' && this.faultLeft) {
        this.faultLeft = false
        b.faulted = true
        if (this.st.fault === 'crash') {
          b.phase = 'crashed'
          this.say('Its server crashed')
          return
        }
        b.phase = 'paused'
        b.until = this.tick + PAUSE
        this.say('Its server froze')
        return
      }
      b.phase = 'working'
      b.until = this.tick + WORK[this.st.hold]
    } else if (m.kind === 'ok') {
      const seat = CROWDS[this.st.crowd].seats - (m.left ?? 1)
      b.phase = 'ticket'
      b.seat = seat
      b.boughtAt = this.tick
      this.owners[seat]?.push(b.id)
      if (this.owners[seat]?.length > 1) this.say('Sold twice')
      this.letGo(b)
    } else if (m.kind === 'no') {
      b.read = null
      if (this.st.mode === 'lock') {
        // Its lock was out of date: ask for it again.
        b.token = 0
        this.say('Old lock number: turned down')
        this.ask(b)
      } else this.readFor(b)
    }
  }

  step() {
    this.tick++
    const t = this.tick

    for (const b of this.buyers) {
      if (b.phase === 'coming' && t >= b.arriveAt) {
        b.arrived = t
        this.ask(b)
      }
    }

    const due = this.msgs.filter((m) => m.arrive <= t)
    this.msgs = this.msgs.filter((m) => m.arrive > t)
    for (const m of due) this.deliver(m)

    // A lease that runs out frees the lock, whatever its holder thinks.
    if (this.holder !== -1 && this.st.lease > 0 && t - this.grantedAt >= this.st.lease * TICKS_PER_SECOND) {
      this.holder = -1
      this.expired++
      this.grantNext()
    }

    for (const b of this.buyers) {
      if (b.phase === 'paused' && t >= b.until) {
        b.phase = 'working'
        b.until = t + WORK[this.st.hold]
        this.say('It wakes up and carries on')
      } else if (b.phase === 'working' && t >= b.until && b.read) {
        b.phase = 'writing'
        this.send(b.id, 'buyer', 'db', 'write', { left: b.read.left, version: b.read.version, token: b.token })
      }
    }

    if (!this.marked && this.done) {
      this.marked = true
      const m = this.metrics
      if (this.st.fault === 'none') this.marks[this.st.crowd] = { mode: this.st.mode, twice: m.twice, avg: m.avg, tries: m.tickets ? m.tries / m.tickets : 0 }
    }
  }

  private get done() {
    return this.st.sale > 0 && this.msgs.length === 0 && this.buyers.every((b) => b.phase === 'ticket' || b.phase === 'soldout' || b.phase === 'crashed')
  }

  get metrics(): LockingMetrics {
    const t = this.tick
    const bought = this.buyers.filter((b) => b.phase === 'ticket')
    const waits = this.buyers.map((b) => Math.max(b.waited, b.waitedFrom >= 0 ? t - b.waitedFrom : 0))
    const tickets = this.owners.reduce((n, o) => n + o.length, 0)
    const twice = this.owners.reduce((n, o) => n + Math.max(0, o.length - 1), 0)
    const holderGone = this.holder !== -1 && this.buyers[this.holder].phase === 'crashed'
    return {
      seats: CROWDS[this.st.crowd].seats,
      left: this.left,
      version: this.version,
      tickets,
      twice,
      served: bought.length,
      soldOut: this.buyers.filter((b) => b.phase === 'soldout').length,
      crashed: this.buyers.filter((b) => b.phase === 'crashed').length,
      longest: Math.round((Math.max(0, ...waits) / TICKS_PER_SECOND) * 10) / 10,
      avg: bought.length ? Math.round((bought.reduce((s, b) => s + b.boughtAt - b.arrived, 0) / bought.length / TICKS_PER_SECOND) * 100) / 100 : 0,
      tries: this.tries,
      retries: this.retries,
      rejected: this.rejected,
      expired: this.expired,
      holder: this.holder,
      line: this.line.length,
      open: this.st.sale > 0,
      done: this.done,
      stuck: holderGone && this.st.lease === 0,
      marks: { ...this.marks },
    }
  }
}

export { TICKS_PER_SECOND }
