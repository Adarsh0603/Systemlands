import { createElement } from 'react'
import { ORDER_LOOK, hintFromReview } from '../../core/build/hint'
import { Tag } from '../../core/iso/primitives'
import type { BuildTask, Diagnosis, Placement, Requirement, Settings } from '../../core/build/types'
import type { FlowSim } from '../../core/flow/engine'
import type { Capstone, Intro, Review } from '../../core/capstone/types'
import { Kv, SECOND, type Config, type Events, type Phase } from './kv'

// The design board: clients on the left, a front lane (limiter, hot-key cache) into the
// coordinator, then the ring, and five storage nodes in a column on the right.
const CLIENTS_AT = { x: -9.6, z: 0 }
const COORD_AT = { x: -1, z: 0 }
const POS: Record<string, { x: number; z: number }> = {
  l1: { x: -6.8, z: 0 },
  c1: { x: -4, z: 0 },
  b1: { x: -6.8, z: 3.2 },
  r1: { x: 1.8, z: 0 },
  n1: { x: 5.2, z: -4.4 },
  n2: { x: 5.2, z: -2.2 },
  n3: { x: 5.2, z: 0 },
  n4: { x: 5.2, z: 2.2 },
  n5: { x: 5.2, z: 4.4 },
}
const FIRST_SPOTS = ['r1', 'n1', 'n2', 'n3', 'n4']
const ALL_SPOTS = ['l1', 'c1', 'b1', 'r1', 'n1', 'n2', 'n3', 'n4', 'n5']
const spot = (id: string) => ({ id, ...POS[id], accepts: [] })

const T = (s: number) => s * SECOND

// The first design: a steady load that one or two nodes cannot carry, and a ring that spreads it.
const FIRST_PHASES: Phase[] = [
  { from: 0, ops: 10 },
  { from: T(4), ops: 40 },
]
export const FIRST_SETTLED = T(24)

// The real day: a node joins, one crashes, the network splits, one key goes hot, a clock runs fast.
const SCALE_PHASES: Phase[] = [
  { from: 0, ops: 12, hot: 0.05 },
  { from: T(4), ops: 30, hot: 0.05 },
  { from: T(44), ops: 44, hot: 0.5 },
  { from: T(56), ops: 30, hot: 0.05 },
  { from: T(66), ops: 16, hot: 0.05 },
]
const EVENTS: Events = {
  join: { at: T(8) },
  crash: { at: T(18), down: T(8), node: 1 },
  partition: { at: T(32), until: T(37), far: 0.12 },
  skew: { from: T(58), node: 3 },
}
export const SCALE_SETTLED = T(80)
const FAIL_LIMIT = 0.06 // share of operations that may fail
const WAIT_LIMIT = 1.5 // seconds an operation may take, on average
const STALE_LIMIT = 0 // reads that may return an older value
const DIVERGED_LIMIT = 2 // copies that may be out of date at the end

const TIMELINE: NonNullable<BuildTask['timeline']> = {
  phases: [
    { name: 'A quiet start', from: 0 },
    { name: 'A node joins', from: T(8) },
    { name: 'A node crashes', from: T(18) },
    { name: 'Calm again', from: T(26) },
    { name: 'The network splits', from: T(32) },
    { name: 'Calm again', from: T(37) },
    { name: 'One key gets hot', from: T(44) },
    { name: 'A clock runs fast', from: T(58) },
    { name: 'Quiet again', from: T(66) },
  ],
  end: SCALE_SETTLED,
}

export const kvOf = new WeakMap<FlowSim, Kv>()

const seeded = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// Requests travel left to right. A cache that stands level with or right of the coordinator,
// or a ring that stands level with or left of it, has nothing to work with.
function outOfOrder(raw: Placement) {
  const bad = Object.entries(raw).flatMap(([id, kind]) => {
    if (kind === 'cache' && POS[id].x >= COORD_AT.x) return [{ id, why: 'The cache has to stand in front of the coordinator, to answer reads before they reach it. Here it does not.' }]
    if (kind === 'ring' && POS[id].x <= COORD_AT.x) return [{ id, why: 'The ring has to stand after the coordinator, to place its requests. Here it does not.' }]
    return []
  })
  return bad.length ? { ids: bad.map((b) => b.id), why: bad[0].why } : null
}

