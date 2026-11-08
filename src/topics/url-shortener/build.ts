import { createElement } from 'react'
import { ORDER_LOOK, hintFromReview } from '../../core/build/hint'
import { Tag } from '../../core/iso/primitives'
import { PIECE_NAMES } from '../../core/build/types'
import type { BuildTask, Diagnosis, Placement, Requirement, Settings } from '../../core/build/types'
import type { FlowSim } from '../../core/flow/engine'
import type { Capstone, Intro, Review } from '../../core/capstone/types'
import { CACHE_SIZES, LIMITS, SCHEMES, SCOPES, SECOND, Shortener, type Load, type Profile } from './shortener'

// The design board: sources on the left, the front door, app servers, then
// cache and queue, and the database with its replicas on the right.
const USERS_AT = { x: -8.6, z: 0 }
const MAKERS_AT = { x: -8.6, z: -3.3 }
const BOT_AT = { x: -8.6, z: 3.3 }
const GATE_AT = { x: -6.1, z: 0 }
const LB_AT = { x: -3.8, z: 0 }
const APP_X = -1.2
const CACHE_AT = { x: 2.0, z: -2.8 }
const QUEUE_AT = { x: 2.0, z: 2.8 }
const DB_AT = { x: 5.8, z: 0 }
const REPLICA_Z = [-3.2, 3.2]
const APP_Z = [-2.8, 2.8]
const SPARE_AT = [{ x: -3.8, z: -4.2 }, { x: -3.8, z: 4.2 }]

const APP_PADS = ['app-1', 'app-2']
const REPLICA_PADS = ['rep-0', 'rep-1']

// Load, by second. The first design runs a quiet service. Then it grows:
//   0-6s calm, 6-22s everyone is reading, 22-38s one link goes viral,
//   38-54s a bot floods the create button.
const T = (s: number) => s * SECOND
const QUIET: Load = { users: 3, makers: 1.5, bot: 0, hot: 0 }
export const FIRST_PROFILE: Profile = () => QUIET
export const SCALE_PROFILE: Profile = (tick) => {
  if (tick < T(6)) return { users: 4, makers: 1, bot: 0, hot: 0 }
  if (tick < T(22)) return { users: 20, makers: 1, bot: 0, hot: 0 }
  if (tick < T(38)) return { users: 36, makers: 1, bot: 0, hot: 0.55 }
  return { users: 12, makers: 1, bot: 30, hot: 0 }
}
export const FIRST_SETTLED = T(25)
export const SCALE_SETTLED = T(56)
const PHASES: [number, string][] = [
  [T(6), 'Calm'],
  [T(22), 'Everyone is reading'],
  [T(38), 'One link goes viral'],
  [Infinity, 'A bot floods create'],
]
const phaseAt = (tick: number) => PHASES.find(([end]) => tick < end)![1]

// The same day as a strip, by name only: what is coming stays a surprise.
const TIMELINE: NonNullable<BuildTask['timeline']> = {
  phases: [
    { name: 'Calm', from: 0 },
    { name: 'Reading', from: T(6) },
    { name: 'Viral link', from: T(22) },
    { name: 'Bot', from: T(38) },
  ],
  end: SCALE_SETTLED,
}

export const shortenerOf = new WeakMap<FlowSim, Shortener>()

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
    scheme: SCHEMES[settings.scheme ?? 0],
    cacheSize: CACHE_SIZES[settings.cache ?? 0],
    limit: LIMITS[settings.limit ?? 2],
    scope: SCOPES[settings.scope ?? 0],
  }
}

