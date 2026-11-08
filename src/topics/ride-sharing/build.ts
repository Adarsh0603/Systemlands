import { createElement } from 'react'
import { ORDER_LOOK, hintFromReview } from '../../core/build/hint'
import { Tag } from '../../core/iso/primitives'
import type { BuildTask, Diagnosis, Placement, Requirement, Settings } from '../../core/build/types'
import type { FlowSim } from '../../core/flow/engine'
import type { Capstone, Intro, Review } from '../../core/capstone/types'
import { Ride, SECOND, type Config, type Phase } from './ride'

// The design board: riders at the top left, drivers at the bottom left, dispatch in the middle and the
// trips database on the right. Requests run along the top, driver pings along the bottom.
const RIDERS_AT = { x: -10, z: -2.4 }
const DRIVERS_AT = { x: -10, z: 3.8 }
const DISPATCH_AT = { x: 0.4, z: -2.4 }
const TRIPS_AT = { x: 8, z: 0.6 }
const POS: Record<string, { x: number; z: number }> = {
  f1: { x: -6.4, z: -5 },
  f2: { x: -6.4, z: -2.4 },
  f3: { x: -6.4, z: 0.2 },
  f4: { x: -3, z: -2.4 },
  g1: { x: 4, z: -3.6 },
  g2: { x: 4, z: -0.4 },
  d1: { x: -6.4, z: 3.8 },
  d2: { x: -3, z: 3.8 },
}
const FIRST_SPOTS = ['f1', 'g1', 'd1', 'd2']
const ALL_SPOTS = ['f1', 'f2', 'f3', 'f4', 'g1', 'g2', 'd1', 'd2']
const spot = (id: string) => ({ id, ...POS[id], accepts: [] })

// Where a spot stands decides what a piece there can do: in front of dispatch, behind it, or on the drivers' road.
type Zone = 'front' | 'back' | 'road'
const zoneOf = (id: string): Zone => (POS[id].x > DISPATCH_AT.x ? 'back' : POS[id].z > 2 ? 'road' : 'front')

const T = (s: number) => s * SECOND

// The first design: an ordinary busy hour, in which the drivers log on and the pings outgrow a database.
const FIRST_PHASES: Phase[] = [
  { from: 0, pings: 400, rides: 4, downtown: 0.3 },
  { from: T(8), pings: 1500, rides: 5, downtown: 0.3 },
  { from: T(24), pings: 1500, rides: 3, downtown: 0.3 },
]
export const FIRST_SETTLED = T(30)

// The real day: drivers log on, a concert lets out, and dispatch crashes in the middle of the evening rush.
const SCALE_PHASES: Phase[] = [
  { from: 0, pings: 400, rides: 4, downtown: 0.3 },
  { from: T(8), pings: 3000, rides: 5, downtown: 0.3 },
  { from: T(18), pings: 1800, rides: 22, downtown: 0.75 },
  { from: T(32), pings: 1200, rides: 6, downtown: 0.3 },
  { from: T(36), pings: 1200, rides: 12, downtown: 0.4 },
  { from: T(44), pings: 1200, rides: 5, downtown: 0.3 },
]
const CRASH = { at: T(37), down: T(4) }
export const SCALE_SETTLED = T(58)
const FAIL_LIMIT = 2 // riders that may give up or be turned away in all
const WAIT_LIMIT = 3 // seconds an average rider may wait for a car
const LAG_LIMIT = 2 // seconds old the car positions may be

const TIMELINE: NonNullable<BuildTask['timeline']> = {
  phases: [
    { name: 'A quiet morning', from: 0 },
    { name: 'Drivers log on', from: T(8) },
    { name: 'A concert lets out', from: T(18) },
    { name: 'Calm again', from: T(32) },
    { name: 'The evening rush', from: T(36) },
    { name: 'Dispatch crashes', from: T(37) },
    { name: 'Catching up', from: T(44) },
  ],
  end: SCALE_SETTLED,
}

export const rideOf = new WeakMap<FlowSim, Ride>()

