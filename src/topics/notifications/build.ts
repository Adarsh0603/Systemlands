import { createElement } from 'react'
import { ORDER_LOOK, hintFromReview } from '../../core/build/hint'
import { Tag } from '../../core/iso/primitives'
import { PIECE_NAMES } from '../../core/build/types'
import type { BuildTask, Placement, Requirement, Settings } from '../../core/build/types'
import type { FlowSim } from '../../core/flow/engine'
import { PriorityQueue } from '../../core/flow/priority'
import type { Capstone, Intro, Review } from '../../core/capstone/types'
import { ATTEMPTS, KINDS, Notifier, PACES, SECOND, type Config, type Kind, type Profile, type World } from './notifier'

// The design board: the three kinds of message on the left, the front door,
// then the pacer, queue and senders, and the outside providers on the right.
const Z = [-3.4, 0, 3.4]
const SOURCE_X = -8.8
const API_AT = { x: -6.6, z: 0 }
const GATE_AT = { x: -4.4, z: 0 }
const Q_AT = { x: -2.0, z: 0 }
const SEND_X = 0.9
const SEND_Z = [-3.0, 0, 3.0]
const DEDUPE_AT = { x: 3.6, z: 0 }
const DEAD_AT = { x: 3.6, z: 4.6 }
const SPARE_AT = [{ x: -4.4, z: -4.6 }, { x: -2.0, z: -4.6 }]
const PROVIDER_X = 6.8

const SEND_PADS = ['send-0', 'send-1', 'send-2']
const NAMES: Record<Kind, string> = { otp: 'Login codes', orders: 'Order updates', promo: 'Marketing' }
const PROVIDER_NAMES = ['SMS', 'Push', 'Email']

// The world, by second. The first design runs a quiet service where providers
// drop the odd call. Then it gets busy:
//   0-6s calm, 6-16s a marketing blast (and everyone logs in), 16-24s calm, 24-28s the push provider
//   is down, 28-34s recovering, 34-52s the SMS provider loses its answers, then calm.
const T = (s: number) => s * SECOND
const calm = (otp: number, orders: number, promo: number): World['load'] => ({ otp, orders, promo })
const WORLD = { pushDown: false, smsLostRate: 0, failRate: 0.05 }

export const FIRST_PROFILE: Profile = () => ({ ...WORLD, failRate: 0.15, load: calm(2, 3, 1) })
export const SCALE_PROFILE: Profile = (tick) => {
  if (tick < T(6)) return { ...WORLD, load: calm(2, 3, 0) }
  if (tick < T(16)) return { ...WORLD, load: calm(10, 4, 25) }
  if (tick < T(24)) return { ...WORLD, load: calm(2, 3, 2) }
  if (tick < T(28)) return { ...WORLD, pushDown: true, load: calm(2, 5, 2) }
  if (tick < T(34)) return { ...WORLD, load: calm(2, 3, 2) }
  if (tick < T(52)) return { ...WORLD, smsLostRate: 0.3, load: calm(3, 3, 2) }
  return { ...WORLD, load: calm(0, 0, 0) }
}
export const FIRST_SETTLED = T(25)
export const SCALE_SETTLED = T(68)
const PHASES: [number, string][] = [
  [T(6), 'Calm'],
  [T(16), 'A marketing blast'],
  [T(24), 'Calm'],
  [T(28), 'The push provider is down'],
  [T(34), 'Recovering'],
  [T(52), 'SMS answers get lost'],
  [Infinity, 'Draining'],
]
const phaseAt = (tick: number) => PHASES.find(([end]) => tick < end)![1]
// The same day as a strip, by name only: what is coming stays a surprise.
const TIMELINE: NonNullable<BuildTask['timeline']> = {
  phases: [
    { name: 'Calm', from: 0 },
    { name: 'Blast', from: T(6) },
    { name: 'Calm', from: T(16) },
    { name: 'Push down', from: T(24) },
    { name: 'Recovering', from: T(28) },
    { name: 'SMS lost', from: T(34) },
    { name: 'Day over', from: T(52) },
  ],
  end: SCALE_SETTLED,
}

export const notifierOf = new WeakMap<FlowSim, Notifier>()

