import { createElement } from 'react'
import { ORDER_LOOK, hintFromReview } from '../../core/build/hint'
import { Tag } from '../../core/iso/primitives'
import type { BuildTask, Diagnosis, Placement, Requirement, Settings } from '../../core/build/types'
import type { FlowSim } from '../../core/flow/engine'
import type { Capstone, Intro, Review } from '../../core/capstone/types'
import { Pay, SECOND, type Config, type Events, type LaneKind, type Phase } from './payments'

// The design board: shoppers on the left, checkout in the middle, the provider and the ledger on the
// right. The road from checkout to the provider runs along the top, and the queue's spot is below.
const SHOPPERS_AT = { x: -9.8, z: 0 }
const CHECKOUT_AT = { x: -2.6, z: 0 }
const PROVIDER_AT = { x: 7.4, z: -2.4 }
const LEDGER_AT = { x: 7.4, z: 2.6 }
const POS: Record<string, { x: number; z: number }> = {
  l1: { x: -6.4, z: 0 },
  d0: { x: -6.4, z: -3.6 },
  m1: { x: 0.8, z: -2.4 },
  m2: { x: 4, z: -2.4 },
  q1: { x: 0.8, z: 2.6 },
  d1: { x: 4, z: 2.6 },
}
const FIRST_SPOTS = ['l1', 'm1', 'm2']
const ALL_SPOTS = ['l1', 'd0', 'm1', 'm2', 'q1', 'd1']
const spot = (id: string) => ({ id, ...POS[id], accepts: [] })

const T = (s: number) => s * SECOND
const FRONT_CAP = 10 // orders a second a limiter in front of checkout lets through
const LANE_CAP = 8 // charges a second a limiter on the road lets through

// The first design: a busy hour in which a quarter of the shoppers click Pay twice and the provider
// sometimes refuses a charge, or makes it and loses the answer.
const FIRST_PHASES: Phase[] = [
  { from: 0, orders: 6 },
  { from: T(6), orders: 9 },
]
export const FIRST_SETTLED = T(34)

// The real day: a double-click storm, a provider that slows down and then goes dark, answers that go
// missing, and a crash in the middle of a flash sale.
const SCALE_PHASES: Phase[] = [
  { from: 0, orders: 6 },
  { from: T(8), orders: 8, clicks: 2 },
  { from: T(14), orders: 6 },
  { from: T(16), orders: 14 },
  { from: T(21), orders: 8 },
  { from: T(30), orders: 6 },
  { from: T(34), orders: 8 },
  { from: T(42), orders: 6 },
  { from: T(44), orders: 12 },
  { from: T(50), orders: 4 },
]
const EVENTS: Events = {
  slow: [T(16), T(21)],
  down: [T(21), T(28)],
  lost: { from: T(34), to: T(42), rate: 0.3 },
  crash: { at: T(46), down: T(2) },
}
export const SCALE_SETTLED = T(72)
const FAIL_LIMIT = 2 // shoppers that may be turned away in all
const WAIT_LIMIT = 2 // seconds an average click may take to be answered
const SETTLED_WAIT = 5 // seconds an order may be open once the day is over

const TIMELINE: NonNullable<BuildTask['timeline']> = {
  phases: [
    { name: 'A quiet start', from: 0 },
    { name: 'A double-click storm', from: T(8) },
    { name: 'Calm again', from: T(14) },
    { name: 'The provider slows down', from: T(16) },
    { name: 'The provider is down', from: T(21) },
    { name: 'The provider is back', from: T(28) },
    { name: 'Answers go missing', from: T(34) },
    { name: 'Calm again', from: T(42) },
    { name: 'A flash sale', from: T(44) },
    { name: 'Checkout crashes', from: T(46) },
    { name: 'Catching up', from: T(50) },
  ],
  end: SCALE_SETTLED,
}

export const payOf = new WeakMap<FlowSim, Pay>()

const seeded = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const JAM_WHY: Record<string, string> = {
  dedupe: 'The idempotency store has to stand between checkout and the provider, where it sees every charge. Here it does not.',
  breaker: 'The breaker has to stand on the road between checkout and the provider, to guard the calls. Here it does not.',
  order: 'The breaker has to stand in front of the idempotency store, nearer checkout. Retries wait at the store and never reach a breaker behind it, so it cannot see the provider failing.',
  queue: 'The queue has to stand behind checkout, to hold orders it could not charge yet. Here it does not.',
}