const seeded = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const JAM_WHY: Record<string, string> = {
  server: 'The map server has to stand between the riders and dispatch, where the lookups happen. Here they do not.',
  queue: 'The request log has to stand in front of dispatch, where it writes each request down before it is matched. Here it does not.',
  dedupe: 'The claim store has to stand behind dispatch, where the cars are claimed. Here it does not.',
  cache: 'The live map has to stand on the drivers’ road, where the pings arrive. Here it does not.',
}
// Which pieces have a job in which zone. A piece anywhere else blocks the stream that runs through it.
const HOME: Record<string, Zone> = { server: 'front', queue: 'front', dedupe: 'back', cache: 'road' }

// Which parts are on the floor, and where. A piece can go on any spot, so what it does comes from its kind and zone.
function layout(raw: Placement) {
  const entries = Object.entries(raw)
  const byPlace = (a: string, b: string) => POS[a].x - POS[b].x || POS[a].z - POS[b].z
  const ids = (zone: Zone) => entries.filter(([id]) => zoneOf(id) === zone).map(([id]) => id).sort(byPlace)
  const misplaced = entries.filter(([id, kind]) => HOME[kind] && HOME[kind] !== zoneOf(id)).map(([id]) => id)
  const right = (kind: string) => entries.filter(([id, k]) => k === kind && HOME[kind] === zoneOf(id)).map(([id]) => id).sort(byPlace)
  const kindOf = (zone: Zone) => (id: string) => {
    const kind = raw[id]
    if (HOME[kind] && HOME[kind] !== zone) return 'jam' as const
    return kind === 'queue' ? ('queue' as const) : kind === 'limiter' ? ('limiter' as const) : ('pass' as const)
  }
  const map = right('server')[0]
  const front = ids('front').filter((id) => id !== map)
  return {
    front: front.map((key) => ({ key, kind: kindOf('front')(key) })),
    back: ids('back').map((key) => ({ key, kind: kindOf('back')(key) === 'jam' ? ('jam' as const) : ('pass' as const) })),
    road: ids('road').filter((id) => raw[id] !== 'cache').map((key) => ({ key, kind: kindOf('road')(key) === 'jam' ? ('jam' as const) : ('pass' as const) })),
    map,
    live: right('cache')[0],
    claim: right('dedupe')[0],
    log: right('queue')[0],
    limits: entries.filter(([, kind]) => kind === 'limiter').length,
    extras: entries.filter(([, kind]) => kind === 'limiter' || kind === 'breaker' || kind === 'topic').length,
    jam: misplaced.length ? { ids: misplaced, why: JAM_WHY[raw[misplaced[0]]] } : null,
  }
}

export const PINGS_NAMES = ['Straight to the trips database', 'Into the live map, in memory']
export const CLAIM_NAMES = ['Offer the nearest car', 'Claim the car first, then offer it']
export const SPLIT_NAMES = ['By fixed map cells', 'By how busy each area is']
export const CRASH_NAMES = ['Kept in dispatch’s memory', 'Written to the log first, replayed after']
export function chosen(settings: Settings) {
  return {
    pings: (settings.pings ?? 0) as 0 | 1,
    claim: settings.claim === 1,
    split: (settings.split ?? 0) as 0 | 1,
    shards: settings.shards ?? 1,
    crash: settings.crash === 1,
  }
}

interface Mode {
  phases: Phase[]
  crash?: Config['crash']
  hard: boolean
}

function assemble(raw: Placement, settings: Settings, mode: Mode, rng?: () => number) {
  const l = layout(raw)
  const s = chosen(settings)
  // The first design has only the pings to decide: no crowd at one corner, and no crash.
  const ride = new Ride(rng ?? seeded(7), {
    front: l.front,
    map: l.map,
    shards: mode.hard && l.map ? s.shards : 1,
    back: l.back,
    road: l.road,
    live: l.live,
    pings: s.pings,
    claim: mode.hard && s.claim && !!l.claim,
    split: mode.hard ? s.split : 0,
    log: mode.hard && s.crash && !!l.log,
    clash: mode.hard,
    phases: mode.phases,
    crash: mode.crash,
  })
  rideOf.set(ride.flow, ride)
  return ride.flow
}