// A small seeded random source, so every run of a design plays out the same.
const seeded = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// What the learner has chosen.
export function chosen(settings: Settings) {
  return {
    attempts: ATTEMPTS[settings.attempts ?? 0],
    lanes: (settings.lanes ?? 0) === 1,
    pace: PACES[settings.pace ?? PACES.length - 1],
  }
}

// A piece can stand on any spot. What it does comes from its kind, not its spot,
// so the parts are found by kind and named here as the code below knows them.
const CANON: Partial<Record<string, string>> = { limiter: 'gate', queue: 'q', dedupe: 'dedupe', dead: 'dead' }
const POS: Record<string, { x: number; z: number }> = {
  gate: GATE_AT,
  q: Q_AT,
  'send-0': { x: SEND_X, z: SEND_Z[0] },
  'send-1': { x: SEND_X, z: SEND_Z[1] },
  'send-2': { x: SEND_X, z: SEND_Z[2] },
  dedupe: DEDUPE_AT,
  dead: DEAD_AT,
  'spare-0': SPARE_AT[0],
  'spare-1': SPARE_AT[1],
}
// Traffic runs from the front door on the left to the providers on the right,
// through whatever stands in its way, in this order. A part that stands ahead of
// one that should come before it has nothing to work with, and traffic stops there.
const COL: Record<string, number> = { gate: 0, 'spare-0': 0, q: 1, 'spare-1': 1, 'send-0': 2, 'send-1': 2, 'send-2': 2, dedupe: 3, dead: 3 }
const RANK: Partial<Record<string, number>> = { limiter: 0, queue: 1, server: 2, dedupe: 3, dead: 3 }
function outOfOrder(raw: Placement) {
  const parts = Object.entries(raw)
    .filter(([, kind]) => RANK[kind] !== undefined)
    .map(([id, kind]) => ({ id, kind, rank: RANK[kind]!, col: COL[id] ?? 0 }))
  const ahead = parts.flatMap((hi) => parts.filter((lo) => hi.rank > lo.rank && hi.col <= lo.col).map((lo) => ({ hi, lo })))
  if (ahead.length === 0) return null
  const name = (k: string) => PIECE_NAMES[k as keyof typeof PIECE_NAMES].toLowerCase()
  const first = ahead[0]
  return {
    ids: [...new Set(ahead.map((a) => a.hi.id))],
    why: `The ${name(first.hi.kind)} stands in front of the ${name(first.lo.kind)}, but messages travel left to right and meet it first. It has nothing to work with there, so they stop at it.`,
  }
}

// `placed` says which parts exist (limiter as gate, queue as q, servers as send-0…);
// `pad` says which real spot each one stands on.
function layout(raw: Placement) {
  const placed: Placement = {}
  const pad: Record<string, string> = {}
  const servers: string[] = []
  for (const [id, kind] of Object.entries(raw)) {
    if (kind === 'server') servers.push(id)
    else if (CANON[kind]) {
      placed[CANON[kind]!] = kind
      pad[CANON[kind]!] = id
    }
  }
  servers.forEach((id, i) => {
    placed[`send-${i}`] = 'server'
    pad[`send-${i}`] = id
  })
  const jam = outOfOrder(raw)
  return { placed, pad, jam }
}
const placedSenders = (placed: Placement) => Object.keys(placed).filter((id) => id.startsWith('send-'))
const decoyOn = (raw: Placement, kind: string) => Object.values(raw).includes(kind as never)

function assemble(raw: Placement, settings: Settings, profile: Profile, rng?: () => number) {
  const { placed, pad, jam } = layout(raw)
  const { attempts, lanes, pace } = chosen(settings)
  const cfg: Config = {
    senders: placedSenders(placed).map((id) => pad[id]),
    jam: jam?.ids,
    keys: { queue: pad.q, gate: pad.gate, dedupe: pad.dedupe, dead: pad.dead },
    queue: placed.q ? (lanes ? 'lanes' : 'line') : 'none',
    pace: placed.gate ? pace : undefined,
    dead: !!placed.dead,
    dedupe: !!placed.dedupe,
    attempts,
    profile,
  }
  const n = new Notifier(rng ?? seeded(7), cfg)
  notifierOf.set(n.flow, n)
  return n.flow
}