// A piece can stand on any spot. What it does comes from its kind, not its spot,
// so the parts are found by kind and named here as the code below knows them.
const CANON: Partial<Record<string, string>> = { balancer: 'lb', limiter: 'gate', cache: 'cache', queue: 'queue' }
const POS: Record<string, { x: number; z: number }> = {
  gate: GATE_AT,
  lb: LB_AT,
  'app-0': { x: APP_X, z: 0 },
  'app-1': { x: APP_X, z: APP_Z[0] },
  'app-2': { x: APP_X, z: APP_Z[1] },
  cache: CACHE_AT,
  queue: QUEUE_AT,
  'rep-0': { x: DB_AT.x, z: REPLICA_Z[0] },
  'rep-1': { x: DB_AT.x, z: REPLICA_Z[1] },
  'spare-0': SPARE_AT[0],
  'spare-1': SPARE_AT[1],
}
// Requests run from the visitors on the left to the database on the right,
// through whatever stands in their way, in this order. A part that stands ahead of
// one that should come before it has nothing to work with, and requests stop there.
const RANK: Partial<Record<string, number>> = { limiter: 0, balancer: 1, app: 2, cache: 3, queue: 3, replica: 4 }
function outOfOrder(raw: Placement) {
  const parts = [
    { id: 'app-0', kind: 'app', rank: 2, x: APP_X, fixed: true },
    ...Object.entries(raw)
      .filter(([, kind]) => RANK[kind] !== undefined)
      .map(([id, kind]) => ({ id, kind, rank: RANK[kind]!, x: POS[id].x, fixed: false })),
  ]
  const ahead = parts.flatMap((hi) => parts.filter((lo) => hi.rank > lo.rank && hi.x <= lo.x).map((lo) => ({ hi, lo })))
  if (ahead.length === 0) return null
  const name = (k: string) => PIECE_NAMES[k as keyof typeof PIECE_NAMES].toLowerCase()
  const first = ahead[0]
  return {
    ids: [...new Set(ahead.flatMap((a) => [a.hi, a.lo]).filter((p) => !p.fixed).map((p) => p.id))],
    why: `The ${name(first.hi.kind)} has to come after the ${name(first.lo.kind)}, but here it stands in front of it. Requests travel left to right, so they get stuck at the wrong one.`,
  }
}

// `placed` says which parts exist (balancer as lb, servers as app-1…); `pad` says
// which real spot each one stands on.
function layout(raw: Placement) {
  const placed: Placement = {}
  const pad: Record<string, string> = {}
  const apps: string[] = []
  const replicas: string[] = []
  for (const [id, kind] of Object.entries(raw)) {
    if (kind === 'app') apps.push(id)
    else if (kind === 'replica') replicas.push(id)
    else if (CANON[kind]) {
      placed[CANON[kind]!] = kind
      pad[CANON[kind]!] = id
    }
  }
  apps.forEach((_id, i) => (placed[`app-${i + 1}`] = 'app'))
  replicas.forEach((_id, i) => (placed[`rep-${i}`] = 'replica'))
  return { placed, pad, apps: ['app-0', ...apps], replicas, jam: outOfOrder(raw) }
}
const decoyOn = (raw: Placement, kind: string) => Object.values(raw).includes(kind as never)

function assemble(raw: Placement, settings: Settings, profile: Profile, rng?: () => number) {
  const { placed, pad, apps, replicas, jam } = layout(raw)
  const { scheme, cacheSize, limit, scope } = chosen(settings)
  const s = new Shortener(rng ?? seeded(7), {
    keys: { lb: pad.lb, gate: pad.gate, cache: pad.cache, queue: pad.queue },
    jam: jam?.ids,
    apps,
    balancer: !!placed.lb,
    gate: placed.gate ? { limit, scope } : undefined,
    cacheSize: placed.cache ? cacheSize : undefined,
    replicas,
    queue: !!placed.queue,
    scheme,
    profile,
  })
  shortenerOf.set(s.flow, s)
  return s.flow
}