// Which parts are on the floor, and where. A piece can go on any spot, so what it does comes from its kind and
// from which side of checkout it stands on: charges flow from checkout towards the provider.
function layout(raw: Placement) {
  const entries = Object.entries(raw)
  const byX = (a: string, b: string) => POS[a].x - POS[b].x || POS[a].z - POS[b].z
  const front = entries
    .filter(([id, kind]) => POS[id].x < CHECKOUT_AT.x && ['limiter', 'dedupe', 'breaker', 'queue'].includes(kind))
    .map(([id]) => id)
    .sort(byX)
  const lane = entries
    .filter(([id, kind]) => POS[id].x > CHECKOUT_AT.x && POS[id].x < PROVIDER_AT.x && ['limiter', 'dedupe', 'breaker'].includes(kind))
    .map(([id]) => id)
    .sort(byX)
  const jam = front.filter((id) => raw[id] !== 'limiter')
  // A store that stands nearer checkout than the breaker holds back the retries, so the breaker never sees them.
  const store = lane.findIndex((id) => raw[id] === 'dedupe')
  const breaker = lane.findIndex((id) => raw[id] === 'breaker')
  const backwards = store >= 0 && breaker >= 0 && store < breaker ? lane[store] : undefined
  return {
    front: front.map((key) => ({ key, kind: raw[key] === 'limiter' ? ('limiter' as const) : ('jam' as const), rate: FRONT_CAP })),
    lane: lane.map((key) => ({ key, kind: key === backwards ? ('jam' as const) : (raw[key] as LaneKind), rate: LANE_CAP })),
    queue: entries.filter(([id, kind]) => kind === 'queue' && POS[id].x > CHECKOUT_AT.x).map(([id]) => id)[0],
    has: (kind: string) => lane.some((id) => raw[id] === kind),
    limits: entries.filter(([, kind]) => kind === 'limiter').length,
    extras: entries.filter(([, kind]) => kind === 'ring').length,
    jam: jam.length ? { ids: jam, why: JAM_WHY[raw[jam[0]]] } : backwards ? { ids: [backwards], why: JAM_WHY.order } : null,
  }
}

export const KEY_NAMES = ['New for every try', 'New for every click', 'One for the whole order']
export const TIMEOUT_NAMES = ['10 seconds', '3 seconds', '1 second']
const TIMEOUTS = [T(10), T(3), T(1)]
const CRASH_NAMES = ['Nothing is kept', 'The order is written down first, and finished after', 'Charges with no order are refunded']
export function chosen(settings: Settings) {
  return {
    key: (settings.key ?? 0) as 0 | 1 | 2,
    timeout: settings.timeout ?? 0,
    retry: settings.retry === 1,
    crash: (settings.crash ?? 0) as 0 | 1 | 2,
  }
}

interface Mode {
  phases: Phase[]
  events: Events
  hard: boolean
  dupes: number
  errRate: number
  lostRate: number
}

function assemble(raw: Placement, settings: Settings, mode: Mode, rng?: () => number) {
  const l = layout(raw)
  const s = chosen(settings)
  // The first design has no such choices: a 3 second wait, up to 3 tries, and nothing to recover.
  const cfg: Config = {
    front: l.front,
    lane: l.lane,
    queue: l.queue,
    jam: l.jam?.ids,
    key: s.key,
    timeout: mode.hard ? TIMEOUTS[s.timeout] : T(3),
    tries: mode.hard ? (s.retry ? 3 : 1) : 3,
    crash: mode.hard ? s.crash : 0,
    dupes: mode.dupes,
    errRate: mode.errRate,
    lostRate: mode.lostRate,
    phases: mode.phases,
    events: mode.events,
  }
  const pay = new Pay(rng ?? seeded(7), cfg)
  payOf.set(pay.flow, pay)
  return pay.flow
}