// How many of a kind missed, counting messages still on their way only once the run has settled.
const missed = (n: Notifier, kind: Kind, settled: boolean) => {
  const f = n.flow
  const stuck = settled ? Math.max(0, (f.made[kind] ?? 0) - (f.done[kind] ?? 0) - (f.lost[kind] ?? 0) - n.parked(kind)) : 0
  // A parked login code is no use: it has expired by the time anyone looks. Other kinds can be sent again.
  return (f.lost[kind] ?? 0) + (f.late[kind] ?? 0) + stuck + (kind === 'otp' ? n.parked(kind) : 0)
}

// What went missing and where, for a failure no sharper cause explains.
const KIND_NAMES: Record<Kind, string> = { otp: 'login codes', orders: 'order updates', promo: 'marketing messages' }
function missedWhy(n: Notifier, settled: boolean) {
  const f = n.flow
  const bits = KINDS.filter((k) => missed(n, k, settled) > 0).map((k) => `${missed(n, k, settled)} ${KIND_NAMES[k]} (${f.lost[k] ?? 0} lost, ${f.late[k] ?? 0} late)`)
  const top = Object.entries(f.lostAt).sort((a, b) => b[1] - a[1])[0]
  const where = top ? ` ${top[1]} were turned away at ${top[0] === n.keys.queue ? 'the queue' : top[0] === n.keys.gate ? 'the hold-back' : 'a full line'}.` : ''
  return bits.length ? `Missed: ${bits.join(', ')}.${where}` : null
}

// When no sharper cause fits: say so plainly and send the learner to watch where messages wait or drop.
const missedDiagnosis = (missing: string | null) =>
  missing
    ? { because: 'Some messages did not arrive in time.', look: 'Watch where messages pile up or get turned away, and ask what that part is missing.' }
    : null

// The checks a finished design must pass. Shown live; the win needs all green.
const arrives = (kind: Kind, label: string, limit: number, settledAt: number): Requirement => ({
  label,
  says: `${label} must be delivered on time. No more than ${limit} may arrive late or be lost.`,
  read: (flow) => {
    const n = notifierOf.get(flow)
    if (!n) return { text: '', ok: true }
    const m = missed(n, kind, flow.tick >= settledAt)
    const first = n.firstMiss[kind]
    const when = m > 0 && first !== undefined ? `, first in “${phaseAt(first)}”` : ''
    return { text: m === 0 ? 'all arrived' : `${m} late or lost${when}`, ok: m <= limit }
  },
})
const sentOnce = (): Requirement => ({
  label: 'Texts sent twice',
  says: 'Nobody may get the same text twice, even when a call is retried.',
  read: (flow) => {
    const d = notifierOf.get(flow)?.duplicates ?? 0
    return { text: d === 0 ? 'none' : `${d} people got two`, ok: d === 0 }
  },
})

const BRIEF = {
  title: 'The brief',
  lines: [
    'When you log in, you wait for a code by text. When your order ships, you get a message on your phone. When there is a sale, you get an email. All of these are notifications, and your app has to send millions of them a day.',
    'You do not send them yourself. A text goes out through an SMS company, a phone alert through a push service, and an email through an email service. These outside providers are slow, they limit how fast you can send, and sometimes they drop a call or go down.',
    'Build the system that sends them. Each kind has a deadline: a login code must arrive within 4 seconds, because someone is staring at the login screen. An order update has 30 seconds. A marketing email has 1 minute.',
    'Two things must never happen: a message is lost, or the same message is sent twice.',
  ],
}