// The checks a finished design must pass. Shown live; the win needs all green.
const noDupes: Requirement = {
  label: 'Codes',
  says: 'Every short link gets its own code. Two different links must never share one.',
  read: (flow) => {
    const d = shortenerOf.get(flow)?.tally.dupes ?? 0
    return { text: d === 0 ? 'all unique' : `${d} repeated`, ok: d === 0 }
  },
}
// The first design is about two servers sharing the work. Without them there is
// nothing to test, so the run stops at once and says what is missing.
const twoServers: Requirement = {
  label: 'Servers',
  says: 'Run on two app servers.',
  read: (flow) => {
    const cfg = shortenerOf.get(flow)?.cfg
    const ok = !!cfg?.balancer && (cfg?.apps.length ?? 0) >= 2
    return { text: ok ? 'sharing' : 'one serving', ok }
  },
}
const redirectsWork = (limit: number): Requirement => ({
  label: 'Redirects',
  says: `Visitors must land on the long link. No more than ${limit} redirects may be lost or take over 2 seconds.`,
  read: (flow) => {
    const f = shortenerOf.get(flow)?.redirectsFailed() ?? 0
    return { text: `${f} lost`, ok: f <= limit }
  },
})
const redirectsFast: Requirement = {
  label: 'Speed',
  says: 'A redirect should feel instant: under 1.6 seconds on average.',
  read: (_flow, m) => {
    const ms = m.latency.users ?? 0
    return { text: `${(ms / 1000).toFixed(1)}s`, ok: ms < 1600 }
  },
}
const newLinks: Requirement = {
  label: 'New links',
  says: 'People must keep being able to make short links. No more than 2 may fail.',
  read: (flow) => {
    const f = shortenerOf.get(flow)?.makersFailed() ?? 0
    return { text: `${f} lost`, ok: f <= 2 }
  },
}
const clicksKept: Requirement = {
  label: 'Clicks',
  says: 'Every redirect counts as a click for the link owner. No more than 20 clicks may be lost.',
  read: (flow) => {
    const f = shortenerOf.get(flow)?.clicksLost() ?? 0
    return { text: `${f} lost`, ok: f <= 20 }
  },
}

const BRIEF = {
  title: 'The brief',
  lines: [
    'Long links are a pain. They break across lines in messages, eat the character limit in a post, and make a QR code too dense to scan. A short link fixes that, and it lets the owner count how many people clicked.',
    'Build a link shortener. Someone pastes a long link and gets a short one. Anyone opening the short link lands on the long one, fast.',
    'Plan for 1M new links a day, and about 100 redirects for every new link. Each redirect also counts a click.',
    'A redirect that takes over 2 seconds counts as lost.',
  ],
}

const FIXED = [
  { id: 'users', kind: 'users' as const, ...USERS_AT },
  { id: 'makers', kind: 'users' as const, ...MAKERS_AT },
  { id: 'bot', kind: 'users' as const, ...BOT_AT },
  { id: 'app-0', kind: 'app' as const, x: APP_X, z: 0 },
  { id: 'db', kind: 'database' as const, ...DB_AT },
]
const LABELS = [
  { at: [USERS_AT.x, 1.6, USERS_AT.z] as [number, number, number], text: 'Visitors' },
  { at: [MAKERS_AT.x, 1.6, MAKERS_AT.z] as [number, number, number], text: 'Link makers' },
  { at: [BOT_AT.x, 1.6, BOT_AT.z] as [number, number, number], text: 'Bot' },
]
const PIECE_HINTS: BuildTask['hints'] = {
  balancer: 'Spreads requests over the app servers',
  app: 'An app server: makes codes, looks links up',
  cache: 'Keeps the popular links in memory',
  queue: 'Holds clicks to be written later',
  replica: 'A read-only copy of the database',
  limiter: 'Turns away clients that ask too often',
  dedupe: 'Remembers what was sent, blocks repeats',
  dead: 'Parks messages that ran out of tries',
}

const SETTINGS = [
  { id: 'scheme', label: 'new codes', when: 'app' as const, min: 0, max: 2, step: 1, initial: 0, options: ['One shared counter', 'Own key range per server', 'Random hash, check first'] },
  { id: 'cache', label: 'holds', when: 'cache' as const, min: 0, max: CACHE_SIZES.length - 1, step: 1, initial: 0, options: CACHE_SIZES.map((n) => `${n} links`) },
  { id: 'scope', label: 'counts', when: 'limiter' as const, min: 0, max: 1, step: 1, initial: 0, options: ['All requests together', 'Creates, per client'] },
  { id: 'limit', label: 'limit', when: 'limiter' as const, min: 0, max: LIMITS.length - 1, step: 1, initial: 2, options: LIMITS.map((n) => `${n} / second`) },
]

function decorate(flow: FlowSim, raw: Placement) {
  const s = shortenerOf.get(flow)
  if (!s) return null
  const { placed, pad, jam } = layout(raw)
  const out = [createElement(Tag, { key: 'phase', at: [USERS_AT.x, 2.4, USERS_AT.z], label: phaseAt(flow.tick), danger: flow.tick >= T(38) && flow.tick < SCALE_SETTLED })]
  for (const id of jam?.ids ?? []) out.push(createElement(Tag, { key: `jam-${id}`, at: [POS[id].x, 1.8, POS[id].z], label: 'Stops here', danger: true }))
  if (placed.cache && !jam) out.push(createElement(Tag, { key: 'cache', at: [POS[pad.cache].x, 1.6, POS[pad.cache].z], label: `${Math.round(s.hitRate() * 100)}% from memory` }))
  return out
}