// The checks a finished design must pass. Shown live; the win needs all green.
const oneCar: Requirement = {
  label: 'One car, one rider',
  says: 'A car may never be offered to two riders at once.',
  read: (flow) => {
    const n = rideOf.get(flow)?.doubles() ?? 0
    return { text: n === 0 ? 'none shared' : `${n} sent the same car`, ok: n === 0 }
  },
}
const fresh: Requirement = {
  label: 'Fresh map',
  says: `The cars on the map may be at most ${LAG_LIMIT} seconds old.`,
  read: (flow) => {
    const r = rideOf.get(flow)
    if (!r) return { text: '', ok: true }
    const lag = r.lag()
    return { text: lag < 0.5 ? 'up to date' : `${lag.toFixed(1)} s old`, ok: lag <= LAG_LIMIT }
  },
}
const matched = (deadline: number): Requirement => ({
  label: 'Riders matched',
  says: `At most ${FAIL_LIMIT} riders may give up or be turned away in all, and the average rider gets a car in under ${WAIT_LIMIT} seconds.`,
  read: (flow) => {
    const r = rideOf.get(flow)
    if (!r) return { text: '', ok: true }
    const failed = r.failed()
    const slow = flow.tick >= T(4) && r.wait() > WAIT_LIMIT
    const text = failed > 0 ? `${failed} lost` : `${r.wait().toFixed(2)} s`
    return { text, ok: failed <= FAIL_LIMIT && !slow && (flow.tick < deadline || r.matchedCount() > 0) }
  },
})

const BRIEF = {
  title: 'The brief',
  lines: [
    'A ride app lets a rider ask for a car, and matches them with the nearest free driver. Drivers send their location every few seconds, so the map is always live.',
    'Build it. Every rider must get a car in a few seconds, and no car may be promised to two riders.',
    'Plan for a big city: 500,000 drivers online, 20 million rides a day. A concert lets out, everyone in one square asks for a car, and the dispatcher can crash at any moment.',
    'The map must stay fresh, the busiest corner must not choke, and a crash must not lose a rider.',
  ],
}

const FIXED = [
  { id: 'riders', kind: 'users' as const, ...RIDERS_AT },
  { id: 'drivers', kind: 'users' as const, ...DRIVERS_AT },
  { id: 'dispatch', kind: 'app' as const, ...DISPATCH_AT },
  { id: 'trips', kind: 'database' as const, ...TRIPS_AT },
]
const LABELS = [
  { at: [RIDERS_AT.x, 1.6, RIDERS_AT.z] as [number, number, number], text: 'Riders' },
  { at: [DRIVERS_AT.x, 1.6, DRIVERS_AT.z] as [number, number, number], text: 'Drivers' },
  { at: [DISPATCH_AT.x, 1.6, DISPATCH_AT.z] as [number, number, number], text: 'Dispatch' },
  { at: [TRIPS_AT.x, 2.2, TRIPS_AT.z] as [number, number, number], text: 'Trips database' },
]
const NAMES: BuildTask['names'] = { cache: 'Live map', server: 'Map server', dedupe: 'Claim store', queue: 'Request log' }
const PIECE_HINTS: BuildTask['hints'] = {
  cache: 'keeps every driver’s last position in memory',
  server: 'holds the cars of the map, cut into shards',
  dedupe: 'marks a car as taken, so only one rider gets it',
  queue: 'writes each request down before it is matched',
  limiter: 'lets only so many requests a second through',
  breaker: 'stops calling a dependency that keeps failing',
  topic: 'sends one message to many listeners',
}

const PINGS = { id: 'pings', label: 'driver pings are written', when: 'cache' as const, min: 0, max: 1, step: 1, initial: 0, options: PINGS_NAMES,
  tradeoffs: [
    { gain: 'Every ping is kept for good.', cost: 'Thousands of writes a second hit the database.' },
    { gain: 'Fast writes and fast nearby lookups.', cost: 'Pings are lost if the map restarts.' },
  ],
}
const SETTINGS = [
  PINGS,
  { id: 'shards', label: 'shard', when: 'server' as const, min: 1, max: 4, step: 1, initial: 1 },
  { id: 'split', label: 'the map is cut', when: 'server' as const, min: 0, max: 1, step: 1, initial: 0, options: SPLIT_NAMES,
    tradeoffs: [
      { gain: 'Simple: a place always maps to the same shard.', cost: 'A busy city centre lands on one shard.' },
      { gain: 'Load spreads evenly.', cost: 'The cut lines must be worked out and moved over time.' },
    ],
  },
  { id: 'claim', label: 'a rider is matched by', when: 'dedupe' as const, min: 0, max: 1, step: 1, initial: 0, options: CLAIM_NAMES,
    tradeoffs: [
      { gain: 'The fastest offer.', cost: 'Two riders can be offered the same car.' },
      { gain: 'A car is offered to one rider at a time.', cost: 'An extra step before every offer.' },
    ],
  },
  { id: 'crash', label: 'requests being matched are', when: 'queue' as const, min: 0, max: 1, step: 1, initial: 0, options: CRASH_NAMES,
    tradeoffs: [
      { gain: 'Fast, with no extra writes.', cost: 'A crash forgets every request in flight.' },
      { gain: 'Requests survive a crash.', cost: 'A write before every match, and a replay on restart.' },
    ],
  },
]