const FIXED = [
  ...KINDS.map((k, i) => ({ id: k, kind: 'users' as const, x: SOURCE_X, z: Z[i] })),
  { id: 'api', kind: 'app' as const, ...API_AT },
  ...PROVIDER_NAMES.map((_, i) => ({ id: ['sms', 'push', 'email'][i], kind: 'provider' as const, x: PROVIDER_X, z: Z[i] })),
]
const LABELS = [
  ...KINDS.map((k, i) => ({ at: [SOURCE_X, 1.6, Z[i]] as [number, number, number], text: NAMES[k] })),
  ...PROVIDER_NAMES.map((name, i) => ({ at: [PROVIDER_X, 2.2, Z[i]] as [number, number, number], text: name })),
]
const SETTINGS = [
  { id: 'attempts', label: 'tries', when: 'server' as const, min: 0, max: ATTEMPTS.length - 1, step: 1, initial: 0, options: ATTEMPTS.map((n) => (n === 1 ? 'Try once' : `Up to ${n} tries`)),
    tradeoffs: [
      { gain: 'No repeat work.', cost: 'A message that fails once is lost for good.' },
      { gain: 'Survives one failed send.', cost: 'A failed send costs a second try.' },
      { gain: 'Survives two failed sends.', cost: 'Failing messages hold up the line longer.' },
      { gain: 'Almost nothing is lost.', cost: 'A message that keeps failing takes five tries of work.' },
    ],
  },
  { id: 'lanes', label: 'order', when: 'queue' as const, min: 0, max: 1, step: 1, initial: 0, options: ['One shared line', 'Urgent first, by kind'],
    tradeoffs: [
      { gain: 'Simple: first in, first out.', cost: 'An urgent message waits behind everything ahead of it.' },
      { gain: 'Urgent messages skip the line.', cost: 'Less urgent messages can wait a long time.' },
    ],
  },
  { id: 'pace', label: 'marketing pace', when: 'limiter' as const, min: 0, max: PACES.length - 1, step: 1, initial: PACES.length - 1, options: PACES.map((n) => `${n} / second`),
    tradeoffs: [
      { gain: 'Marketing barely touches capacity.', cost: 'A campaign takes a long time to go out.' },
      { gain: 'Leaves room for other messages.', cost: 'Campaigns go out slowly.' },
      { gain: 'Campaigns go out faster.', cost: 'Less room left for other messages.' },
      { gain: 'Campaigns go out fastest.', cost: 'Can crowd out other messages.' },
    ],
  },
]

// Turns away work once a line is full: the whole queue, or any one lane of it.
function nearlyFull(q: NonNullable<Notifier['queue']>) {
  if (q instanceof PriorityQueue) return q.lanes.some((l) => l.length >= q.laneCapacity * 0.8)
  return q.load() >= q.capacity * 0.8
}

function decorate(flow: FlowSim, raw: Placement) {
  const { placed, pad, jam } = layout(raw)
  const n = notifierOf.get(flow)
  if (!n) return null
  const out = [createElement(Tag, { key: 'phase', at: [SOURCE_X, 2.6, API_AT.z], label: phaseAt(flow.tick), danger: n.providers.push.down })]
  if (placed.q && n.queue && nearlyFull(n.queue)) out.push(createElement(Tag, { key: 'full', at: [POS[pad.q].x, 1.8, POS[pad.q].z], label: 'Almost full', danger: true }))
  for (const id of jam?.ids ?? []) out.push(createElement(Tag, { key: `jam-${id}`, at: [POS[id].x, 1.8, POS[id].z], label: 'Stops here', danger: true }))
  if (n.providers.push.down) out.push(createElement(Tag, { key: 'down', at: [PROVIDER_X, 3.0, Z[1]], label: 'Down', danger: true }))
  if (placed.dead) out.push(createElement(Tag, { key: 'dead', at: [POS[pad.dead].x, 1.4, POS[pad.dead].z], label: `${n.dead?.jobs.length ?? 0} parked` }))
  if (placed.gate) out.push(createElement(Tag, { key: 'gate', at: [POS[pad.gate].x, 1.6, POS[pad.gate].z], label: `${n.flow.node(pad.gate)?.load?.() ?? 0} held` }))
  return out
}

function common(): Pick<BuildTask, 'pinned' | 'manualStart' | 'rps' | 'shot' | 'fixed' | 'labels' | 'decorate'> {
  return {
    pinned: BRIEF,
    manualStart: true,
    rps: 4,
    shot: { target: [-1.0, 0.8, 0.4], zoom: 0.5 },
    fixed: FIXED,
    labels: LABELS,
    decorate,
  }
}

const PIECE_HINTS: BuildTask['hints'] = {
  queue: 'Holds messages so the front door can move on',
  server: 'A sender: calls the provider and waits',
  limiter: 'Holds marketing back to a steady pace',
  dedupe: 'Remembers what was sent, blocks repeats',
  dead: 'Parks messages that ran out of tries',
  cache: 'Remembers answers to repeated questions',
  balancer: 'Spreads requests over identical servers',
}