// Which parts are on the floor, and where. A piece can go on any spot, so what it does comes from its kind.
function layout(raw: Placement) {
  const all = (kind: string) => Object.entries(raw).filter(([, k]) => k === kind).map(([id]) => id)
  const nodes = ALL_SPOTS.filter((id) => raw[id] === 'database')
  const rings = all('ring')
  return {
    nodes,
    ring: rings[0],
    cache: all('cache')[0],
    // A rate limiter guards the lane in front of the coordinator; anywhere else it guards nothing.
    limits: all('limiter').filter((id) => POS[id].x < COORD_AT.x).map((key) => ({ key })),
    extras: all('breaker').length + Math.max(0, rings.length - 1) + all('limiter').filter((id) => POS[id].x >= COORD_AT.x).length + Math.max(0, all('cache').length - 1),
    jam: outOfOrder(raw),
  }
}

export function chosen(settings: Settings) {
  return {
    copies: (settings.copies ?? 0) + 1,
    readQ: (settings.readq ?? 0) + 1,
    writeQ: (settings.writeq ?? 0) + 1,
    handoff: settings.handoff === 1,
    repair: settings.repair === 1,
    slices: settings.slices === 1,
    counter: settings.stamp === 1,
  }
}

interface Mode {
  phases: Phase[]
  events: Events
  hard: boolean
}

function assemble(raw: Placement, settings: Settings, mode: Mode, rng?: () => number) {
  const l = layout(raw)
  // The first design has no such choices: one copy of each key, and a ring that spreads them evenly.
  const s = mode.hard ? chosen(settings) : { copies: 1, readQ: 1, writeQ: 1, handoff: false, repair: false, slices: true, counter: false }
  const cfg: Config = {
    nodes: l.nodes,
    ring: l.ring,
    cache: l.cache,
    limits: l.limits,
    copies: s.copies,
    readQ: s.readQ,
    writeQ: s.writeQ,
    handoff: s.handoff,
    repair: s.repair,
    slices: s.slices,
    counter: s.counter,
    phases: mode.phases,
    events: mode.events,
    jam: l.jam?.ids,
  }
  const kv = new Kv(rng ?? seeded(7), cfg)
  kvOf.set(kv.flow, kv)
  return kv.flow
}

// The checks a finished design must pass. Shown live; the win needs all green.
const answering = (deadline: number): Requirement => ({
  label: 'Answering',
  says: `No more than ${Math.round(FAIL_LIMIT * 100)} in 100 operations may fail, and the average one takes under ${WAIT_LIMIT} seconds.`,
  read: (flow) => {
    const kv = kvOf.get(flow)
    if (!kv) return { text: '', ok: true }
    const share = kv.failShare()
    const slow = flow.tick >= T(10) && kv.wait() > WAIT_LIMIT
    const text = share > 0 ? `${Math.round(share * 100)}% failed` : `${kv.wait().toFixed(2)} s`
    return { text, ok: share <= FAIL_LIMIT && !slow && (flow.tick < deadline || kv.tally.done > 0) }
  },
})
const fresh: Requirement = {
  label: 'Fresh',
  says: 'A read must never return an older value than one written more than a second before.',
  read: (flow) => {
    const kv = kvOf.get(flow)
    if (!kv) return { text: '', ok: true }
    const n = kv.tally.stale
    return { text: n === 0 ? 'all fresh' : `${n} old`, ok: n <= STALE_LIMIT }
  },
}
const agree: Requirement = {
  label: 'Copies agree',
  says: `A node that comes back after a crash must have caught up within 5 seconds, and once the traffic dies down at most ${DIVERGED_LIMIT} copies may be out of date.`,
  read: (flow) => {
    const kv = kvOf.get(flow)
    if (!kv) return { text: '', ok: true }
    const back = kv.atRecovery
    if (back !== undefined && back > DIVERGED_LIMIT) return { text: `${back} behind after a crash`, ok: false }
    if (flow.tick < T(70)) return { text: '', ok: true }
    const n = kv.diverged()
    return { text: n === 0 ? 'all agree' : `${n} out of date`, ok: n <= DIVERGED_LIMIT }
  },
}

const BRIEF = {
  title: 'The brief',
  lines: [
    'A key-value store holds a value for every key. Apps ask it to put a value or to get one back, and it must always answer.',
    'Build one. A key must always be found on the same few machines, and a machine that dies must not take data or answers with it.',
    'Plan for a billion keys and 100,000 operations a second at peak. A few keys get most of the traffic, and machines come and go.',
    'Every read must return the latest value, nothing may be lost, and the store must keep answering while a machine is down.',
  ],
}

