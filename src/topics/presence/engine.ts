// Is Sam online?
//
//   Sam's phone ──▶ Presence server ──▶ contacts
//
// The server keeps one fact about Sam: online or offline. It tells Sam's contacts whenever
// that fact changes. The hard part is knowing it is still true.
//
//   - flag: the phone says hello when it connects and goodbye when it leaves. If it dies
//     without a goodbye, the server never finds out.
//   - beat: the phone also pings every `interval` seconds. The server gives up on a phone
//     that has been quiet for three intervals.
//   - grace: before saying "offline", the server waits this long for a ping to turn up.
//   - audience: tell every contact, or only the ones who have the chat open.
//   - store: pings are writes. A million phones make a million writes per interval, and the
//     store has a limit. When it cannot keep up it loses pings, and a phone that is fine
//     looks gone.

import type { PresenceState } from './types'
import { CONTACTS, OPEN, TICKS_PER_SECOND } from './world'

const LATENCY = 14 // ticks for a message to cross
const FLASH = TICKS_PER_SECOND * 2 // how long a restarted server stays marked

// What the numbers stand for.
export const PHONES = 1_000_000 // phones sending pings
export const CONTACT_LIST = 300 // contacts each person has: the 27 cubes stand for these
export const CHANGE_EVERY = 300 // seconds between status changes for one person, on average
export const CAPACITY = { disk: 50_000, memory: 400_000 } // pings per second the store can take

// Driving through tunnels: connection lost for DOWN seconds, back for UP seconds, twice.
const DOWN = 20
const UP = 4
const TUNNELS = 2

export const TIMEOUT_INTERVALS = 3

function mix(a: number, b: number) {
  let h = Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca6b)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  h = Math.imul(h, 0x297a2d39)
  h ^= h >>> 15
  return h >>> 0
}

export type Place = 'phone' | 'server' | 'contact'

interface Wire {
  id: number
  from: Place
  to: Place
  at: number // which contact, for a message to one
  sentAt: number
  arrive: number
}

export type Body = { kind: 'hello' } | { kind: 'beat' } | { kind: 'bye' } | { kind: 'status'; online: boolean }
export type Msg = Wire & Body

export const loadOf = (st: Pick<PresenceState, 'mode' | 'interval'>) => (st.mode === 'beat' ? PHONES / st.interval : 0)
export const dropOf = (st: Pick<PresenceState, 'mode' | 'interval' | 'store'>) => {
  const load = loadOf(st)
  const cap = CAPACITY[st.store]
  return load > cap ? 1 - cap / load : 0
}
export const targetsOf = (st: Pick<PresenceState, 'audience'>) => (st.audience === 'all' ? CONTACTS : OPEN)
// Status updates per second when a million people use the app.
export const fanOf = (st: Pick<PresenceState, 'audience'>) => Math.round((PHONES / CHANGE_EVERY) * (st.audience === 'all' ? CONTACT_LIST : OPEN))

export interface PresenceMetrics {
  up: boolean // what is true
  recorded: boolean // what the server says
  shown: boolean // what the watcher sees
  stale: number // seconds the watcher has been wrong, right now
  worst: number // the longest the watcher was wrong
  late: number // the longest between the server’s last sign of life from a phone and telling the watcher it was offline
  pings: number // pings the phone sent
  lost: number // pings the store dropped
  flips: number // times the watcher saw the status change
  changes: number // times the server changed its mind
  updates: number // status messages the server sent
  perChange: number // contacts told each time
  load: number // pings per second at a million phones
  cap: number // what the store can take
  fan: number // status updates per second at a million phones
  leaves: number
  dies: number
  backs: number
  tunnels: number
  crashes: number
  waiting: number // things still on their way
  marks: Marks // how things stood once each event had played out
}

// A snapshot taken once an event has played out: when everything has settled and the
// server has had time to give up on a quiet phone, or SETTLE_LIMIT seconds after the
// last thing happened, whichever comes first.
export interface Mark {
  flips: number
  lost: number
  late: number // seconds, as in the metrics
  right: boolean // the server and the watcher both match what is true
}
export type Marks = Partial<Record<Act, Mark>>
const SETTLE_LIMIT = 45

export type Act = 'leave' | 'die' | 'back' | 'tunnel' | 'crash'
const ACTS: Act[] = ['leave', 'die', 'back', 'tunnel', 'crash']