const waiting = {
  kind: 'note' as const,
  label: 'Waiting to send',
  read: (flow: FlowSim) => {
    const n = notifierOf.get(flow)
    const w = n ? (n.queue?.load() ?? 0) + (flow.node(n.keys.gate)?.load?.() ?? 0) : 0
    return { text: String(w), bad: w > 60 }
  },
}

// Stage 2: a quiet service, and one new idea: do not call the provider from the request.
export const FIRST_DESIGN: BuildTask = {
  ...common(),
  failFast: true,
  anywhere: true,
  title: 'First design: a queue and senders.',
  sub: 'Put a queue between the front door and the providers, add senders to work through it, then decide what happens when a provider drops a call.',
  goal: 'Deliver every message even though providers drop some calls.',
  goalShort: 'Queue · senders · retries',
  win: 'The queue takes messages in at once and senders work through them. A call that fails is tried again, so almost nothing is lost.',
  holdSeconds: 4,
  testSeconds: 30,
  pads: [
    { id: 'q', ...Q_AT, accepts: ['queue'] },
    ...SEND_PADS.slice(0, 2).map((id, i) => ({ id, x: SEND_X, z: SEND_Z[i * 2], accepts: ['server' as const] })),
  ],
  toolbox: [
    { kind: 'queue', count: 1 },
    { kind: 'server', count: 2 },
  ],
  hints: PIECE_HINTS,
  settings: [SETTINGS[0]],
  watch: [waiting],
  requirements: [arrives('otp', 'Login codes', 2, Infinity), arrives('orders', 'Order updates', 2, Infinity), arrives('promo', 'Marketing', 2, Infinity)],
  assemble: (placed, settings, rng) => assemble(placed, settings, FIRST_PROFILE, rng),
  diagnose(_m, raw, settings, flow) {
    const n = notifierOf.get(flow)
    if (!n) return null
    const { placed, jam } = layout(raw)
    if (jam) return { because: jam.why, look: ORDER_LOOK }
    const { attempts } = chosen(settings)
    if (!placed.q) return { because: 'Messages are turned away at the front door. Nothing holds a message while the providers are busy.', look: 'What sits between the front door and the providers when a provider is slow?' }
    if (placedSenders(placed).length === 0) return { because: 'Messages are waiting and nothing is taking them out.', look: 'Who makes the actual calls to the providers?' }
    if (attempts === 1 && KINDS.some((k) => n.lostOf(k) > 1)) return { because: 'Providers sometimes drop a call. With a single try, every dropped call is a message lost.', look: 'What should a sender do when a call fails?' }
    return missedDiagnosis(missedWhy(n, false))
  },
  problem: (m, raw, settings, flow) => FIRST_DESIGN.diagnose!(m, raw, settings, flow)?.because ?? null,
  hint: (_m, raw, settings) => hintFromReview(review(raw, settings).lines, ['Intake', 'Senders', 'Failed calls'], false),
  check(_m, raw, _settings, flow) {
    const { placed, jam } = layout(raw)
    const n = flow && notifierOf.get(flow)
    if (!n || jam || !placed.q || placedSenders(placed).length === 0 || flow.tick < FIRST_SETTLED) return false
    return KINDS.every((k) => missed(n, k, false) <= 2)
  },
}