// The checks a finished design must pass. Shown live; the win needs all green.
const once: Requirement = {
  label: 'Charged once',
  says: 'No customer may ever be charged twice for one order.',
  read: (flow) => {
    const n = payOf.get(flow)?.doubles() ?? 0
    return { text: n === 0 ? 'none twice' : `${n} charged twice`, ok: n === 0 }
  },
}
const matched: Requirement = {
  label: 'Money and orders',
  says: 'Every charge must end up as a saved order, and every order a shopper was told about must be charged within a minute.',
  read: (flow) => {
    const p = payOf.get(flow)
    if (!p) return { text: '', ok: true }
    const orphans = p.orphans()
    const late = p.late()
    const text = orphans > 0 ? `${orphans} charged, no order` : late > 0 ? `${late} not charged yet` : 'all match'
    return { text, ok: orphans === 0 && late === 0 }
  },
}
const served = (deadline: number): Requirement => ({
  label: 'Shoppers served',
  says: `At most ${FAIL_LIMIT} shoppers may be turned away in all, and the average click is answered in under ${WAIT_LIMIT} seconds.`,
  read: (flow) => {
    const p = payOf.get(flow)
    if (!p) return { text: '', ok: true }
    const failed = p.failed()
    const slow = flow.tick >= T(4) && p.wait() > WAIT_LIMIT
    const text = failed > 0 ? `${failed} turned away` : `${p.wait().toFixed(2)} s`
    return { text, ok: failed <= FAIL_LIMIT && !slow && (flow.tick < deadline || p.savedCount() > 0) }
  },
})

const BRIEF = {
  title: 'The brief',
  lines: [
    'Checkout takes a shopper’s card and turns a cart into an order. A payment provider does the charging, and a ledger keeps the orders.',
    'Build it. Money must move exactly once for each order, and the orders must always agree with the charges.',
    'Plan for a flash sale: 500,000 orders in an hour. Shoppers double-click and retry, the provider is slow or down now and then, and checkout can crash at any moment.',
    'A customer must never be charged twice, never be charged without an order, and never be left staring at a spinner.',
  ],
}

const FIXED = [
  { id: 'shoppers', kind: 'users' as const, ...SHOPPERS_AT },
  { id: 'checkout', kind: 'app' as const, ...CHECKOUT_AT },
  { id: 'provider', kind: 'provider' as const, ...PROVIDER_AT },
  { id: 'ledger', kind: 'database' as const, ...LEDGER_AT },
]
const LABELS = [
  { at: [SHOPPERS_AT.x, 1.6, SHOPPERS_AT.z] as [number, number, number], text: 'Shoppers' },
  { at: [CHECKOUT_AT.x, 1.6, CHECKOUT_AT.z] as [number, number, number], text: 'Checkout' },
  { at: [PROVIDER_AT.x, 2, PROVIDER_AT.z] as [number, number, number], text: 'Payment provider' },
  { at: [LEDGER_AT.x, 2.2, LEDGER_AT.z] as [number, number, number], text: 'Ledger' },
]
const NAMES: BuildTask['names'] = { dedupe: 'Idempotency store', queue: 'Order queue', breaker: 'Circuit breaker' }
const PIECE_HINTS: BuildTask['hints'] = {
  dedupe: 'remembers which charges were made, so a repeat is not charged again',
  breaker: 'stops calling a provider that keeps failing',
  queue: 'holds orders to charge later',
  limiter: 'lets only so many requests a second through',
  ring: 'gives each key to one machine',
}

const KEY = { id: 'key', label: 'the idempotency key is', when: 'dedupe' as const, min: 0, max: 2, step: 1, initial: 0, options: KEY_NAMES,
  tradeoffs: [
    { gain: 'Nothing to keep between tries.', cost: 'A retry looks like a new charge.' },
    { gain: 'Retries of one click share a key.', cost: 'A second click looks like a new charge.' },
    { gain: 'Every try and click for the order share one key.', cost: 'The key must be made with the order and kept.' },
  ],
}
const SETTINGS = [
  KEY,
  { id: 'timeout', label: 'checkout waits for a charge', when: 'app' as const, min: 0, max: 2, step: 1, initial: 0, options: TIMEOUT_NAMES,
    tradeoffs: [
      { gain: 'Slow charges still finish.', cost: 'A stuck charge holds checkout for 10 seconds.' },
      { gain: 'Stuck charges are given up on sooner.', cost: 'Some slow charges are cut off.' },
      { gain: 'Checkout is never held for long.', cost: 'Many normal charges are cut off.' },
    ],
  },
  { id: 'retry', label: 'a charge that fails', when: 'app' as const, min: 0, max: 1, step: 1, initial: 0, options: ['Is given up on', 'Is tried up to 3 times'],
    tradeoffs: [
      { gain: 'No risk of charging twice.', cost: 'A brief failure loses the sale.' },
      { gain: 'Brief failures recover.', cost: 'Each retry can charge again unless it is recognised.' },
    ],
  },
  { id: 'crash', label: 'when checkout crashes mid-order', when: 'app' as const, min: 0, max: 2, step: 1, initial: 0, options: CRASH_NAMES,
    tradeoffs: [
      { gain: 'No extra writes.', cost: 'A crash can leave a charge with no order.' },
      { gain: 'Every order can be finished after a crash.', cost: 'An extra write before every charge.' },
      { gain: 'No extra write on the way in.', cost: 'The customer is charged, then refunded, and the order is lost.' },
    ],
  },
]