function decorate(flow: FlowSim, raw: Placement) {
  const r = rideOf.get(flow)
  if (!r) return null
  const l = layout(raw)
  const hard = r.cfg.crash !== undefined
  const out = [createElement(Tag, { key: 'phase', at: [RIDERS_AT.x, 2.4, RIDERS_AT.z], label: hard ? (TIMELINE.phases.filter((x) => x.from <= flow.tick).pop()?.name ?? '') : 'A busy hour' })]
  for (const id of l.jam?.ids ?? []) out.push(createElement(Tag, { key: `jam-${id}`, at: [POS[id].x, 1.8, POS[id].z], label: 'Stops here', danger: true }))
  const lag = r.lag()
  if (lag >= 0.5) out.push(createElement(Tag, { key: 'lag', at: [DRIVERS_AT.x, 2.4, DRIVERS_AT.z], label: `Map ${lag.toFixed(1)} s old`, danger: lag > LAG_LIMIT }))
  if (r.down) out.push(createElement(Tag, { key: 'down', at: [DISPATCH_AT.x, 2.4, DISPATCH_AT.z], label: 'Crashed', danger: true }))
  else if (r.matching.length > 0) out.push(createElement(Tag, { key: 'match', at: [DISPATCH_AT.x, 2.4, DISPATCH_AT.z], label: `${r.matching.length} being matched` }))
  const crash = r.crashLoss()
  if (crash.lost > 0) out.push(createElement(Tag, { key: 'lost', at: [DISPATCH_AT.x, 3.2, DISPATCH_AT.z], label: `${crash.lost} requests lost in the crash`, danger: true }))
  if (r.held() > 0) out.push(createElement(Tag, { key: 'held', at: [DISPATCH_AT.x, 3.2, DISPATCH_AT.z], label: `${r.held()} requests in the log` }))
  const n = r.busiest()
  if (n > 5) {
    const at = r.cfg.map ? POS[r.cfg.map] : DISPATCH_AT
    out.push(createElement(Tag, { key: 'lookups', at: [at.x, r.cfg.map ? 1.8 : 2.8, at.z], label: `${n} lookups waiting at the busiest shard`, danger: n > 20 }))
  }
  if (r.doubles() > 0) out.push(createElement(Tag, { key: 'double', at: [TRIPS_AT.x, 3.4, TRIPS_AT.z], label: `${r.doubles()} shared a car`, danger: true }))
  out.push(createElement(Tag, { key: 'trips', at: [TRIPS_AT.x, 3, TRIPS_AT.z], label: `${r.matchedCount()} trips saved` }))
  if (r.cfg.claim && l.claim) out.push(createElement(Tag, { key: 'claim', at: [POS[l.claim].x, 1.8, POS[l.claim].z], label: `${r.claimed} cars claimed` }))
  return out
}

function common(): Pick<BuildTask, 'pinned' | 'manualStart' | 'rps' | 'shot' | 'fixed' | 'labels' | 'decorate' | 'hints' | 'names' | 'failFast' | 'anywhere' | 'replies'> {
  return {
    pinned: BRIEF,
    manualStart: true,
    replies: (job) => job.from === 'ride',
    rps: 4,
    shot: { target: [-1.2, 0.8, 0.6], zoom: 0.48 },
    fixed: FIXED,
    labels: LABELS,
    decorate,
    hints: PIECE_HINTS,
    names: NAMES,
    failFast: true,
    anywhere: true,
  }
}