// Stage 3: the same board, a busy day. Each phase breaks something new.
export const SCALE_UP: BuildTask = {
  ...common(),
  failFast: true,
  anywhere: true,
  title: 'Where it breaks: a busy day.',
  sub: 'A marketing blast, a provider outage, a provider that loses its answers. Watch what turns red, then fix it. Changing anything restarts the run.',
  goal: 'Get through the whole day with every message delivered in time and nobody texted twice.',
  goalShort: 'Survive the whole day',
  win: 'Urgent messages go first, marketing is paced to the email limit, failed calls retry and park when they run out, and a dedupe store stops a retry from sending twice.',
  holdSeconds: 4,
  testSeconds: 75,
  pads: [
    { id: 'gate', ...GATE_AT, accepts: ['limiter'] },
    { id: 'q', ...Q_AT, accepts: ['queue'] },
    ...SEND_PADS.map((id, i) => ({ id, x: SEND_X, z: SEND_Z[i], accepts: ['server' as const] })),
    { id: 'dedupe', ...DEDUPE_AT, accepts: ['dedupe'] },
    { id: 'dead', ...DEAD_AT, accepts: ['dead'] },
    ...SPARE_AT.map((at, i) => ({ id: `spare-${i}`, ...at, accepts: ['cache' as const, 'balancer' as const] })),
  ],
  toolbox: [
    { kind: 'limiter', count: 1 },
    { kind: 'queue', count: 1 },
    { kind: 'server', count: 3 },
    { kind: 'dedupe', count: 1 },
    { kind: 'dead', count: 1 },
    { kind: 'cache', count: 1 },
    { kind: 'balancer', count: 1 },
  ],
  hints: PIECE_HINTS,
  timeline: TIMELINE,
  statusNote: (flow) => {
    const n = notifierOf.get(flow)
    if (!n || flow.tick < T(52)) return null
    return n.inFlight === 0 ? 'Day over. Every message is accounted for.' : `Day over, no new messages. ${n.inFlight} still on their way.`
  },
  settings: SETTINGS,
  watch: [waiting],
  requirements: [
    arrives('otp', 'Login codes', 5, SCALE_SETTLED),
    arrives('orders', 'Order updates', 2, SCALE_SETTLED),
    arrives('promo', 'Marketing', 8, SCALE_SETTLED),
    sentOnce(),
  ],
  assemble: (placed, settings, rng) => assemble(placed, settings, SCALE_PROFILE, rng),
  diagnose(_m, raw, settings, flow) {
    const n = notifierOf.get(flow)
    if (!n) return null
    const { placed, jam } = layout(raw)
    if (jam) return { because: jam.why, look: ORDER_LOOK }
    const tick = flow.tick
    const { attempts, lanes, pace } = chosen(settings)
    const f = n.flow
    const senders = placedSenders(placed).length
    if (!placed.q || senders === 0) return { because: 'Messages have nowhere to wait, or nothing to send them.', look: 'Is there a place for messages to wait, and someone to take them out?' }
    if (n.duplicates > 0) {
      if (!placed.dedupe && attempts > 1) return { because: 'A provider sent the text but its answer was lost. The sender thought it failed and sent it again.', look: 'What lets the system know a message already went out before it sends it again?' }
      if (!placed.dedupe) return { because: 'People got the same text twice.', look: 'What remembers what was already sent?' }
    }
    if (tick >= T(6) && missed(n, 'otp', false) > 5 && !lanes) return { because: 'Login codes are waiting behind the marketing blast in the same line.', look: 'Should every kind of message wait in the same line? Think about who is watching the clock.' }
    if ((f.lostAt.q ?? 0) > 0 && f.lost.promo > 8 && !placed.gate) return { because: 'The blast arrives faster than the email provider takes it, and the queue overflows.', look: 'Can anything slow marketing down before it reaches the queue?' }
    if (placed.gate && pace > 12 && n.providers.email.turnedAway > 5) return { because: 'Marketing is released faster than the email provider accepts. It turns the extra away, and each turned-away call is retried.', look: 'Compare the marketing pace with how fast the email provider takes messages.' }
    if (placed.gate && pace < 6 && tick >= T(40) && n.flow.node(n.keys.gate)!.load!() > 20) return { because: 'Marketing is released so slowly that the blast is still being sent long after the deadline.', look: 'Compare the marketing pace with how fast the email provider takes messages.' }
    if (tick >= T(24) && n.providers.push.down && attempts <= 3 && !placed.dead && missed(n, 'orders', false) > 2) return { because: 'The push provider was down and the sender ran out of tries before it came back. Those order updates went nowhere.', look: 'What happens to a message after its last try?' }
    if (senders < 3 && tick >= T(8) && (n.queue?.load() ?? 0) > 30) return { because: 'The senders cannot keep up. Each waits on its provider with a call open.', look: 'How many messages can be in flight to a slow provider at once?' }
    if (decoyOn(raw, 'cache')) return { because: 'A cache remembers answers to repeated questions. Every notification is different, so it holds nothing useful.', look: 'Which piece on the board is not helping this system?' }
    if (decoyOn(raw, 'balancer')) return { because: 'A load balancer spreads requests over identical servers. Here the queue already hands work to the senders, so it does nothing.', look: 'Which piece on the board is not helping this system?' }
    return missedDiagnosis(missedWhy(n, true))
  },
  problem: (m, raw, settings, flow) => SCALE_UP.diagnose!(m, raw, settings, flow)?.because ?? null,
  hint: (_m, raw, settings) => hintFromReview(review(raw, settings).lines, undefined, false),
  check(_m, _placed, _settings, flow) {
    const n = flow && notifierOf.get(flow)
    if (!n || flow.tick < SCALE_SETTLED) return false
    return missed(n, 'otp', true) <= 5 && missed(n, 'orders', true) <= 2 && missed(n, 'promo', true) <= 8 && n.duplicates === 0
  },
}