function common(): Pick<BuildTask, 'pinned' | 'manualStart' | 'rps' | 'shot' | 'fixed' | 'labels' | 'decorate' | 'hints' | 'failFast' | 'anywhere' | 'replies'> {
  return {
    pinned: BRIEF,
    manualStart: true,
    replies: (job) => job.from === 'users' || job.from === 'makers' || job.from === 'bot',
    rps: 4,
    shot: { target: [-1.4, 0.8, 0], zoom: 0.56 },
    fixed: FIXED,
    labels: LABELS,
    decorate,
    hints: PIECE_HINTS,
    failFast: true,
    anywhere: true,
  }
}

// Stage 2: a quiet service, and one new idea: handing out codes.
export const FIRST_DESIGN: BuildTask = {
  ...common(),
  title: 'First design: two servers, one code each.',
  sub: 'Add a second app server and a balancer, then choose how new codes are made.',
  goal: 'Run on two app servers and never hand out the same short code twice.',
  goalShort: 'Two servers · no repeated codes',
  win: 'Two servers can no longer clash: each makes codes from its own range, or checks before it uses one.',
  holdSeconds: 4,
  testSeconds: 30,
  pads: [
    { id: 'lb', ...LB_AT, accepts: ['balancer'] },
    ...APP_PADS.map((id, i) => ({ id, x: APP_X, z: APP_Z[i], accepts: ['app' as const] })),
  ],
  toolbox: [
    { kind: 'balancer', count: 1 },
    { kind: 'app', count: 2 },
  ],
  settings: [SETTINGS[0]],
  requirements: [twoServers, noDupes, redirectsWork(3), redirectsFast],
  assemble: (placed, settings, rng) => assemble(placed, settings, FIRST_PROFILE, rng),
  diagnose(m, raw, settings, flow) {
    const s = shortenerOf.get(flow)
    if (!s) return null
    const { placed, apps, jam } = layout(raw)
    if (jam) return { because: jam.why, look: ORDER_LOOK }
    const { scheme } = chosen(settings)
    if (s.tally.dupes > 0 && scheme === 'counter') return { because: 'Some links were given a code that was already in use.', look: 'Two servers can ask for a new code at nearly the same moment. What do they agree on?' }
    if (!placed.lb && apps.length > 1) return { because: 'All visitors land on the first server. The others get no traffic.', look: 'What sends each visitor to a server?' }
    if (apps.length < 2) return { because: 'Only one app server is running.' }
    if (!placed.lb) return { because: 'Visitors only reach one server.' }
    if (s.redirectsFailed() > 3) return redirectsCause(s)
    return slowWhy(s, m)
  },
  problem: (m, raw, settings, flow) => FIRST_DESIGN.diagnose!(m, raw, settings, flow)?.because ?? null,
  hint: (_m, raw, settings) => hintFromReview(review(raw, settings).lines, ['New codes', 'Front door'], false),
  check(_m, raw, _settings, flow) {
    const s = flow && shortenerOf.get(flow)
    const { placed, apps, jam } = layout(raw)
    if (!s || jam || !placed.lb || apps.length < 2) return false
    return flow.tick >= FIRST_SETTLED && s.tally.dupes === 0 && s.redirectsFailed() <= 3 && s.makersFailed() <= 2
  },
}