// What the learner sees going wrong, in numbers. It says what happened, never why.
function symptom(r: Ride): Diagnosis | null {
  const doubles = r.doubles()
  if (doubles > 0) return { because: 'Some riders were sent a car that was already on its way to someone else.', look: 'Two riders can ask for the same car at nearly the same moment. What decides who gets it?' }
  const lag = r.lag()
  if (lag > LAG_LIMIT) return { because: 'The cars on the map are out of date, and getting more so.', look: 'How many driver pings arrive, and what has to handle each one?' }
  const failed = r.failed()
  const crash = r.crashLoss()
  if (crash.lost > 0 && failed > FAIL_LIMIT) return { because: 'Dispatch crashed with rides being matched. Some of them were lost.', look: 'What is kept of a ride being matched if the machine handling it disappears?' }
  if (failed > FAIL_LIMIT) return { because: `Some riders gave up or were turned away.${r.limited ? ' Some were turned away by a rate limiter.' : ''}`, look: 'Which part is overloaded when requests arrive?' }
  if (r.wait() > WAIT_LIMIT) return { because: 'Finding a car is slow.', look: 'Which step does every ride request wait on?' }
  return null
}

function diagnose(_m: unknown, raw: Placement, _settings: Settings, flow: FlowSim): Diagnosis | null {
  const r = rideOf.get(flow)
  if (!r) return null
  const l = layout(raw)
  if (l.jam) return { because: l.jam.why, look: ORDER_LOOK }
  return symptom(r)
}
const problem = (m: unknown, raw: Placement, settings: Settings, flow: FlowSim) => diagnose(m, raw, settings, flow)?.because ?? null

// Once the traffic is over, every rider must have a car.
function done(r: Ride, tick: number, settled: number) {
  return tick >= settled && r.doubles() === 0 && r.failed() <= FAIL_LIMIT && r.wait() <= WAIT_LIMIT && r.lag() <= LAG_LIMIT && r.matchedCount() > 0
}

const tripsSaved = { kind: 'note' as const, label: 'Trips saved', read: (flow: FlowSim) => ({ text: String(rideOf.get(flow)?.matchedCount() ?? 0), bad: false }) }

// Stage 2: one new idea. Thousands of pings a second are not trips: keep the latest position in memory.
export const FIRST_DESIGN: BuildTask = {
  ...common(),
  title: 'First design: a busy hour.',
  sub: 'The drivers log on and their pings pile up. Decide where the pings go. Changing anything restarts the run.',
  goal: 'Keep the map fresh and give every rider a car.',
  goalShort: 'Fresh map · every rider matched',
  win: 'A live map on the drivers’ road, with the pings written into it. A ping replaces the last one, so memory takes thousands a second, and the trips database is left for trips.',
  holdSeconds: 4,
  testSeconds: 40,
  pads: FIRST_SPOTS.map(spot),
  toolbox: [
    { kind: 'cache', count: 1 },
    { kind: 'dedupe', count: 1 },
    { kind: 'queue', count: 1 },
  ],
  settings: [PINGS],
  watch: [tripsSaved],
  requirements: [oneCar, fresh, matched(FIRST_SETTLED)],
  assemble: (placed, settings, rng) => assemble(placed, settings, { phases: FIRST_PHASES, hard: false }, rng),
  diagnose,
  problem,
  hint: (_m, raw, settings) => hintFromReview(review(raw, settings).lines, ['Driver pings'], false),
  check: (_m, _raw, _settings, flow) => {
    const r = flow && rideOf.get(flow)
    return !!r && done(r, flow.tick, FIRST_SETTLED)
  },
}