function decorate(flow: FlowSim, raw: Placement) {
  const p = payOf.get(flow)
  if (!p) return null
  const l = layout(raw)
  const hard = p.cfg.events.crash !== undefined
  const out = [createElement(Tag, { key: 'phase', at: [SHOPPERS_AT.x, 2.4, SHOPPERS_AT.z], label: hard ? (TIMELINE.phases.filter((x) => x.from <= flow.tick).pop()?.name ?? '') : 'A busy hour' })]
  for (const id of l.jam?.ids ?? []) out.push(createElement(Tag, { key: `jam-${id}`, at: [POS[id].x, 1.8, POS[id].z], label: 'Stops here', danger: true }))
  if (p.crashed(flow.tick)) out.push(createElement(Tag, { key: 'down', at: [CHECKOUT_AT.x, 2.4, CHECKOUT_AT.z], label: 'Crashed', danger: true }))
  else if (p.checkout.line.length > 0) out.push(createElement(Tag, { key: 'line', at: [CHECKOUT_AT.x, 2.4, CHECKOUT_AT.z], label: `${p.checkout.line.length} clicks waiting`, danger: p.checkout.line.length > 15 }))
  if (p.provider.down) out.push(createElement(Tag, { key: 'prov', at: [PROVIDER_AT.x, 2.8, PROVIDER_AT.z], label: 'Down', danger: true }))
  else if (p.provider.slow) out.push(createElement(Tag, { key: 'prov', at: [PROVIDER_AT.x, 2.8, PROVIDER_AT.z], label: 'Slow: 5 s a charge', danger: true }))
  const crash = p.crashLoss()
  if (crash.lost > 0) out.push(createElement(Tag, { key: 'lost', at: [CHECKOUT_AT.x, 3.2, CHECKOUT_AT.z], label: `${crash.lost} orders lost in the crash`, danger: true }))
  const charged = p.count((o) => o.charges - o.refunds > 0)
  out.push(createElement(Tag, { key: 'ledger', at: [LEDGER_AT.x, 3, LEDGER_AT.z], label: `${p.savedCount()} saved · ${charged} charged`, danger: p.doubles() > 0 || p.orphans() > 0 }))
  if (p.breaker && p.breaker.state !== 'closed') {
    const at = POS[p.breaker.key]
    out.push(createElement(Tag, { key: 'breaker', at: [at.x, 1.8, at.z], label: p.breaker.state === 'open' ? 'Open: not calling' : 'Testing the road', danger: p.breaker.state === 'open' }))
  }
  if (p.dedupe && p.dedupe.blocked > 0) {
    const at = POS[p.dedupe.key]
    out.push(createElement(Tag, { key: 'dedupe', at: [at.x, 1.8, at.z], label: `${p.dedupe.blocked} repeats stopped` }))
  }
  if (p.queue) {
    const at = POS[p.queue.key]
    const n = p.queue.load()
    if (n > 0) out.push(createElement(Tag, { key: 'queue', at: [at.x, 1.8, at.z], label: `${n} orders waiting` }))
  }
  return out
}