// Stage 3: the same board, growing load. Each phase breaks something new.
export const SCALE_UP: BuildTask = {
  ...common(),
  title: 'Where it breaks: grow it.',
  sub: 'The load grows in steps. Watch what turns red, then fix it. Changing anything restarts the run.',
  goal: 'Get through every step of growth with no lost redirects, no repeated codes and no lost new links.',
  goalShort: 'Survive every step of growth',
  win: 'Cache for the popular links, enough servers behind a balancer, clicks on a queue, and creates limited per client: every step of growth held.',
  holdSeconds: 4,
  testSeconds: 60,
  pads: [
    { id: 'gate', ...GATE_AT, accepts: ['limiter'] },
    { id: 'lb', ...LB_AT, accepts: ['balancer'] },
    ...APP_PADS.map((id, i) => ({ id, x: APP_X, z: APP_Z[i], accepts: ['app' as const] })),
    { id: 'cache', ...CACHE_AT, accepts: ['cache'] },
    { id: 'queue', ...QUEUE_AT, accepts: ['queue'] },
    ...REPLICA_PADS.map((id, i) => ({ id, x: DB_AT.x, z: REPLICA_Z[i], accepts: ['replica' as const] })),
    ...SPARE_AT.map((at, i) => ({ id: `spare-${i}`, ...at, accepts: ['dedupe' as const, 'dead' as const] })),
  ],
  toolbox: [
    { kind: 'limiter', count: 1 },
    { kind: 'balancer', count: 1 },
    { kind: 'app', count: 2 },
    { kind: 'cache', count: 1 },
    { kind: 'queue', count: 1 },
    { kind: 'replica', count: 2 },
    { kind: 'dedupe', count: 1 },
    { kind: 'dead', count: 1 },
  ],
  timeline: TIMELINE,
  settings: SETTINGS,
  watch: [{ kind: 'busy', key: 'db', label: 'Database busy' }],
  requirements: [redirectsWork(8), redirectsFast, noDupes, newLinks, clicksKept],
  assemble: (placed, settings, rng) => assemble(placed, settings, SCALE_PROFILE, rng),
  diagnose(m, raw, settings, flow) {
    const s = shortenerOf.get(flow)
    if (!s) return null
    const t = s.tally
    const tick = flow.tick
    const { placed, apps: appList, replicas, jam } = layout(raw)
    if (jam) return { because: jam.why, look: ORDER_LOOK }
    const { scope } = chosen(settings)
    const apps = appList.length
    const dbBusy = m.busy.db ?? 0
    const lostRedirects = 'Some redirects were lost.'
    const unhelpful = 'Which piece on the board is not helping this system?'

    if (t.dupes > 0) return { because: 'Some links were given a code that was already in use.', look: 'Two servers can ask for a new code at nearly the same moment. What do they agree on?' }
    if (placed.gate && scope === 'all' && (t.limited.users ?? 0) > 0) return { because: 'Visitors are being turned away. The limiter counts every request together, redirects too.', look: 'Which requests does the limiter count, and which of them are the problem?' }
    if (placed.gate && scope === 'creates' && (t.limited.makers ?? 0) > 2) return { because: 'Real link makers are being turned away by the limiter.', look: 'Compare the limit with how fast real people create links.' }
    if (s.redirectsFailed() > 8) {
      if (!placed.cache && tick >= T(6)) return { because: lostRedirects, look: 'How many lookups does each redirect cause, and how many can the database answer?' }
      if (placed.cache && s.hitRate() < 0.6 && tick >= T(10)) return { because: lostRedirects, look: 'How many links does the cache hold, compared with how many are asked for?' }
      if ((!placed.lb || apps < 2) && tick >= T(10)) return { because: lostRedirects, look: 'How many requests can one app server answer, and how many are arriving?' }
      if (!placed.queue && dbBusy > 0.8) return { because: lostRedirects, look: 'What does each redirect write before it answers?' }
      if (replicas.length === 0 && dbBusy > 0.8) return { because: lostRedirects, look: 'How many things read from and write to the one database?' }
      return redirectsCause(s)
    }
    if (tick >= T(38) && (s.makersFailed() > 2 || dbBusy > 0.9)) {
      if (!placed.gate) return { because: 'A bot is creating links in bulk, and real link makers are failing.', look: 'Every new link is a database write. What stands between the bot and the database?' }
      if (scope === 'creates' && chosen(settings).limit >= 8) return { because: 'The limiter still lets the bot through, and real link makers are failing.', look: 'Compare the limit with how fast real people create links.' }
    }
    if (!placed.queue && dbBusy > 0.9) return { because: 'The database is overloaded. Every redirect writes a click to it before it answers.', look: 'What does each redirect write before it answers?' }
    if (decoyOn(raw, 'dedupe')) return { because: 'The dedupe store does nothing here. Nothing in this design is ever sent twice.', look: unhelpful }
    if (decoyOn(raw, 'dead')) return { because: 'The dead-letter queue does nothing here. A click waits on the queue and is written later, so none is ever parked.', look: unhelpful }
    return slowWhy(s, m)
  },
  problem: (m, raw, settings, flow) => SCALE_UP.diagnose!(m, raw, settings, flow)?.because ?? null,
  hint: (_m, raw, settings) => hintFromReview(review(raw, settings).lines, undefined, false),
  check(_m, raw, _settings, flow) {
    const s = flow && shortenerOf.get(flow)
    if (!s || layout(raw).jam || flow.tick < SCALE_SETTLED) return false
    return s.redirectsFailed() <= 8 && s.tally.dupes === 0 && s.makersFailed() <= 2 && s.clicksLost() <= 20
  },
}