// Stage 3: the real day. Each phase brings a new way to fail.
export const SCALE_UP: BuildTask = {
  ...common(),
  title: 'Where it breaks: a big night.',
  sub: 'Drivers log on, a concert lets out and dispatch crashes. Watch the numbers, then tune it.',
  goal: 'Get through the whole night: fresh map, one car per rider, nobody lost.',
  goalShort: 'Survive the whole night',
  win: 'A live map for the pings, a map server in three shards cut by how busy each area is, a claim store so a car is claimed before it is offered, and a request log so a crash can be replayed.',
  holdSeconds: 4,
  testSeconds: 62,
  pads: ALL_SPOTS.map(spot),
  toolbox: [
    { kind: 'cache', count: 1 },
    { kind: 'dedupe', count: 1 },
    { kind: 'server', count: 1 },
    { kind: 'queue', count: 1 },
    { kind: 'limiter', count: 1 },
    { kind: 'breaker', count: 1 },
    { kind: 'topic', count: 1 },
  ],
  timeline: TIMELINE,
  settings: SETTINGS,
  watch: [tripsSaved],
  requirements: [oneCar, fresh, matched(SCALE_SETTLED)],
  assemble: (placed, settings, rng) => assemble(placed, settings, { phases: SCALE_PHASES, crash: CRASH, hard: true }, rng),
  diagnose,
  problem,
  hint: (_m, raw, settings) => hintFromReview(review(raw, settings).lines, undefined, false),
  check: (_m, _raw, _settings, flow) => {
    const r = flow && rideOf.get(flow)
    return !!r && done(r, flow.tick, SCALE_SETTLED)
  },
}

function review(raw: Placement, settings: Settings): Review {
  const l = layout(raw)
  const s = chosen(settings)
  return {
    lines: [
      { label: 'Driver pings', yours: l.live && s.pings === 1 ? 'Into a live map in memory' : 'Into the trips database', reference: 'Into a live map in memory', why: 'A ping only replaces the driver’s last position, and an old one is worthless. Memory takes 100,000 of them a second, a database would need dozens of machines, so it falls behind and the map goes stale.', ok: !!l.live && s.pings === 1 },
      { label: 'Cutting the map', yours: l.map ? `${s.shards} shard${s.shards === 1 ? '' : 's'}, cut ${SPLIT_NAMES[s.split].toLowerCase()}` : 'One shard', reference: '3 shards, cut by how busy each area is', why: 'One shard answers about 8 lookups a second. A concert sends 22 from a single square, so the map has to be cut into 3 shards or more. Fixed cells put the whole square on one shard. Cutting a busy area finer spreads it.', ok: !!l.map && s.shards >= 3 && s.split === 1 },
      { label: 'Matching', yours: l.claim && s.claim ? 'Claim the car first' : 'Offer the nearest car', reference: 'Claim the car first, then offer it', why: 'Offering a car takes a second to be answered. Until then, every rider next to it sees the same car as nearest. Claiming it first lets the second rider see the next one.', ok: !!l.claim && s.claim },
      { label: 'After a crash', yours: l.log && s.crash ? 'Requests logged, then replayed' : 'Kept in dispatch’s memory', reference: 'Written to a log first, replayed after', why: 'Dispatch holds the rides it is matching in memory. If it dies they are gone, and the riders wait for ever. A log written first lets the restart match them again.', ok: !!l.log && s.crash },
      { label: 'Extras', yours: l.extras ? 'Pieces this system does not need' : 'Only what is needed', reference: 'No limiter, breaker or topic', why: 'A rate limiter turns real riders away. A breaker has no flaky dependency to guard here, and a topic has nobody to broadcast to.', ok: l.extras === 0 },
    ],
    tradeoffs: [
      'A live map in memory is lost if it restarts. Drivers ping again within seconds, so it refills by itself, but for a moment the map is empty.',
      'Claiming a car first adds a small delay to every match, in exchange for never promising a car twice.',
      'A finer cut of a busy area balances load, but a rider near the border of two cells must ask both. Searching neighbours costs more lookups.',
      'Logging every request costs a write, in exchange for being able to replay after any crash.',
    ],
    interview: [
      'Clarify: drivers online, rides per day and at the peak, how fresh the map must be, one city or many, pooled rides, what a wrong match costs.',
      'Estimate: 500,000 drivers pinging every 4 s is 125,000 writes a second. 20 million rides a day is about 230 a second, 3 times that at the peak.',
      'Design: drivers send pings to a live map in memory, cut by geohash or quadtree. Dispatch asks the map for nearby free cars, claims one, offers it, and saves the trip.',
      'Scale: shard the map by area, split busy areas finer, keep trips in a database sharded by trip id, push the car’s position to the rider over a socket.',
      'Failures: a hot city centre (split finer), two riders and one car (claim first), a dispatch crash (log the request first), a dead driver app (ping time-outs expire its car).',
    ],
  }
}