function common(): Pick<BuildTask, 'pinned' | 'manualStart' | 'rps' | 'shot' | 'fixed' | 'labels' | 'decorate' | 'hints' | 'names' | 'failFast' | 'anywhere' | 'replies'> {
  return {
    pinned: BRIEF,
    manualStart: true,
    replies: (job) => job.from === 'click',
    rps: 4,
    shot: { target: [-1.4, 0.8, 0], zoom: 0.5 },
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
function symptom(p: Pay): Diagnosis | null {
  const doubles = p.doubles()
  if (doubles > 0) return { because: 'Some customers were charged twice.', look: 'What happens if the same payment request arrives more than once?' }
  const orphans = p.orphans()
  if (orphans > 0) return { because: 'Some customers were charged, with no order written down.', look: 'Between charging the card and writing the order, what can go wrong?' }
  const failed = p.failed()
  const crash = p.crashLoss()
  if (crash.lost > 0 && failed > FAIL_LIMIT) return { because: `Checkout crashed with orders in progress. Some of them were lost${crash.charged > 0 ? ', some after the card was charged' : ''}.`, look: 'What is kept of an order in progress if the machine handling it disappears?' }
  if (failed > FAIL_LIMIT) return { because: `Some shoppers were turned away.${p.limited ? ' Some were turned away by a rate limiter.' : ''}`, look: 'Which part is overloaded when shoppers arrive together?' }
  const late = p.late()
  if (late > 0) return { because: 'Some orders were still not charged after a minute.', look: 'Where do orders wait, and what is slow about the step after the wait?' }
  if (p.wait() > WAIT_LIMIT) return { because: 'Paying is slow.', look: 'Which part does every payment pass through, and how busy is it?' }
  return null
}

function diagnose(_m: unknown, raw: Placement, _settings: Settings, flow: FlowSim): Diagnosis | null {
  const p = payOf.get(flow)
  if (!p) return null
  const l = layout(raw)
  if (l.jam) return { because: l.jam.why, look: ORDER_LOOK }
  return symptom(p)
}
const problem = (m: unknown, raw: Placement, settings: Settings, flow: FlowSim) => diagnose(m, raw, settings, flow)?.because ?? null

// Once the traffic is over, every order must be finished.
function done(p: Pay, tick: number, settled: number) {
  return tick >= settled && p.doubles() === 0 && p.orphans() === 0 && p.failed() <= FAIL_LIMIT && p.wait() <= WAIT_LIMIT && p.late(T(SETTLED_WAIT)) === 0 && p.savedCount() > 0
}

// Stage 2: one new idea. A repeat of the same order must not be charged again.
export const FIRST_DESIGN: BuildTask = {
  ...common(),
  title: 'First design: a busy hour.',
  sub: 'A quarter of the shoppers click Pay twice, and the provider sometimes makes a charge and loses the answer. Decide what stands on the road. Changing anything restarts the run.',
  goal: 'Charge each order once, however often it is sent, and save every order.',
  goalShort: 'Charge once · save every order',
  win: 'An idempotency store on the road to the provider, with one key for the whole order. A repeat of the order, a retry or a double click, is recognised and answered without a second charge.',
  holdSeconds: 4,
  testSeconds: 40,
  pads: FIRST_SPOTS.map(spot),
  toolbox: [
    { kind: 'dedupe', count: 1 },
    { kind: 'breaker', count: 1 },
  ],
  settings: [KEY],
  watch: [{ kind: 'note', label: 'Orders saved', read: (flow) => ({ text: String(payOf.get(flow)?.savedCount() ?? 0), bad: false }) }],
  requirements: [once, matched, served(FIRST_SETTLED)],
  assemble: (placed, settings, rng) => assemble(placed, settings, { phases: FIRST_PHASES, events: {}, hard: false, dupes: 0.25, errRate: 0.06, lostRate: 0.04 }, rng),
  diagnose,
  problem,
  hint: (_m, raw, settings) => hintFromReview(review(raw, settings).lines, ['Idempotency key'], false),
  check: (_m, _raw, _settings, flow) => {
    const p = flow && payOf.get(flow)
    return !!p && done(p, flow.tick, FIRST_SETTLED)
  },
}

// Stage 3: the real day. Each phase brings a new way to fail.
export const SCALE_UP: BuildTask = {
  ...common(),
  title: 'Where it breaks: a bad day.',
  sub: 'Double-click storms, a slow provider, a dead one, lost answers and a crash. Watch the numbers, then tune it.',
  goal: 'Get through the whole day: nobody charged twice, no charge without an order, nobody turned away.',
  goalShort: 'Survive the whole day',
  win: 'Idempotency store with one key per order, a short timeout, retries, a breaker with an order queue behind checkout, and the order written down before the charge so a crash can be finished.',
  holdSeconds: 4,
  testSeconds: 76,
  pads: ALL_SPOTS.map(spot),
  toolbox: [
    { kind: 'dedupe', count: 1 },
    { kind: 'breaker', count: 1 },
    { kind: 'queue', count: 1 },
    { kind: 'limiter', count: 1 },
    { kind: 'ring', count: 1 },
  ],
  timeline: TIMELINE,
  settings: SETTINGS,
  watch: [{ kind: 'note', label: 'Orders saved', read: (flow) => ({ text: String(payOf.get(flow)?.savedCount() ?? 0), bad: false }) }],
  requirements: [once, matched, served(SCALE_SETTLED)],
  assemble: (placed, settings, rng) => assemble(placed, settings, { phases: SCALE_PHASES, events: EVENTS, hard: true, dupes: 0.12, errRate: 0.04, lostRate: 0.02 }, rng),
  diagnose,
  problem,
  hint: (_m, raw, settings) => hintFromReview(review(raw, settings).lines, undefined, false),
  check: (_m, _raw, _settings, flow) => {
    const p = flow && payOf.get(flow)
    return !!p && done(p, flow.tick, SCALE_SETTLED)
  },
}

function review(raw: Placement, settings: Settings): Review {
  const l = layout(raw)
  const s = chosen(settings)
  const store = l.has('dedupe')
  const extras = l.limits + l.extras
  return {
    lines: [
      { label: 'Idempotency key', yours: store ? `A store, key: ${KEY_NAMES[s.key].toLowerCase()}` : 'No idempotency store', reference: 'A store, one key for the whole order', why: 'A shopper can click twice, and a retry can repeat a charge whose answer was lost. One key for the whole order lets the store recognise every repeat of it. A key made for each click only recognises retries of that click, and one made for each try recognises nothing.', ok: store && s.key === 2 },
      { label: 'Timeout', yours: TIMEOUT_NAMES[s.timeout], reference: '1 second', why: 'A charge takes a fraction of a second. Waiting longer than a second only holds checkout’s slots while a slow provider answers nobody.', ok: s.timeout === 2 },
      { label: 'Retries', yours: s.retry ? 'Up to 3 tries' : 'Gives up at once', reference: 'Up to 3 tries', why: 'Most failures are blips, and the next try works. Retries are safe because the store recognises a repeat.', ok: s.retry },
      { label: 'Circuit breaker', yours: l.has('breaker') ? 'On the road to the provider' : 'None', reference: 'On the road to the provider', why: 'When the provider is down, every call waits for its timeout. A breaker stops calling at once, so checkout keeps its slots, and tests the road now and then.', ok: l.has('breaker') },
      { label: 'Order queue', yours: l.queue ? 'Behind checkout' : 'None', reference: 'Behind checkout', why: 'While the breaker is open the provider cannot be asked. The queue takes the order, tells the shopper it is received, and charges it when the provider is back.', ok: !!l.queue },
      { label: 'After a crash', yours: CRASH_NAMES[s.crash], reference: CRASH_NAMES[1], why: 'A crash can fall between the charge and the order. Writing the order down first lets checkout finish it after the restart, and the key makes the second charge a no-op. Refunding keeps the money straight but loses the sale.', ok: s.crash === 1 },
      { label: 'Extras', yours: extras ? 'Pieces this system does not need' : 'Only what is needed', reference: 'No limiter or hash ring', why: 'A rate limiter turns real shoppers away or fails real charges. A hash ring has nothing to place when one provider takes every charge.', ok: extras === 0 },
    ],
    tradeoffs: [
      'A queued order is charged later, so a shopper is told "received" before the money moves. If the card fails then, the shopper must be told by email.',
      'A short timeout can give up on a charge the provider is still making. The key is what makes that safe.',
      'The store has to remember keys for a while. Too short and a late retry is charged again, too long and it costs memory.',
      'Writing the order down first costs a write on every order, in exchange for being able to finish after any crash.',
    ],
    interview: [
      'Clarify: orders and peak per second, which providers, refunds, partial payments, what a double charge costs, how long a shopper may wait.',
      'Estimate: 500,000 orders in a flash-sale hour is about 140 a second. At 300 ms a charge, about 40 calls are in flight, and a 10 second outage piles up 1,400.',
      'Design: checkout, idempotency key per order, store of keys, provider client with timeout, retries and breaker, ledger, order queue, recovery sweep.',
      'Scale: shard the ledger by order, keep keys in a fast store with a time limit, queue orders when the provider is down.',
      'Failures: slow provider (timeout, breaker), unknown outcome (ask by key, never charge again), crash between charge and save (intent log, reconcile).',
    ],
  }
}

// The opening: a tiny checkout, from a click to a saved order.
const INTRO_FIXED = [
  { id: 'shoppers', kind: 'users' as const, x: -8, z: 0 },
  { id: 'checkout', kind: 'app' as const, x: -3.2, z: 0 },
  { id: 'provider', kind: 'provider' as const, x: 2.4, z: -2.4 },
  { id: 'ledger', kind: 'database' as const, x: 2.4, z: 2.6 },
]
export const INTRO: Intro = {
  task: {
    title: 'How a checkout works',
    sub: '',
    goal: '',
    win: '',
    holdSeconds: 1,
    rps: 1,
    shot: { target: [-2.8, 0.8, 0], zoom: 0.85 },
    fixed: INTRO_FIXED,
    pads: [],
    toolbox: [],
    assemble: (_placed, _settings, rng) => {
      const pay = new Pay(rng ?? seeded(3), { front: [], lane: [], key: 0, timeout: T(3), tries: 3, crash: 0, dupes: 0, errRate: 0, lostRate: 0, phases: [{ from: 0, orders: 1 }], events: {} })
      payOf.set(pay.flow, pay)
      return pay.flow
    },
    check: () => false,
  },
  steps: [
    { say: 'A shopper presses Pay.', at: 'shoppers', label: 'A click' },
    { say: 'Checkout asks a payment provider to charge the card. The provider is another company: you cannot make it faster.', at: 'provider', label: 'Payment provider' },
    { say: 'When the provider says yes, checkout writes the order in the ledger.', at: 'ledger', label: 'Ledger' },
    { say: 'The shopper sees "order placed". Money moved once, and an order exists. Easy while nothing fails.' },
    { say: 'Now picture a double click, a provider that goes quiet, and a crash between the charge and the order.' },
  ],
  start: 'Take the challenge →',
}

export const PAYMENTS: Capstone = {
  id: 'payments',
  title: 'Payments',
  stages: ['Requirements', 'First design', 'Where it breaks', 'Final review'],
  intro: INTRO,
  goals: ['Charged once', 'Orders match money', 'Never a spinner', 'Survive a bad day'],
  brief: BRIEF,
  estimate: {
    intro: 'Before drawing anything, work out how big this is. A few quick numbers decide the design.',
    summary: { title: 'About 140 orders a second, but 40 calls in flight, and 1,400 when the provider is slow.', body: 'Charges are few, so scale is not the problem. Mistakes are: a repeat is a second charge, a slow provider is a pile of waiting calls, and a crash in the middle is money with no order.' },
    questions: [
      { question: 'A flash sale brings 500,000 orders in one hour. About how many orders a second?', options: ['About 14', 'About 140', 'About 1,400'], answer: 1, at: 'shoppers', show: '140 orders / second', why: '500,000 ÷ 3,600 seconds is about 140.' },
      { question: 'One order in ten is clicked twice, or sent again by a retry. With nothing to stop it, how many customers a second are charged twice?', options: ['About 1.4', 'About 14', 'About 140'], answer: 1, at: 'checkout', show: '14 double charges / second', why: '10% of 140 is 14 customers a second. In an hour, 50,000 customers would be charged twice.' },
      { question: 'The provider takes 300 ms per charge. About how many charges are in flight at once, at the peak?', options: ['About 4', 'About 40', 'About 400'], answer: 1, at: 'provider', show: '42 calls in flight', why: '140 orders a second × 0.3 seconds is about 42 calls open at any moment.' },
      { question: 'Now the provider is slow: 10 seconds per call, and checkout waits for each. About how many calls pile up?', options: ['About 140', 'About 1,400', 'About 14,000'], answer: 1, at: 'checkout', show: '1,400 calls waiting', why: '140 a second × 10 seconds is about 1,400 calls. More than checkout can hold, so shoppers are turned away. Give up early, and stop calling.' },
      { question: 'Each order is worth $50, and 1 order in 1,000 is charged but never saved, because of a crash in between. How much money is that in the hour?', options: ['About $500', 'About $5,000', 'About $25,000'], answer: 2, at: 'ledger', show: '$25,000 with no order', why: '500 lost orders × $50 is $25,000 taken for nothing in one hour. Money and orders must never disagree.' },
    ],
  },
  first: FIRST_DESIGN,
  scale: SCALE_UP,
  review,
}