const has = (placed: Placement, id: string) => !!placed[id]

function review(raw: Placement, settings: Settings): Review {
  const { placed } = layout(raw)
  const { attempts, lanes, pace } = chosen(settings)
  const senders = placedSenders(placed).length
  return {
    lines: [
      { label: 'Intake', yours: has(placed, 'q') ? 'Queue before the senders' : 'Straight to the senders', reference: 'Queue before the senders', why: 'A message is accepted at once and sent later, so a slow provider never slows the app that asked.', ok: has(placed, 'q') },
      { label: 'Priority', yours: has(placed, 'q') && lanes ? 'Urgent first, by kind' : 'One shared line', reference: 'Separate lanes, urgent first', why: 'A login code must not wait behind a million emails. Give each kind its own lane and always serve the urgent one first.', ok: has(placed, 'q') && lanes },
      { label: 'Senders', yours: `${senders} sender${senders === 1 ? '' : 's'}`, reference: 'Enough senders for the slowest provider', why: 'Each sender holds a call open while it waits. A slow provider ties up more senders.', ok: senders >= 3 },
      { label: 'Marketing pace', yours: has(placed, 'gate') ? `${pace} / second` : 'Unpaced', reference: 'Paced just under the provider limit', why: 'You cannot raise a provider’s limit, so hold your own traffic back and release it at the pace they allow.', ok: has(placed, 'gate') && pace <= 12 && pace >= 8 },
      { label: 'Failed calls', yours: attempts === 1 ? 'No retry' : `Up to ${attempts} tries`, reference: 'Retry with growing pauses', why: 'Most failures pass in seconds. Doubling the pause stops a struggling provider from being hit harder.', ok: attempts >= 3 },
      { label: 'Giving up', yours: has(placed, 'dead') ? 'Parked in a dead-letter queue' : 'Lost', reference: 'Dead-letter queue', why: 'After the last try a message is parked, not thrown away, so someone can see it and send it again.', ok: has(placed, 'dead') },
      { label: 'Extras', yours: decoyOn(raw, 'cache') || decoyOn(raw, 'balancer') ? 'A cache or balancer that does nothing' : 'Only what is needed', reference: 'No cache, no balancer', why: 'Every notification is different, so a cache holds nothing useful, and the queue already spreads work over the senders. An extra piece is cost and one more thing to fail.', ok: !decoyOn(raw, 'cache') && !decoyOn(raw, 'balancer') },
      { label: 'Repeats', yours: has(placed, 'dedupe') ? 'Dedupe store' : 'Nothing', reference: 'Dedupe by message id', why: 'A lost answer makes a sender retry a message that was sent. Remember what went out and do not send it again.', ok: has(placed, 'dedupe') },
    ],
    tradeoffs: [
      'Retrying makes a message more likely to arrive, but a retry after a lost answer sends it twice. Retry together with a dedupe store, or not at all.',
      'Strict priority can starve the low lanes if the urgent one never empties. A cap per lane, or a share of the senders for each, avoids that.',
      'A parked message is not delivered. For a login code that expires in minutes, parking it is only a record. For an order update it is a real second chance.',
      'Choosing the channel is a cost choice too: an SMS costs about a cent, an email a fraction of that. Send a code by SMS, a newsletter by email.',
    ],
    interview: [
      'Clarify: which channels, how many a day, which kinds are urgent, can a message be sent twice, do users opt out.',
      'Estimate: 10M users at 3 messages a day is about 350 a second on average. A marketing blast to everyone in an hour is about 2,800 a second.',
      'Design: an API that validates and puts a message on a queue, a separate lane for each priority, senders per channel calling the provider.',
      'Reliability: retries with backoff, a dead-letter queue, an idempotency key per message so a retry never sends twice.',
      'Scale: pace the sends under each provider’s limit, add senders for the slow channels, and keep the lanes apart.',
    ],
  }
}