const FIXED = [
  { id: 'clients', kind: 'users' as const, ...CLIENTS_AT },
  { id: 'coord', kind: 'app' as const, ...COORD_AT },
]
const LABELS = [
  { at: [CLIENTS_AT.x, 1.6, CLIENTS_AT.z] as [number, number, number], text: 'Apps' },
  { at: [COORD_AT.x, 1.6, COORD_AT.z] as [number, number, number], text: 'Coordinator' },
]
const NAMES: BuildTask['names'] = { database: 'Storage node', ring: 'Hash ring', cache: 'Hot-key cache' }
const PIECE_HINTS: BuildTask['hints'] = {
  database: 'keeps the values of the keys it is given',
  ring: 'gives every key to the same few nodes',
  cache: 'remembers an answer for a moment',
  limiter: 'lets only so many requests a second through',
  breaker: 'stops calling a service that keeps failing',
}

const COUNT = (what: string) => ['1 node', '2 nodes', '3 nodes', '4 nodes', '5 nodes'].map((n) => `${what} ${n}`.trim())
const SETTINGS = [
  { id: 'copies', label: 'every key is kept on', when: 'database' as const, min: 0, max: 4, step: 1, initial: 0, options: COUNT(''),
    tradeoffs: [
      { gain: 'Least storage.', cost: 'One node lost means its keys are lost.' },
      { gain: 'Survives one node going down.', cost: 'Twice the storage.' },
      { gain: 'Survives two nodes going down.', cost: 'Three times the storage.' },
      { gain: 'Survives three nodes going down.', cost: 'Four times the storage.' },
      { gain: 'Survives four nodes going down.', cost: 'Five times the storage, and every write reaches five nodes.' },
    ],
  },
  { id: 'readq', label: 'a read waits for answers from', when: 'database' as const, min: 0, max: 4, step: 1, initial: 0, options: COUNT(''),
    tradeoffs: [
      { gain: 'Fastest. Works while any one copy is up.', cost: 'Can return an old value.' },
      { gain: 'Two copies compared.', cost: 'Waits for 2 nodes. Fails if fewer are up.' },
      { gain: 'Three copies compared.', cost: 'Waits for 3 nodes. Fails if fewer are up.' },
      { gain: 'Four copies compared.', cost: 'Waits for 4 nodes. Fails if fewer are up.' },
      { gain: 'Every copy compared.', cost: 'Waits for 5 nodes. Fails if any one is down.' },
    ],
  },
  { id: 'writeq', label: 'a write waits for answers from', when: 'database' as const, min: 0, max: 4, step: 1, initial: 0, options: COUNT(''),
    tradeoffs: [
      { gain: 'Fastest. Works while any one node is up.', cost: 'Other copies can lag behind.' },
      { gain: 'Lands on 2 nodes before it is confirmed.', cost: 'Waits for 2 nodes. Fails if fewer are up.' },
      { gain: 'Lands on 3 nodes before it is confirmed.', cost: 'Waits for 3 nodes. Fails if fewer are up.' },
      { gain: 'Lands on 4 nodes before it is confirmed.', cost: 'Waits for 4 nodes. Fails if fewer are up.' },
      { gain: 'Lands on every node before it is confirmed.', cost: 'Fails if any one node is down.' },
    ],
  },
  { id: 'handoff', label: 'a write meant for a node that is down', when: 'database' as const, min: 0, max: 1, step: 1, initial: 0, options: ['Skips it', 'Goes to a stand-in node'],
    tradeoffs: [
      { gain: 'Nothing extra to hold.', cost: 'The node that was down misses the write.' },
      { gain: 'The write still lands on enough nodes.', cost: 'The stand-in holds it and must pass it on later.' },
    ],
  },
  { id: 'repair', label: 'a read that finds an old copy', when: 'database' as const, min: 0, max: 1, step: 1, initial: 0, options: ['Leaves it', 'Fixes it'],
    tradeoffs: [
      { gain: 'Reads do no extra work.', cost: 'An old copy stays old until something else fixes it.' },
      { gain: 'Old copies catch up as they are read.', cost: 'Some reads also write.' },
    ],
  },
  { id: 'stamp', label: 'the newest version of a value is decided by', when: 'database' as const, min: 0, max: 1, step: 1, initial: 0, options: ['The time on a node’s clock', 'A version number that counts up'],
    tradeoffs: [
      { gain: 'Nothing to keep: every node has a clock.', cost: 'Clocks drift, so an older write can look newer.' },
      { gain: 'Newer is always a bigger number.', cost: 'The current number must be read before each write.' },
    ],
  },
  { id: 'slices', label: 'each node owns', when: 'ring' as const, min: 0, max: 1, step: 1, initial: 0, options: ['One big slice of the ring', 'Many small slices'],
    tradeoffs: [
      { gain: 'A simple map of who owns what.', cost: 'A node that leaves drops its whole slice on one neighbour.' },
      { gain: 'Load spreads evenly, and a leaving node’s keys spread over many.', cost: 'A bigger map to keep and share.' },
    ],
  },
]