export class PresenceSim {
  msgs: Msg[] = []
  tick = 0
  up = true
  recorded = true
  shown: boolean[] = Array.from({ length: CONTACTS }, () => true)
  flash: number[] = Array.from({ length: CONTACTS }, () => -9999)
  crashedAt = -9999
  who = ''
  whoAt = -9999

  private st: PresenceState = { mode: 'flag', interval: 5, grace: 0, audience: 'all', store: 'memory', leave: 0, die: 0, back: 0, tunnel: 0, crash: 0, round: 0 }
  private cfg: string | null = null
  private seen: Record<Act, number> = { leave: 0, die: 0, back: 0, tunnel: 0, crash: 0 }
  private due: Act[] = []
  private script: { at: number; act: 'down' | 'up' }[] = []
  private heard = 0
  private lastBeat = 0
  private offlineAt: number | null = null
  private msgId = 0
  private beatNo = 0
  private wrongFor = 0
  private worst = 0
  private late = 0
  private pings = 0
  private lost = 0
  private flips = 0
  private changes = 0
  private updates = 0
  private counts: Record<Act, number> = { leave: 0, die: 0, back: 0, tunnel: 0, crash: 0 }
  private marks: Marks = {}
  private last: Act | null = null // the latest event, waiting for its mark
  private stirred = 0 // tick of the latest event or tunnel edge

  apply(st: PresenceState) {
    this.st = st
    const cfg = [st.mode, st.interval, st.grace, st.audience, st.store, st.round].join('|')
    const first = this.cfg === null
    if (first || cfg !== this.cfg) {
      this.cfg = cfg
      this.reset()
      this.seen = { leave: st.leave, die: st.die, back: st.back, tunnel: st.tunnel, crash: st.crash }
    }
    for (const key of ACTS) {
      if (st[key] > this.seen[key]) this.due.push(key)
      this.seen[key] = st[key]
    }
  }

  private reset() {
    this.msgs = []
    this.up = true
    this.recorded = true
    this.shown = Array.from({ length: CONTACTS }, () => true)
    this.flash = Array.from({ length: CONTACTS }, () => -9999)
    this.crashedAt = -9999
    this.who = ''
    this.whoAt = -9999
    this.due = []
    this.script = []
    this.heard = this.tick
    this.lastBeat = this.tick
    this.offlineAt = null
    this.beatNo = this.wrongFor = this.worst = this.late = this.pings = this.lost = this.flips = this.changes = this.updates = 0
    this.counts = { leave: 0, die: 0, back: 0, tunnel: 0, crash: 0 }
    this.marks = {}
    this.last = null
    this.stirred = this.tick
  }

  private send(from: Place, to: Place, body: Body, at = 0) {
    this.msgs.push({ id: this.msgId++, from, to, at, sentAt: this.tick, arrive: this.tick + LATENCY, ...body })
  }

  private say(what: string) {
    this.who = what
    this.whoAt = this.tick
  }

  // Something happens to the phone or the server.
  private act(what: Act) {
    this.counts[what]++
    this.last = what
    this.stirred = this.tick
    if (what === 'leave') {
      if (!this.up) return
      this.send('phone', 'server', { kind: 'bye' })
      this.up = false
      this.say('Sam closes the app')
    } else if (what === 'die') {
      if (!this.up) return
      this.up = false
      this.say('Sam’s phone goes dark')
    } else if (what === 'back') {
      if (this.up) return
      this.connect()
      this.say('Sam is back')
    } else if (what === 'tunnel') {
      for (let k = 0; k < TUNNELS; k++) {
        const t0 = this.tick + k * (DOWN + UP) * TICKS_PER_SECOND
        this.script.push({ at: t0, act: 'down' }, { at: t0 + DOWN * TICKS_PER_SECOND, act: 'up' })
      }
      this.say('Sam drives through tunnels')
    } else {
      this.crashedAt = this.tick
      this.msgs = this.msgs.filter((m) => m.to !== 'server')
      if (this.st.store === 'memory') this.record(false)
      this.say('The presence server restarts')
    }
  }

  private connect() {
    this.up = true
    this.lastBeat = this.tick
    this.send('phone', 'server', { kind: 'hello' })
  }

  // The server changes what it believes, and tells the contacts it is meant to tell.
  private record(online: boolean) {
    this.offlineAt = null
    if (this.recorded === online) return
    this.recorded = online
    this.changes++
    const n = targetsOf(this.st)
    for (let i = 0; i < n; i++) this.send('server', 'contact', { kind: 'status', online }, i)
    this.updates += n
  }