// What is actually failing, read from where redirects were turned away or kept waiting.
function redirectsCause(s: Shortener): Diagnosis {
  const lost = s.lostAt()
  const where = lost ? ` Some were turned away at ${lost.what} because its line was full.` : ''
  const slow = s.tally.slow > 0 ? ' Some took over 2 seconds.' : ''
  return { because: `Some redirects were lost.${where}${slow}`, look: 'Find the busiest part, and ask what is sending it more than it can answer.' }
}

// Redirects that work but are slow on average: the busiest part is where they wait.
function slowWhy(s: Shortener, m: { busy: Record<string, number>; latency: Record<string, number> }): Diagnosis | null {
  const ms = m.latency.users ?? 0
  if (ms < 1600) return null
  const [key] = Object.entries(m.busy).sort((a, b) => b[1] - a[1])[0] ?? []
  return { because: `Redirects are slow.${key ? ` ${s.nameOf(key)} is the busiest part.` : ''}`, look: 'Find the busiest part, and ask what could take work off it.' }
}

const has = (placed: Placement, id: string) => !!placed[id]

function review(raw: Placement, settings: Settings): Review {
  const { placed, apps: appList, replicas: replicaList } = layout(raw)
  const { scheme, scope } = chosen(settings)
  const apps = appList.length
  const replicas = replicaList.length
  return {
    lines: [
      { label: 'New codes', yours: ['One shared counter', 'Key range per server', 'Random hash'][SCHEMES.indexOf(scheme)], reference: 'Key range per server', why: 'No clash and no extra check. A hash also works, but about 1 in 8 needs a second write.', ok: scheme !== 'counter' },
      { label: 'Front door', yours: has(placed, 'lb') ? `Balancer, ${apps} app servers` : `${apps} app server`, reference: 'Balancer, 3 app servers', why: 'App servers keep no state, so you add more behind a balancer, or let an autoscaler do it.', ok: has(placed, 'lb') && apps >= 3 },
      { label: 'Reads', yours: has(placed, 'cache') ? 'Cache' : 'Straight to the database', reference: 'Cache for popular links', why: 'About 100 reads for every write, and a few links get most of them.', ok: has(placed, 'cache') },
      { label: 'Clicks', yours: has(placed, 'queue') ? 'Queue, written later' : 'Written before redirecting', reference: 'Queue, written later', why: 'A redirect should not wait for a click to be counted.', ok: has(placed, 'queue') },
      { label: 'Database', yours: replicas ? `${replicas} read replica${replicas > 1 ? 's' : ''}` : 'One database', reference: 'One primary, read replicas', why: 'Replicas share the reads that miss the cache. Writes stay on the primary.', ok: replicas > 0 },
      { label: 'Extras', yours: decoyOn(raw, 'dedupe') || decoyOn(raw, 'dead') ? 'A piece that does nothing here' : 'Only what is needed', reference: 'No dedupe store, no dead-letter queue', why: 'A code is made once and a click is just counted, so nothing is sent twice or parked. An extra piece is cost and one more thing to fail.', ok: !decoyOn(raw, 'dedupe') && !decoyOn(raw, 'dead') },
      { label: 'Abuse', yours: has(placed, 'gate') ? (scope === 'creates' ? 'Creates limited per client' : 'One count for all requests') : 'Nothing', reference: 'Creates limited per client', why: 'Limit the expensive action, per client. A global count turns away real visitors.', ok: has(placed, 'gate') && scope === 'creates' },
    ],
    tradeoffs: [
      '301 or 302? A 301 is cached by browsers, so fewer visits reach you, but you cannot count clicks. A 302 reaches you every time.',
      'Counting clicks on a queue means a crash can lose a few. Counting in the redirect never loses one, but slows every redirect.',
      'A cache can show a link that has since been deleted or changed, until it expires. Short links rarely change, so a long expiry is fine.',
    ],
    interview: [
      'Clarify: how many new links and redirects a day, how long are codes kept, do links expire, do we need click counts.',
      'Estimate: about 12 new links a second, about 1,200 redirects a second, around 1 TB over five years.',
      'Design: a code from a key range per server, a stateless app tier behind a balancer, a database keyed by code with read replicas, and a cache in front for hot links.',
      'Scale: cache first, then replicas, then shard by code. Clicks go on a queue. Rate limit creates per client.',
    ],
  }
}