function decorate(flow: FlowSim, raw: Placement) {
  const kv = kvOf.get(flow)
  if (!kv) return null
  const l = layout(raw)
  const hard = kv.cfg.events.crash !== undefined
  const out = [createElement(Tag, { key: 'phase', at: [CLIENTS_AT.x, 2.4, CLIENTS_AT.z], label: hard ? (TIMELINE.phases.filter((p) => p.from <= flow.tick).pop()?.name ?? '') : 'A busy hour' })]
  for (const id of l.jam?.ids ?? []) out.push(createElement(Tag, { key: `jam-${id}`, at: [POS[id].x, 1.8, POS[id].z], label: 'Stops here', danger: true }))
  const share = kv.share()
  for (const s of kv.stores) {
    const at: [number, number, number] = [POS[s.key].x, 1.9, POS[s.key].z]
    const load = kv.nodeLoad(s.key)
    if (!s.alive) out.push(createElement(Tag, { key: `n-${s.key}`, at, label: 'Down', danger: true }))
    else if (!share.has(s.key)) out.push(createElement(Tag, { key: `n-${s.key}`, at, label: 'Not on the ring yet' }))
    else if (kv.streaming(flow.tick) && s === kv.stores[kv.stores.length - 1]) out.push(createElement(Tag, { key: `n-${s.key}`, at, label: 'Receiving its keys' }))
    else out.push(createElement(Tag, { key: `n-${s.key}`, at, label: `${Math.round((share.get(s.key) ?? 0) * 100)}% of keys`, danger: load > 0.6 }))
  }
  if (kv.isPartitioned(flow.tick)) out.push(createElement(Tag, { key: 'split', at: [POS.n4.x - 1.8, 1.9, 1.1], label: 'Cut off from the rest', danger: true }))
  if (l.cache) out.push(createElement(Tag, { key: 'cache', at: [POS[l.cache].x, 1.6, POS[l.cache].z], label: `${kv.tally.hits} answered here` }))
  return out
}