  private quiet() {
    if (this.st.grace <= 0) this.record(false)
    else if (this.offlineAt === null) this.offlineAt = this.tick + this.st.grace * TICKS_PER_SECOND
  }

  step() {
    this.tick++
    const t = this.tick

    const due = this.msgs.filter((m) => m.arrive <= t)
    this.msgs = this.msgs.filter((m) => m.arrive > t)
    for (const m of due) {
      if (m.kind === 'status') {
        if (m.at === 0 && this.shown[0] !== m.online) this.flips++
        if (m.at === 0 && !m.online && !this.up) this.late = Math.max(this.late, t - this.heard)
        this.shown[m.at] = m.online
        this.flash[m.at] = t
      } else if (m.kind === 'bye') {
        this.heard = t
        this.quiet()
      } else {
        // hello or beat
        this.heard = t
        this.offlineAt = null
        if (!this.recorded) this.record(true)
      }
    }

    // The phone pings while it is connected.
    if (this.up && this.st.mode === 'beat' && t - this.lastBeat >= this.st.interval * TICKS_PER_SECOND) {
      this.lastBeat = t
      this.pings++
      const drop = dropOf(this.st)
      if ((mix(++this.beatNo, 99) % 1000) / 1000 < drop) this.lost++
      else this.send('phone', 'server', { kind: 'beat' })
    }

    // The server gives up on a phone that has gone quiet.
    if (this.st.mode === 'beat' && this.recorded && this.offlineAt === null && t - this.heard > TIMEOUT_INTERVALS * this.st.interval * TICKS_PER_SECOND) this.quiet()
    if (this.offlineAt !== null && t >= this.offlineAt) this.record(false)

    while (this.script.length && this.script[0].at <= t) {
      const s = this.script.shift()!
      if (s.act === 'down') this.up = false
      else this.connect()
      this.stirred = t
    }

    const next = this.due.shift()
    if (next) this.act(next)

    if (this.shown[0] !== this.up) {
      this.wrongFor++
      this.worst = Math.max(this.worst, this.wrongFor)
    } else this.wrongFor = 0

    if (this.last && !this.marks[this.last] && this.due.length === 0 && this.script.length === 0) {
      // Watch for at least as long as the server takes to give up on a quiet phone, so lost
      // pings and a server that forgot have time to show.
      const since = t - this.stirred
      const watch = Math.min(SETTLE_LIMIT, this.st.mode === 'beat' ? TIMEOUT_INTERVALS * this.st.interval + this.st.grace : 0)
      if ((this.settled && since >= watch * TICKS_PER_SECOND) || since > SETTLE_LIMIT * TICKS_PER_SECOND) {
        const right = this.recorded === this.up && this.shown[0] === this.up
        this.marks[this.last] = { flips: this.flips, lost: this.lost, late: Math.round(this.late / TICKS_PER_SECOND), right }
        this.last = null
      }
    }
  }

  // Nothing left to happen: no event or status on its way, and everyone agrees with the truth.
  private get settled() {
    return (
      this.offlineAt === null &&
      !this.msgs.some((m) => m.kind === 'status') &&
      this.recorded === this.up &&
      this.shown[0] === this.up
    )
  }

  get crashing() {
    return this.tick - this.crashedAt < FLASH
  }

  get metrics(): PresenceMetrics {
    return {
      up: this.up,
      recorded: this.recorded,
      shown: this.shown[0],
      stale: Math.round(this.wrongFor / TICKS_PER_SECOND),
      worst: Math.round(this.worst / TICKS_PER_SECOND),
      late: Math.round(this.late / TICKS_PER_SECOND),
      pings: this.pings,
      lost: this.lost,
      flips: this.flips,
      changes: this.changes,
      updates: this.updates,
      perChange: targetsOf(this.st),
      load: loadOf(this.st),
      cap: CAPACITY[this.st.store],
      fan: fanOf(this.st),
      leaves: this.counts.leave,
      dies: this.counts.die,
      backs: this.counts.back,
      tunnels: this.counts.tunnel,
      crashes: this.counts.crash,
      waiting: this.msgs.length + this.script.length + this.due.length,
      marks: { ...this.marks },
    }
  }
}

export { TICKS_PER_SECOND }