// The opening: a tiny ride service, from a request to a saved trip.
const INTRO_FIXED = [
  { id: 'riders', kind: 'users' as const, x: -8, z: -2.4 },
  { id: 'drivers', kind: 'users' as const, x: -8, z: 2.8 },
  { id: 'dispatch', kind: 'app' as const, x: -2.2, z: -2.4 },
  { id: 'trips', kind: 'database' as const, x: 3.4, z: 0.2 },
]
export const INTRO: Intro = {
  task: {
    title: 'How a ride is matched',
    sub: '',
    goal: '',
    win: '',
    holdSeconds: 1,
    rps: 1,
    shot: { target: [-2.4, 0.8, 0], zoom: 0.85 },
    fixed: INTRO_FIXED,
    pads: [],
    toolbox: [],
    assemble: (_placed, _settings, rng) => {
      const ride = new Ride(rng ?? seeded(3), { front: [], shards: 1, back: [], road: [], pings: 0, claim: false, split: 0, log: false, clash: false, phases: [{ from: 0, pings: 200, rides: 1, downtown: 0 }] })
      rideOf.set(ride.flow, ride)
      return ride.flow
    },
    check: () => false,
  },
  steps: [
    { say: 'Drivers keep telling the app where they are, every few seconds.', at: 'drivers', label: 'Location pings' },
    { say: 'A rider asks for a car.', at: 'riders', label: 'A request' },
    { say: 'Dispatch looks for the nearest free driver and offers them the ride.', at: 'dispatch', label: 'Dispatch' },
    { say: 'When the driver says yes, the trip is saved.', at: 'trips', label: 'Trips database' },
    { say: 'Easy with one rider and a few cars. Now picture 500,000 drivers, a whole stadium asking at once, and a crash in the middle.' },
  ],
  start: 'Take the challenge →',
}

export const RIDE_SHARING: Capstone = {
  id: 'ride-sharing',
  title: 'Ride sharing',
  stages: ['Requirements', 'First design', 'Where it breaks', 'Final review'],
  intro: INTRO,
  goals: ['A fresh map', 'One car, one rider', 'A busy corner', 'Survive a crash'],
  brief: BRIEF,
  estimate: {
    intro: 'Before drawing anything, work out how big this is. A few quick numbers decide the design.',
    summary: { title: 'About 125,000 pings a second, but only 230 rides.', body: 'The location stream is the load, and it is tiny writes that go stale in seconds. The rides are few. They go wrong in other ways: a crowd in one square, two riders for one car, and a crash in the middle of a match.' },
    questions: [
      { question: '500,000 drivers are online, and each sends its location every 4 seconds. About how many pings a second?', options: ['About 12,500', 'About 125,000', 'About 1,250,000'], answer: 1, at: 'drivers', show: '125,000 pings / second', why: '500,000 ÷ 4 seconds is 125,000 a second.' },
      { question: 'One database machine writes about 5,000 rows a second. About how many machines would the pings need?', options: ['About 2', 'About 25', 'About 250'], answer: 1, at: 'trips', show: '25 machines just for pings', why: '125,000 ÷ 5,000 is 25. And every ping only replaces the last one, so keeping them in a database is a waste. Keep them in memory.' },
      { question: '20 million rides are asked for in a day. About how many a second, on average?', options: ['About 23', 'About 230', 'About 2,300'], answer: 1, at: 'riders', show: '230 rides / second', why: '20,000,000 ÷ 86,400 seconds is about 230. A peak is 3 to 5 times that.' },
      { question: 'A request only needs the cars within 2 km: about 50 of the 500,000. How much less work is looking at the cars of one area than at all of them?', options: ['About 10 times', 'About 1,000 times', 'About 10,000 times'], answer: 2, at: 'dispatch', show: '10,000 times less to look at', why: '500,000 ÷ 50 is 10,000. This is why the map is cut into cells: look at one cell and its neighbours, never at everything.' },
      { question: 'A concert lets out and 20 riders in one square ask for a car in the same second. Offering a car takes a second to be answered. If each is offered the nearest car, how many get the same one?', options: ['None, the nearest is different for each', 'About 1 in 20', 'Almost all of them'], answer: 2, at: 'dispatch', show: '20 riders, 1 car', why: 'The first rider is offered car A, but A is not marked as taken for a second. The other 19 see A as the nearest too. Claim the car first.' },
    ],
  },
  first: FIRST_DESIGN,
  scale: SCALE_UP,
  review,
}