// The opening: one order, one message, one phone. Nothing to place yet.
const INTRO_PROFILE: Profile = () => ({ ...WORLD, failRate: 0, load: calm(0, 0.7, 0) })
const INTRO_FIXED = [
  { id: 'orders', kind: 'users' as const, x: -6.4, z: 0 },
  { id: 'api', kind: 'app' as const, x: -3.4, z: 0 },
  { id: 'send-0', kind: 'server' as const, x: -0.4, z: 0 },
  { id: 'push', kind: 'provider' as const, x: 2.8, z: 0 },
]
export const INTRO: Intro = {
  task: {
    title: 'How a notification travels',
    sub: '',
    goal: '',
    win: '',
    holdSeconds: 1,
    rps: 1,
    shot: { target: [-1.8, 0.8, 0], zoom: 0.9 },
    fixed: INTRO_FIXED,
    pads: [],
    toolbox: [],
    assemble: (_placed, _settings, rng) => {
      const n = new Notifier(rng ?? seeded(3), { senders: ['send-0'], queue: 'none', dead: false, dedupe: false, attempts: 1, profile: INTRO_PROFILE })
      notifierOf.set(n.flow, n)
      return n.flow
    },
    check: () => false,
  },
  steps: [
    { say: 'A shop ships your order. Its system asks the notification service to tell you.', at: 'orders', label: 'The shop' },
    { say: 'The notification service takes the request in. It is built once and used by every team.', at: 'api', label: 'Notification service' },
    { say: 'A sender writes the message and picks the channel. For an order update: push.', at: 'send-0', label: 'Sender' },
    { say: 'Apple’s or Google’s push network buzzes your phone. We don’t run it, so we can’t fix it when it breaks.', at: 'push', label: 'Push network' },
    { say: 'Easy for one message. Now picture 10 million users, and a sale email going to all of them at once.' },
  ],
  start: 'Take the challenge →',
}

export const NOTIFICATIONS: Capstone = {
  id: 'notifications',
  title: 'Notification system',
  stages: ['Requirements', 'First design', 'Where it breaks', 'Final review'],
  intro: INTRO,
  goals: ['Login codes · 4 s', 'Order updates · 30 s', 'Marketing · 1 min', 'Never twice'],
  brief: BRIEF,
  estimate: {
    intro: 'Three quick numbers decide the design.',
    summary: { title: 'About 350 messages a second, with a blast near 2,800.', body: 'The blast, not the average, sets the design. The channel you pick sets the bill.' },
    questions: [
      { question: '10 million users get about 3 notifications a day each. About how many messages a second, on average?', options: ['About 35', 'About 350', 'About 3,500'], answer: 1, at: 'orders', show: '350 / second', why: '30,000,000 a day ÷ 86,400 seconds is about 350 a second. Spread out, that is modest.' },
      { question: 'Marketing wants to email all 10 million users in one hour. About how many a second?', options: ['About 280', 'About 2,800', 'About 28,000'], answer: 1, at: 'api', show: '2,800 / second in a blast', why: '10,000,000 ÷ 3,600 is about 2,800 a second, eight times the everyday load. The blast, not the average, sets the design.' },
      { question: 'An SMS costs about 1 cent. What would sending that blast by SMS instead of email cost?', options: ['About $1,000', 'About $100,000', 'About $10,000,000'], answer: 1, at: 'push', show: '$100,000 by SMS', why: '10 million × $0.01 is $100,000. Pick the channel by cost: SMS for codes that need it, email for the rest.' },
    ],
  },
  first: FIRST_DESIGN,
  scale: SCALE_UP,
  review,
}