// The opening: one link made, one link opened. Nothing to place yet.
const INTRO_PROFILE: Profile = () => ({ users: 0.8, makers: 0.4, bot: 0, hot: 0 })
const INTRO_FIXED = [
  { id: 'makers', kind: 'users' as const, x: -6.4, z: -2.4 },
  { id: 'users', kind: 'users' as const, x: -6.4, z: 2.4 },
  { id: 'app-0', kind: 'app' as const, x: -2.8, z: 0 },
  { id: 'db', kind: 'database' as const, x: 1.2, z: 0 },
]
export const INTRO: Intro = {
  task: {
    title: 'How a short link works',
    sub: '',
    goal: '',
    win: '',
    holdSeconds: 1,
    rps: 1,
    shot: { target: [-2.6, 0.8, 0], zoom: 0.9 },
    fixed: INTRO_FIXED,
    pads: [],
    toolbox: [],
    assemble: (_placed, _settings, rng) => {
      const s = new Shortener(rng ?? seeded(3), { apps: ['app-0'], balancer: false, replicas: [], queue: false, scheme: 'range', profile: INTRO_PROFILE })
      shortenerOf.set(s.flow, s)
      return s.flow
    },
    check: () => false,
  },
  steps: [
    { say: 'Someone has a very long link and wants a short one. They paste it into the shortener.', at: 'makers', label: 'Link maker' },
    { say: 'The app server picks a short code, like “x7Kq”, and tells the database: this code means that long link.', at: 'app-0', label: 'App server' },
    { say: 'The database keeps the pair, so the short link keeps working tomorrow.', at: 'db', label: 'Database' },
    { say: 'Later, a visitor opens the short link. The app looks the code up and sends them on to the long link.', at: 'users', label: 'Visitor' },
    { say: 'Easy for one link. Now picture a million new links a day, and a hundred visits for every one of them.' },
  ],
  start: 'Take the challenge →',
}

export const URL_SHORTENER: Capstone = {
  id: 'url-shortener',
  title: 'URL shortener',
  stages: ['Requirements', 'First design', 'Where it breaks', 'Final review'],
  intro: INTRO,
  goals: ['Redirects · under 2 s', 'Codes never repeat', 'Clicks counted', 'Keep bots out'],
  brief: BRIEF,
  estimate: {
    intro: 'Before drawing anything, work out how big this is. A few quick numbers decide the design.',
    summary: { title: 'About 12 new links and 1,200 redirects a second, around 1 TB.', body: 'Reads dominate, and the data fits on one machine. Those two facts shape everything next.' },
    questions: [
      { question: '1 million new links a day. About how many new links a second is that?', options: ['About 1', 'About 12', 'About 120'], answer: 1, at: 'makers', show: '12 new links / second', why: 'A day has about 86,000 seconds. 1,000,000 ÷ 86,000 is about 12.' },
      { question: 'There are about 100 redirects for every new link. About how many redirects a second?', options: ['About 120', 'About 1,200', 'About 12,000'], answer: 1, at: 'users', show: '1,200 redirects / second', why: '12 new links a second × 100 is about 1,200 redirects a second. Reading dominates.' },
      { question: 'Keep every link for 5 years, about 500 bytes each. About how much storage is that?', options: ['About 1 GB', 'About 1 TB', 'About 1 PB'], answer: 1, at: 'db', show: 'About 1 TB', why: '1M a day × 365 × 5 is about 1.8 billion links. At 500 bytes each that is close to 1 TB: one big database, not a fleet.' },
    ],
  },
  first: FIRST_DESIGN,
  scale: SCALE_UP,
  review,
}