function common(): Pick<BuildTask, 'pinned' | 'manualStart' | 'rps' | 'shot' | 'fixed' | 'labels' | 'decorate' | 'hints' | 'names' | 'failFast' | 'anywhere' | 'replies'> {
  return {
    pinned: BRIEF,
    manualStart: true,
    replies: (job) => job.from === 'op',
    rps: 4,
    shot: { target: [-2, 0.8, 0], zoom: 0.5 },
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
function symptom(kv: Kv): Diagnosis | null {
  const t = kv.tally
  if (t.stale > STALE_LIMIT) return { because: 'Some reads returned an older value than one written before.', look: 'Which nodes does a read listen to, and how is a value judged to be the newest?' }
  if (kv.failShare() > FAIL_LIMIT) return { because: `Some operations failed.${t.limited ? ' Some were turned away by a rate limiter.' : ''}`, look: 'Which nodes are overloaded or out of reach when operations fail, and what can the rest do about it?' }
  if (kv.wait() > WAIT_LIMIT) return { because: 'Some operations are slow.', look: 'Are some nodes much busier than others? Look at how the keys are shared out.' }
  if ((kv.atRecovery ?? 0) > DIVERGED_LIMIT) return { because: 'After a node came back, some copies were still out of date.', look: 'Think about the writes it missed while it was away.' }
  if (kv.cfg.events.crash && kv.flow.tick >= T(70) && kv.diverged() > DIVERGED_LIMIT) return { because: 'Some copies of keys are out of date.', look: 'Think about the writes a node missed while it was away.' }
  return null
}

// Stage 2: a steady load, and the new idea: a ring that decides which node holds which key.
export const FIRST_DESIGN: BuildTask = {
  ...common(),
  title: 'First design: a busy hour.',
  sub: 'Every key must be found again, and no one machine can carry all of them. Changing anything restarts the run.',
  goal: 'Answer every operation within about a second, with none turned away.',
  goalShort: 'Fast answers · none failed',
  win: 'Put a hash ring after the coordinator, so every key goes to one node, and enough storage nodes behind it that each takes only its share.',
  holdSeconds: 4,
  testSeconds: 32,
  pads: FIRST_SPOTS.map(spot),
  toolbox: [
    { kind: 'ring', count: 1 },
    { kind: 'database', count: 4 },
  ],
  requirements: [answering(FIRST_SETTLED)],
  assemble: (placed, settings, rng) => assemble(placed, settings, { phases: FIRST_PHASES, events: {}, hard: false }, rng),
  diagnose(_m, raw, _settings, flow) {
    const kv = kvOf.get(flow)
    if (!kv) return null
    const l = layout(raw)
    if (l.jam) return { because: l.jam.why, look: ORDER_LOOK }
    return symptom(kv)
  },
  problem: (m, raw, settings, flow) => FIRST_DESIGN.diagnose!(m, raw, settings, flow)?.because ?? null,
  hint: (_m, raw, settings) => hintFromReview(review(raw, settings).lines, ['Hash ring'], false),
  check(_m, _raw, _settings, flow) {
    const kv = flow && kvOf.get(flow)
    if (!kv || flow.tick < FIRST_SETTLED) return false
    return kv.failShare() <= 0.02 && kv.wait() <= WAIT_LIMIT && kv.tally.done > 0
  },
}

// Stage 3: the real day. Each phase brings a new way to fail.
export const SCALE_UP: BuildTask = {
  ...common(),
  title: 'Where it breaks: a long day.',
  sub: 'A node joins, one crashes, the network splits, one key goes hot and a clock runs fast. Watch the numbers, then tune it.',
  goal: 'Get through the whole day: answer everything, never return an old value, and end with all copies agreeing.',
  goalShort: 'Survive the whole day',
  win: 'Three copies of every key with quorums of two, so a read meets the latest write. Stand-ins for a down node, fixes on read, small ring slices, a version counter and a hot-key cache.',
  holdSeconds: 4,
  testSeconds: 90,
  pads: ALL_SPOTS.map(spot),
  toolbox: [
    { kind: 'ring', count: 1 },
    { kind: 'database', count: 5 },
    { kind: 'cache', count: 1 },
    { kind: 'limiter', count: 1 },
    { kind: 'breaker', count: 1 },
  ],
  timeline: TIMELINE,
  settings: SETTINGS,
  requirements: [answering(SCALE_SETTLED), fresh, agree],
  assemble: (placed, settings, rng) => assemble(placed, settings, { phases: SCALE_PHASES, events: EVENTS, hard: true }, rng),
  diagnose(_m, raw, _settings, flow) {
    const kv = kvOf.get(flow)
    if (!kv) return null
    const l = layout(raw)
    if (l.jam) return { because: l.jam.why, look: ORDER_LOOK }
    return symptom(kv)
  },
  problem: (m, raw, settings, flow) => SCALE_UP.diagnose!(m, raw, settings, flow)?.because ?? null,
  hint: (_m, raw, settings) => hintFromReview(review(raw, settings).lines, undefined, false),
  check(_m, _raw, _settings, flow) {
    const kv = flow && kvOf.get(flow)
    if (!kv || flow.tick < SCALE_SETTLED) return false
    return kv.failShare() <= FAIL_LIMIT && kv.wait() <= WAIT_LIMIT && kv.tally.stale <= STALE_LIMIT && kv.diverged() <= DIVERGED_LIMIT && (kv.atRecovery ?? 0) <= DIVERGED_LIMIT && kv.tally.done > 0
  },
}

function review(raw: Placement, settings: Settings): Review {
  const l = layout(raw)
  const s = chosen(settings)
  const quorum = s.readQ + s.writeQ > s.copies
  return {
    lines: [
      { label: 'Hash ring', yours: l.ring ? 'A ring after the coordinator' : 'None', reference: 'A ring after the coordinator', why: 'A key must always be found where it was put. The ring gives every key to the same few nodes, and when a node comes or goes only the keys next to it move.', ok: !!l.ring },
      { label: 'Copies', yours: `${s.copies} cop${s.copies === 1 ? 'y' : 'ies'} of every key`, reference: '3 copies of every key', why: 'One copy is lost with its node. Three copies let one node be down, or slow, and the key is still there. More copies cost storage and more work on every write.', ok: s.copies === 3 },
      { label: 'Quorums', yours: `Read ${s.readQ}, write ${s.writeQ}, of ${s.copies}`, reference: 'Read 2 and write 2, of 3', why: 'If the nodes asked by a read and by a write must overlap (R + W > N), a read always meets at least one node that has the latest write. Lower numbers are faster and stay up longer, but can return old values.', ok: quorum && s.copies === 3 && s.readQ === 2 && s.writeQ === 2 },
      { label: 'Node that is down', yours: s.handoff ? 'A stand-in holds the write' : 'The write skips it', reference: 'A stand-in holds the write', why: 'A write meant for a node that is down is kept by another node and handed over when it returns. The write still counts, and the returning node catches up without waiting to be read.', ok: s.handoff },
      { label: 'Old copies', yours: s.repair ? 'A read fixes what it finds' : 'A read leaves them', reference: 'A read fixes what it finds', why: 'A read that sees one node behind the others can send it the newest value. Copies that were missed during a split heal as they are read.', ok: s.repair },
      { label: 'Ring slices', yours: s.slices ? 'Many small slices' : 'One big slice each', reference: 'Many small slices', why: 'With one slice per node, the slices differ in size, so one node holds far more keys and takes the load. With many small slices every node holds about the same, and a new node takes a little from each of the others.', ok: s.slices },
      { label: 'Newest version', yours: s.counter ? 'A version number that counts up' : 'The time on a node’s clock', reference: 'A version number that counts up', why: 'Clocks on different machines never agree exactly. A node whose clock runs fast writes a version that looks newer than later writes, so those are lost. A counter only goes up, so the order is the order of the writes.', ok: s.counter },
      { label: 'Hot key', yours: l.cache ? 'A cache in front of the coordinator' : 'None', reference: 'A cache in front of the coordinator', why: 'A key that most apps ask for lands on the same three nodes however well the ring spreads the rest. Remembering the answer for a moment takes those reads off them.', ok: !!l.cache },
      { label: 'Extras', yours: l.limits.length + l.extras ? 'Pieces this system does not need' : 'Only what is needed', reference: 'No limiter or breaker', why: 'A rate limiter turns real operations away. A breaker guards calls to a failing service, and nothing here calls one.', ok: l.limits.length + l.extras === 0 },
    ],
    tradeoffs: [
      'Raising R and W makes reads fresher and writes safer, but each operation waits for more nodes, and fails when too few are up. Lowering them is faster and stays up longer, but can return old values.',
      'A split forces a choice. Insist on a quorum and the smaller side refuses operations. Settle for fewer and both sides answer, with values that must be merged when the network heals.',
      'A stand-in keeps writes flowing while a node is down, but a quorum met with stand-ins can miss the latest write until the hints are handed back.',
      'A version number that counts up needs one more round to ask for the current number, so each write is a little slower. Clock time costs nothing but can drop a write. Real systems use version vectors to keep both versions instead of dropping one.',
      'A cache absorbs a hot key but may return an answer that is a moment old, so it only fits where that is allowed.',
    ],
    interview: [
      'Clarify: value size, reads against writes, how fresh a read must be, whether a write may ever be lost, and whether range queries are needed.',
      'Estimate: 100,000 operations a second at 10,000 per node is about 10 nodes. A billion 1 KB values is 1 TB, and 3 TB with three copies.',
      'Design: a hash ring places every key on three nodes. Any node can coordinate. A write waits for 2 of 3 and a read asks 2 of 3, so they overlap.',
      'Scale: many small ring slices keep the load even and make adding a node cheap. A cache or extra copies carry a hot key.',
      'Failures: stand-in nodes hold writes for a node that is down, reads repair old copies, and a version number or vector orders writes where clocks cannot.',
    ],
  }
}

// The opening: a tiny store, from a put to a get.
const INTRO_FIXED = [
  { id: 'clients', kind: 'users' as const, x: -8.4, z: 0 },
  { id: 'coord', kind: 'app' as const, x: -4, z: 0 },
  { id: 'r1', kind: 'ring' as const, x: -0.4, z: 0 },
  { id: 'n1', kind: 'database' as const, x: 3.4, z: -3 },
  { id: 'n2', kind: 'database' as const, x: 3.4, z: 0 },
  { id: 'n3', kind: 'database' as const, x: 3.4, z: 3 },
]
export const INTRO: Intro = {
  task: {
    title: 'How a key-value store works',
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
      const kv = new Kv(rng ?? seeded(3), {
        nodes: ['n1', 'n2', 'n3'],
        ring: 'r1',
        limits: [],
        copies: 2,
        readQ: 1,
        writeQ: 2,
        handoff: false,
        repair: false,
        slices: true,
        counter: false,
        phases: [{ from: 0, ops: 1 }],
        events: {},
      })
      kvOf.set(kv.flow, kv)
      return kv.flow
    },
    check: () => false,
  },
  steps: [
    { say: 'An app wants to save a value under a key, like “cart:dana”. It sends the pair to the store.', at: 'clients', label: 'App' },
    { say: 'The coordinator takes the request. It does not hold data. It only has to find who does.', at: 'coord', label: 'Coordinator' },
    { say: 'The hash ring turns the key into a spot on a circle and gives it to the next nodes around it. The same key always lands on the same nodes.', at: 'r1', label: 'Hash ring' },
    { say: 'Each of those nodes stores the value. Two copies, so one node can fail and the value is still there.', at: 'n2', label: 'Storage node' },
    { say: 'A read goes the same way and returns the value. Easy with three nodes. Now picture a billion keys, machines that die, and a network that splits.' },
  ],
  start: 'Take the challenge →',
}

export const KEY_VALUE_STORE: Capstone = {
  id: 'key-value-store',
  title: 'Key-value store',
  stages: ['Requirements', 'First design', 'Where it breaks', 'Final review'],
  intro: INTRO,
  goals: ['Find every key', 'Survive a crash', 'Never return old data', 'Handle a hot key'],
  brief: BRIEF,
  estimate: {
    intro: 'Before drawing anything, work out how big this is. A few quick numbers decide the design.',
    summary: { title: 'About 10 nodes to serve it, and 3 TB to hold it.', body: 'Serving needs several nodes, so keys must be spread by a ring, not kept on one machine. Holding three copies of a TB means the store must also survive losing a node, and copying a node’s data to a new one takes hours, not seconds.' },
    questions: [
      { question: 'The store takes 100,000 operations a second at peak. One node can serve about 10,000. About how many nodes just to serve the traffic?', options: ['About 10', 'About 100', 'About 1,000'], answer: 0, at: 'coord', show: '~10 nodes', why: '100,000 ÷ 10,000 is 10. In practice, add room for peaks and for nodes that are down, so 15 to 20, but not hundreds.' },
      { question: 'There are a billion keys, and every value is 1 KB. About how much data is that?', options: ['About 1 GB', 'About 1 TB', 'About 1 PB'], answer: 1, at: 'n2', show: '1 TB', why: '1 billion × 1 KB is 1,000 GB, which is 1 TB. It fits on one disk, but not on one machine that must also serve 100,000 operations a second.' },
      { question: 'Every key is kept on 3 nodes. About how much storage must be bought?', options: ['About 1 TB', 'About 3 TB', 'About 30 TB'], answer: 1, at: 'n1', show: '3 TB', why: 'Three copies of 1 TB is 3 TB. Copies cost storage, and every write now goes to three nodes, so writes cost three times as much work as reads.' },
      { question: 'A key has 3 copies. A write needs 2 answers. How many of the 3 nodes can be down before writes to that key stop?', options: ['None', 'One', 'Two'], answer: 1, at: 'r1', show: '1 node down', why: 'With 3 copies and a quorum of 2, one node can be down and the other two still answer. If two are down, only one is left, which is below the quorum, so the write is refused.' },
      { question: 'A node holds 1 TB. A new node copies it at 100 MB/s. About how long until the new node has its keys?', options: ['About 3 minutes', 'About 3 hours', 'About 3 days'], answer: 1, at: 'n3', show: '~3 hours', why: '1 TB ÷ 100 MB/s is 10,000 seconds, about 3 hours. Adding a node is not instant. Spread the work over many small slices so each node sends a little, and the copy is far shorter.' },
    ],
  },
  first: FIRST_DESIGN,
  scale: SCALE_UP,
  review,
}
