import { createElement } from 'react'
import { ORDER_LOOK, hintFromReview } from '../../core/build/hint'
import { Tag } from '../../core/iso/primitives'
import type { BuildTask, Diagnosis, Placement, Requirement, Settings } from '../../core/build/types'
import type { FlowSim } from '../../core/flow/engine'
import type { Capstone, Intro, Review } from '../../core/capstone/types'
import { jitter, seeded } from '../../core/build/day'
import { FOLLOWED, FOLLOWERS, HYDRATE, KINDS, LENGTH, READERS, REAL_FOLLOWERS, RETRY_NEVER, RETRY_NOW, SCROLL_AT, SECOND, spoken, Timeline, type Limit, type Phase } from './timeline'

// The design board: writers and readers on the left, a lane for each. The learner
// places every machine: servers on the readers' side (below the middle line), fan-out
// workers on the writers' side (above it), and the tweet store's shards on the right.
// Timelines live in the cache, so both lanes meet there.
const WRITERS_AT = { x: -8.8, z: -4.4 }
const READERS_AT = { x: -8.8, z: 4.4 }
const STORE_AT = { x: 4.4, z: 0 }
// Stage 3 has exactly as many pads as the reference design has pieces (a queue, two caches,
// one timeline server, three workers, four shards), and more pieces in the toolbox than that.
const POS: Record<string, { x: number; z: number }> = {
  a0: { x: -5.2, z: -4.4 },
  a1: { x: -5.2, z: 4.4 },
  a2: { x: -5.2, z: -2.2 },
  w1: { x: -1.6, z: -4.4 },
  w2: { x: 1.4, z: -4.4 },
  w3: { x: -1.6, z: -2.2 },
  r1: { x: -1.6, z: 4.4 },
  s1: { x: 4.4, z: -4.4 },
  s4: { x: 4.4, z: -2.2 },
  s2: { x: 4.4, z: 0 },
  s3: { x: 4.4, z: 2.2 },
}
const FIRST_SPOTS = ['a0', 'a1', 'w1', 'r1', 's2']
const ALL_SPOTS = Object.keys(POS)
const spot = (id: string) => ({ id, ...POS[id], accepts: [] })

// The first design: ordinary accounts, a busy hour. Then the real day: a rush,
// edits and deletes, a goal and a celebrity, and a cache machine that restarts empty.
const T = (s: number) => s * SECOND
const FIRST_PHASES: Phase[] = [{ from: 0, opens: 14, posts: 3 }]
export const FIRST_SETTLED = T(30)
const SCALE_PHASES: Phase[] = [
  { from: 0, opens: 10, posts: 2, mids: 0.5 },
  { from: T(8), opens: 40, posts: 8, mids: 0.5 },
  { from: T(18), opens: 40, posts: 8, mids: 0.5, deletes: 4 },
  { from: T(30), opens: 66, posts: 10, mids: 0.5, deletes: 5 },
  { from: T(46), opens: 40, posts: 8, mids: 0.5, deletes: 4 },
]
const STARS = [T(30), T(46)]
const COLD_AT = T(40)
export const SCALE_SETTLED = T(64)

// Every run is a slightly different day: busier by up to a fifth (the opens and the
// tweets each on their own), and the celebrity and the restart a few seconds later.
// Each stays inside its own part of the day, so the strip above the board still reads true.
function scaleDay(rng: () => number): Mode {
  const opens = jitter(rng, 1, 0.2)
  const posts = jitter(rng, 1, 0.2)
  const star = Math.floor(jitter(rng, 0, 3) * SECOND)
  const cold = Math.floor(jitter(rng, 0, 3) * SECOND)
  const by = (n: number | undefined, k: number) => (n === undefined ? undefined : n * k)
  return {
    phases: SCALE_PHASES.map((p, i) => (i === 0 ? p : { ...p, opens: p.opens * opens, posts: p.posts * posts, mids: by(p.mids, posts), deletes: by(p.deletes, posts) })),
    stars: STARS.map((t) => t + star),
    coldAt: COLD_AT + cold,
  }
}

// The busiest stretch of the day, before the jitter: what the learner works the numbers out from.
const PEAK = SCALE_PHASES[3]
const WRITES_A_SECOND = 120 // what one fan-out worker writes: 6 a tick, 20 ticks a second
const LOOKUPS_A_SECOND = 120 // what one store shard answers
const CACHE_OPS_A_SECOND = 240 // what one cache handles, opens and writes together
const SERVER_OPS_A_SECOND = 160 // what one timeline server builds
const LENGTH_FROM = SCROLL_AT // below this, scrolling reaches the store
const LENGTH_TO = 1200 // above this, a rebuild after a restart costs too much
// What the reference design must carry, worked out the way the learner should.
const COPIES = PEAK.posts * FOLLOWERS.small + (PEAK.mids ?? 0) * FOLLOWERS.mid // timeline writes a second when only the celebrity is looked up
const NEED_WORKERS = Math.ceil(COPIES / WRITES_A_SECOND)
const OPEN_READS = FOLLOWED.star + HYDRATE // store reads for one open: the celebrity, and the tweets the ids point to
const NEED_SHARDS = Math.ceil((PEAK.opens * OPEN_READS) / LOOKUPS_A_SECOND) + 1 // and a spare for the rebuild after a restart
const NEED_CACHES = Math.ceil((PEAK.opens + COPIES) / CACHE_OPS_A_SECOND)
const LINE_FROM = REAL_FOLLOWERS.mid // the line must sit at or above the mid accounts and below the celebrity
const LINE_TO = REAL_FOLLOWERS.star - 1
const WAIT_LIMIT = 0.8 // seconds a reader may wait for a timeline
const FRESH_LIMIT = 3 // seconds a tweet may take to reach every follower
const GONE_LIMIT = 3 // seconds a deleted tweet may stay in a timeline
const FAIL_LIMIT = 3 // readers given up on in all
const READ_CAP = 30 // opens a second a rate limiter on the readers' side lets through
const WRITE_CAP = 6 // tweets a second one on the writers' side lets through

const TIMELINE: NonNullable<BuildTask['timeline']> = {
  phases: [
    { name: 'A calm morning', from: 0 },
    { name: 'The rush', from: T(8) },
    { name: 'Edit and delete ships', from: T(18) },
    { name: 'A goal: the celebrity tweets', from: T(30) },
    { name: 'A cache machine restarts', from: T(40) },
    { name: 'Another tweet', from: T(46) },
  ],
  end: SCALE_SETTLED,
}

export const timelineOf = new WeakMap<FlowSim, Timeline>()

// Requests travel left to right. A cache or a queue that stands level with or
// right of the server it should come before has nothing to work with.
function outOfOrder(raw: Placement) {
  const apps = Object.entries(raw).filter(([, k]) => k === 'app').map(([id]) => id)
  const servers = apps.filter((id) => POS[id].z > 0)
  const workers = apps.filter((id) => POS[id].z < 0)
  const bad = Object.entries(raw).flatMap(([id, kind]) => {
    if (kind === 'cache' && servers.some((sv) => POS[sv].x <= POS[id].x)) return [{ id, why: 'The cache has to stand in front of the timeline server, so that most opens are answered before they reach it. Here it does not.' }]
    if (kind === 'queue' && workers.some((w) => POS[w].x <= POS[id].x)) return [{ id, why: 'The queue has to stand in front of the fan-out workers, to hold tweets for them. Here it does not.' }]
    return []
  })
  return bad.length ? { ids: bad.map((b) => b.id), why: bad[0].why } : null
}

// Which parts are on the floor, and where. A piece can go on any spot, so what it does comes from its kind.
function layout(saved: Placement) {
  // A build saved on an older board may name pads that are gone: they hold nothing now.
  const raw: Placement = Object.fromEntries(Object.entries(saved).filter(([id]) => id in POS))
  const on = (kind: string) => Object.entries(raw).find(([, k]) => k === kind)?.[0]
  const all = (kind: string) => Object.entries(raw).filter(([, k]) => k === kind).map(([id]) => id)
  return {
    queue: on('queue'),
    caches: all('cache'),
    // An app on the readers' side builds timelines when they open. One on the writers' side writes tweets into them.
    servers: all('app').filter((id) => POS[id].z > 0),
    workers: all('app').filter((id) => POS[id].z < 0),
    shards: all('database'),
    // A rate limiter guards the lane it stands in: readers' below the middle line, writers' above it.
    limits: Object.entries(raw)
      .filter(([, k]) => k === 'limiter')
      .map(([id]): Limit => (POS[id].z > 0 ? { key: id, lane: 'read', rate: READ_CAP } : { key: id, lane: 'write', rate: WRITE_CAP })),
    extras: Object.values(raw).filter((k) => k === 'breaker' || k === 'ring').length,
    jam: outOfOrder(raw),
  }
}

// What a bare board is missing before anything can be served at all.
function missing(l: ReturnType<typeof layout>): Diagnosis | null {
  const look = 'Every lane of the system needs a machine. Which lane has none?'
  if (!l.servers.length) return { because: 'Nothing builds a timeline when a reader opens the app. The readers’ side has no machine.', look }
  if (!l.workers.length) return { because: 'Nothing writes a tweet into a timeline. The writers’ side has no machine.', look }
  if (!l.shards.length) return { because: 'The tweets are kept nowhere. The tweet store has no shard.', look }
  return null
}

export const HOLDS_NAMES = ['A full copy of each tweet', 'Only the id of each tweet']
export const REBUILD_NAMES = ['Every open rebuilds', 'One rebuild per reader, the rest wait']
// The look-up line is a choice among real follower counts; the setting holds the position in this list.
export const LINE_AT = [100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000]
export const LINE_NAMES = LINE_AT.map(spoken)
export const LINE_START = LINE_AT.length - 1 // above every account: all are written into timelines
export const LENGTH_START = 1400
export function chosen(settings: Settings) {
  // The first design has only small accounts, so its choice is just write or look up.
  // Later, accounts with more followers than the line are looked up; the cutoff counts the sizes that are.
  const line = LINE_AT[Math.min(Math.max(settings.line ?? LINE_START, 0), LINE_START)]
  const cutoff = settings.when !== undefined ? (settings.when === 1 ? 3 : 0) : KINDS.filter((k) => REAL_FOLLOWERS[k] > line).length
  return {
    line,
    cutoff,
    length: settings.length ?? LENGTH_START,
    thin: (settings.holds ?? 0) === 1,
    collapse: (settings.rebuild ?? 0) === 1,
    retry: RETRY_NOW, // readers try again at once, as apps do
  }
}

interface Mode {
  phases: Phase[]
  stars: number[]
  coldAt?: number
}

function assemble(raw: Placement, settings: Settings, mode: Mode, rng?: () => number) {
  const l = layout(raw)
  const s = chosen(settings)
  const tl = new Timeline(rng ?? seeded(7), {
    ...s,
    queue: !!l.queue,
    caches: l.caches,
    servers: l.servers,
    workers: l.workers,
    shards: l.shards,
    phases: mode.phases,
    stars: mode.stars,
    limits: l.limits,
    coldAt: mode.coldAt,
    jam: l.jam?.ids,
    keys: { queue: l.queue ?? 'queue' },
  })
  timelineOf.set(tl.flow, tl)
  return tl.flow
}

// The checks a finished design must pass. Shown live; the win needs all green.
const opens = (deadline: number): Requirement => ({
  label: 'Timelines',
  says: `Every reader gets a timeline, in under ${WAIT_LIMIT} seconds. No more than ${FAIL_LIMIT} readers given up on in all.`,
  read: (flow) => {
    const f = timelineOf.get(flow)
    if (!f) return { text: '', ok: true }
    const slow = flow.tick >= T(4) && f.wait() > WAIT_LIMIT
    const text = f.tally.failed > 0 ? `${f.tally.failed} given up on` : `${f.wait().toFixed(2)} s`
    return { text, ok: f.tally.failed <= FAIL_LIMIT && !slow && (flow.tick < deadline || f.tally.opened > 0) }
  },
})
const tweets: Requirement = {
  label: 'Tweets',
  says: 'No tweet may be lost on its way to the followers.',
  read: (flow) => {
    const n = timelineOf.get(flow)?.tally.lost ?? 0
    return { text: n === 0 ? 'none lost' : `${n} lost`, ok: n === 0 }
  },
}
const fresh: Requirement = {
  label: 'Fresh',
  says: `A tweet must reach every follower within ${FRESH_LIMIT} seconds, a celebrity’s as well.`,
  read: (flow) => {
    const f = timelineOf.get(flow)
    if (!f) return { text: '', ok: true }
    const slowest = Math.max(f.slowest(), f.slowest('star'))
    return { text: `${slowest.toFixed(1)} s`, ok: slowest <= FRESH_LIMIT }
  },
}
const gone: Requirement = {
  label: 'Gone',
  says: `A deleted or edited tweet must be gone from every timeline within ${GONE_LIMIT} seconds. None may stay.`,
  read: (flow) => {
    const f = timelineOf.get(flow)
    if (!f) return { text: '', ok: true }
    if (f.tally.delLost > 0) return { text: `${f.tally.delLost} still showing`, ok: false }
    const slowest = f.slowest('delete')
    return { text: f.tally.deleted === 0 ? 'none yet' : `${slowest.toFixed(1)} s`, ok: slowest <= GONE_LIMIT }
  },
}

const BRIEF = {
  title: 'The brief',
  lines: [
    'The Twitter timeline is the first thing you see when you open the app: the newest tweets of everyone you follow, already there.',
    'Build it. Millions of people tweet all day, and every open must show a timeline at once.',
    'Plan for 300 million people who open the app 10 times a day, and 500 million tweets a day. People follow about 200 accounts, and a few accounts are followed by tens of millions.',
    'Tweets can be edited or deleted after they are sent. A deleted tweet must not stay on anyone’s screen.',
  ],
}

// Stage 3 adds the numbers on the board itself: what the day asks of the machines, in the units they are rated in.
const SCALE_BRIEF = {
  title: BRIEF.title,
  lines: [
    ...BRIEF.lines,
    `On this board, at the busiest: about ${PEAK.opens} opens a second, ${PEAK.posts} tweets a second from ordinary accounts (about ${spoken(REAL_FOLLOWERS.small)} followers each) and ${PEAK.mids} from bigger ones (about ${spoken(REAL_FOLLOWERS.mid)}). A celebrity has about ${spoken(REAL_FOLLOWERS.star)} followers. Each follower is one write into a timeline, and looking an account up is one read of the store. The board runs all of this scaled down, so the loads and machine counts below are board numbers. Some days are busier.`,
  ],
}

const FIXED = [
  { id: 'writers', kind: 'users' as const, ...WRITERS_AT },
  { id: 'readers', kind: 'users' as const, ...READERS_AT },
]
const LABELS = [
  { at: [WRITERS_AT.x, 1.6, WRITERS_AT.z] as [number, number, number], text: 'Writers' },
  { at: [READERS_AT.x, 1.6, READERS_AT.z] as [number, number, number], text: 'Readers' },
]
const NAMES: BuildTask['names'] = { queue: 'Tweet queue', cache: 'Timeline cache', database: 'Store shard' }
const PIECE_HINTS: BuildTask['hints'] = {
  queue: 'holds up to 400 tweets until a worker is free',
  cache: `holds the timelines of some readers · handles about ${CACHE_OPS_A_SECOND} operations a second, opens and writes together`,
  app: `writers’ side: writes about ${WRITES_A_SECOND} copies of tweets into timelines a second · readers’ side: builds about ${SERVER_OPS_A_SECOND} timelines a second`,
  database: `one piece of the tweet store · answers about ${LOOKUPS_A_SECOND} lookups a second`,
  limiter: 'lets only so many requests a second through',
  breaker: 'stops calling a service that keeps failing',
  ring: 'gives each key to one machine',
}

// Stage 2 has only small accounts, so the choice is just when the work is done.
const WHEN = { id: 'when', label: 'a timeline is made', when: 'app' as const, min: 0, max: 1, step: 1, initial: 0, options: ['When a tweet is sent', 'When a timeline opens'],
  tradeoffs: [
    { gain: 'A timeline opens at once: it is already made.', cost: 'Every tweet is copied to every follower.' },
    { gain: 'A tweet is one write.', cost: 'Every open gathers tweets from everyone followed.' },
  ],
}

const SETTINGS = [
  { id: 'line', label: 'Look up an account with more followers than', when: 'app' as const, min: 0, max: LINE_START, step: 1, initial: LINE_START, options: LINE_NAMES,
    tradeoffs: [
      { gain: 'Almost no copies are written.', cost: 'Almost every open gathers tweets from many accounts.' },
      { gain: 'Few copies are written.', cost: 'Opens gather tweets from most accounts followed.' },
      { gain: 'Copies only for small accounts.', cost: 'Opens look up every mid-size account followed.' },
      { gain: 'Only large accounts are looked up.', cost: 'Accounts just under 100,000 still copy to every follower.' },
      { gain: 'Only the biggest accounts are looked up.', cost: 'Accounts just under 1 million still copy to every follower.' },
      { gain: 'Opens rarely gather anything.', cost: 'An account just under 10 million copies each tweet millions of times.' },
      { gain: 'Every timeline is ready ahead.', cost: 'The biggest accounts copy each tweet to every follower.' },
    ],
  },
  { id: 'length', label: 'A timeline keeps the newest', when: 'app' as const, min: 200, max: 2000, step: 50, initial: LENGTH_START, slider: { unit: 'tweets' } },
  { id: 'holds', label: 'a timeline holds', when: 'app' as const, min: 0, max: 1, step: 1, initial: 0, options: HOLDS_NAMES,
    tradeoffs: [
      { gain: 'A timeline reads in one go.', cost: 'The whole tweet is stored again in every timeline.' },
      { gain: 'Small timelines, and one stored copy of each tweet.', cost: 'An open must fetch each tweet by its id.' },
    ],
  },
  { id: 'rebuild', label: 'a lost timeline is rebuilt', when: 'app' as const, min: 0, max: 1, step: 1, initial: 0, options: REBUILD_NAMES,
    tradeoffs: [
      { gain: 'Nothing to coordinate.', cost: 'Many opens at once rebuild the same timeline many times.' },
      { gain: 'One rebuild, however many opens.', cost: 'The others wait for it to finish.' },
    ],
  },
]

const WATCH = {
  kind: 'note' as const,
  label: 'Timeline server busy',
  read: (flow: FlowSim) => {
    const load = timelineOf.get(flow)?.serverLoad() ?? 0
    return { text: `${Math.round(load * 100)}%`, bad: load > 0.75 }
  },
}

function decorate(flow: FlowSim, raw: Placement) {
  const f = timelineOf.get(flow)
  if (!f) return null
  const l = layout(raw)
  const out = [createElement(Tag, { key: 'phase', at: [WRITERS_AT.x, 2.4, WRITERS_AT.z], label: f.cfg.stars.length ? (TIMELINE.phases.filter((p) => p.from <= flow.tick).pop()?.name ?? '') : 'A busy hour' })]
  for (const id of l.jam?.ids ?? []) out.push(createElement(Tag, { key: `jam-${id}`, at: [POS[id].x, 1.8, POS[id].z], label: 'Stops here', danger: true }))
  const load = f.storeLoad()
  if (l.shards.length) out.push(createElement(Tag, { key: 'store', at: [STORE_AT.x, 3.0, STORE_AT.z], label: `Store ${Math.round(load * 100)}% full`, danger: load > 0.75 }))
  const backlog = f.backlog()
  if (backlog > 0) out.push(createElement(Tag, { key: 'backlog', at: [WRITERS_AT.x, 3.2, WRITERS_AT.z], label: `${backlog} copies waiting`, danger: backlog > 60 }))
  for (const id of l.caches) {
    if (l.jam?.ids.includes(id)) continue
    const c = f.caches.find((x) => x.key === id)
    out.push(createElement(Tag, { key: `cache-${id}`, at: [POS[id].x, 1.6, POS[id].z], label: `${c?.warm.size ?? 0} of ${READERS} timelines`, danger: (c?.warm.size ?? READERS) < READERS / 2 }))
  }
  return out
}

function common(): Pick<BuildTask, 'pinned' | 'manualStart' | 'rps' | 'shot' | 'fixed' | 'labels' | 'decorate' | 'hints' | 'names' | 'failFast' | 'anywhere' | 'replies'> {
  return {
    pinned: BRIEF,
    manualStart: true,
    replies: (job) => job.from === 'open',
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
function symptom(f: Timeline): Diagnosis | null {
  const t = f.tally
  const limited = t.limited ? ' Some were turned away by a rate limiter.' : ''
  if (t.failed > FAIL_LIMIT) return { because: `Readers gave up on opening the app.${limited}`, look: 'Which part fills up when timelines open, and where does it get what it shows?' }
  if (t.lost > 0) return { because: `Some tweets were lost.${limited}`, look: 'Where does a tweet wait when the machine writing it is busy?' }
  if (t.delLost > 0) return { because: 'Deleted tweets are still showing.', look: 'How many places hold a copy of a tweet, and what reaches each of them when it is deleted?' }
  const slow = Math.max(f.slowest(), f.slowest('star'))
  if (slow > FRESH_LIMIT) return { because: 'A tweet took too long to reach its followers.', look: 'How many timelines must be written for one tweet, and who writes them?' }
  const del = f.slowest('delete')
  if (del > GONE_LIMIT) return { because: 'A deleted tweet stayed in timelines too long.', look: 'How many places hold a copy of a tweet, and what reaches each of them when it is deleted?' }
  if (f.wait() > WAIT_LIMIT) return { because: 'Opening the app is slow.', look: 'What work happens each time a timeline opens?' }
  return null
}

// Stage 2: ordinary accounts, and the new idea: the timeline is built when a tweet is sent.
export const FIRST_DESIGN: BuildTask = {
  ...common(),
  title: 'First design: a busy hour.',
  sub: 'Decide when a timeline is made, and add what helps. Changing anything restarts the run.',
  goal: 'Give every reader a timeline in under a second, and get every tweet to its followers within 3 seconds.',
  goalShort: 'Fast timelines · fresh tweets',
  win: 'Put a timeline server on the readers’ side, a worker on the writers’ side and a store shard. Write each tweet into its followers’ timelines when it is sent, so opening the app is one lookup. A queue holds tweets in a burst, and a cache holds the timelines.',
  lesson: {
    without: `Without it, every open looks up all ${FOLLOWED.small} accounts a reader follows, and the store drowns.`,
    choice: 'Write each tweet into its followers’ timelines when it is sent, so an open is one lookup.',
    cost: 'The price: one write per follower, and the last follower gets it a moment late.',
  },
  holdSeconds: 4,
  testSeconds: 36,
  pads: FIRST_SPOTS.map(spot),
  toolbox: [
    { kind: 'queue', count: 1 },
    { kind: 'cache', count: 1 },
    { kind: 'app', count: 2 },
    { kind: 'database', count: 1 },
  ],
  settings: [WHEN],
  watch: [WATCH],
  result: (_m, _raw, _settings, flow) => {
    const f = timelineOf.get(flow)
    if (!f) return null
    const t = f.tally
    return `${t.opened.toLocaleString()} timelines opened in ${f.wait().toFixed(1)} s. ${t.delivered.toLocaleString()} tweets delivered, the slowest in ${f.worst.tweet.toFixed(1)} s.`
  },
  requirements: [opens(FIRST_SETTLED), tweets, fresh],
  assemble: (placed, settings, rng) => assemble(placed, settings, { phases: FIRST_PHASES, stars: [] }, rng),
  diagnose(_m, raw, _settings, flow) {
    const f = timelineOf.get(flow)
    if (!f) return null
    const l = layout(raw)
    return missing(l) ?? (l.jam ? { because: l.jam.why, look: ORDER_LOOK } : null) ?? symptom(f)
  },
  problem: (m, raw, settings, flow) => FIRST_DESIGN.diagnose!(m, raw, settings, flow)?.because ?? null,
  hint: (_m, raw, settings) => hintFromReview(review(raw, settings).lines, ['Timeline server', 'Workers', 'Store'], false),
  check(_m, _raw, _settings, flow) {
    const f = flow && timelineOf.get(flow)
    if (!f || flow.tick < FIRST_SETTLED) return false
    return f.tally.failed <= FAIL_LIMIT && f.tally.lost === 0 && f.wait() <= WAIT_LIMIT && f.slowest() <= FRESH_LIMIT && f.tally.opened > 0
  },
}

// After a few failed runs: the cause, with the numbers to check it against. It names the weakest link first.
function whyHint(raw: Placement, settings: Settings): string | null {
  const l = layout(raw)
  const s = chosen(settings)
  const wide = (n: number) => n.toLocaleString()
  if (s.cutoff === 0) return `A celebrity tweet is about ${spoken(REAL_FOLLOWERS.star)} writes in one go, more than the workers can send in time.`
  if (s.cutoff >= 2) return `Looking up bigger accounts adds ${FOLLOWED.mid} reads of the store to every open. At ${PEAK.opens} opens a second that is far more than the store answers.`
  if (!s.thin) return 'A timeline that holds full copies means a delete must find and rewrite every copy.'
  if (s.length < LENGTH_FROM) return `A reader scrolls about ${LENGTH_FROM} tweets deep. A timeline of ${s.length} runs out first, and every scroll past it is another read of the store.`
  if (s.length > LENGTH_TO) return `After a restart each lost timeline is rebuilt from the store, and a timeline of ${wide(s.length)} tweets costs ${wide(Math.round((s.length / LENGTH) * 12))} reads to rebuild.`
  if (!l.queue) return 'Tweets arrive in bursts. With nothing to hold them, a worker that is busy turns the next one away.'
  if (l.workers.length < NEED_WORKERS) return `On this board, at the peak the tweets need about ${COPIES} writes a second (${PEAK.posts} × ${FOLLOWERS.small} + ${PEAK.mids} × ${FOLLOWERS.mid}). A worker writes ${WRITES_A_SECOND}.`
  if (l.caches.length < NEED_CACHES) return `Opens and timeline writes share the caches: about ${PEAK.opens + COPIES} operations a second at the peak, ${CACHE_OPS_A_SECOND} per cache. And one cache holds every timeline a restart can empty.`
  if (l.shards.length < NEED_SHARDS) return `Each open reads the store ${OPEN_READS} times (the celebrity, and the tweets the ids point to). ${PEAK.opens} opens a second is ${PEAK.opens * OPEN_READS} reads, and a shard answers ${LOOKUPS_A_SECOND}. After a restart, rebuilding the lost timelines needs room on top.`
  if (!s.collapse) return 'After the restart, every open for a lost timeline rebuilds it, and the same reads hit the store again and again.'
  if (l.limits.length) return 'A rate limiter turns away real readers and real tweets. Nothing here is an attack to stop.'
  if (!l.servers.length) return null
  return null
}

// Stage 3: the real day. The requirements change halfway, and a failure feeds the next.
export const SCALE_UP: BuildTask = {
  ...common(),
  pinned: SCALE_BRIEF,
  title: 'Where it breaks: edits, a goal, a restart.',
  sub: 'Edit and delete ship halfway through. Then a goal, a celebrity, and a cache machine that restarts empty. Every run is a slightly different day. Work out what each lane needs, then build it.',
  goal: 'Get through the whole day: nobody given up on, no tweet lost, every tweet fresh, every delete gone.',
  goalShort: 'Survive the whole day',
  win: `Fill the ${Object.keys(POS).length} pads with a queue, ${NEED_CACHES} caches, a timeline server, ${NEED_WORKERS} workers and ${NEED_SHARDS} shards. Look up only the celebrity (a line between ${spoken(LINE_FROM)} and ${spoken(LINE_TO)} followers), keep only ids in the timelines of about ${LENGTH} tweets, spread them over ${NEED_CACHES} caches, and rebuild each lost timeline once, however many readers ask.`,
  lesson: {
    without: `Without a look-up line, one celebrity tweet is ${spoken(REAL_FOLLOWERS.star)} writes at once. Without ids, a delete rewrites every copy.`,
    choice: 'Write ordinary accounts, look the celebrity up on open, and keep only ids in timelines.',
    cost: 'The price: each open merges two sources and reads the store once more.',
  },
  holdSeconds: 4,
  testSeconds: 68,
  pads: ALL_SPOTS.map(spot),
  toolbox: [
    { kind: 'queue', count: 1 },
    { kind: 'cache', count: 4 },
    { kind: 'app', count: 8 },
    { kind: 'database', count: 5 },
    { kind: 'limiter', count: 1 },
    { kind: 'breaker', count: 1 },
    { kind: 'ring', count: 1 },
  ],
  timeline: TIMELINE,
  settings: SETTINGS,
  watch: [WATCH],
  freshDay: true,
  requirements: [opens(SCALE_SETTLED), tweets, fresh, gone],
  assemble: (placed, settings, rng) => {
    const r = rng ?? seeded(7)
    return assemble(placed, settings, scaleDay(r), r)
  },
  diagnose(_m, raw, _settings, flow) {
    const f = timelineOf.get(flow)
    if (!f) return null
    const l = layout(raw)
    return missing(l) ?? (l.jam ? { because: l.jam.why, look: ORDER_LOOK } : null) ?? symptom(f)
  },
  problem: (m, raw, settings, flow) => SCALE_UP.diagnose!(m, raw, settings, flow)?.because ?? null,
  hint: (_m, raw, settings) => whyHint(raw, settings),
  result: (_m, _raw, _settings, flow) => {
    const f = timelineOf.get(flow)
    if (!f) return null
    const t = f.tally
    const cached = t.opened ? Math.round((t.hits / t.opened) * 100) : 0
    return `${t.opened.toLocaleString()} timelines opened, ${cached}% from a cache. The celebrity’s tweet took ${f.worst.star.toFixed(1)} s, the slowest delete ${f.worst.delete.toFixed(1)} s, none lost.`
  },
  check(_m, _raw, _settings, flow) {
    const f = flow && timelineOf.get(flow)
    if (!f || flow.tick < SCALE_SETTLED) return false
    return (
      f.tally.failed <= FAIL_LIMIT &&
      f.tally.lost === 0 &&
      f.tally.delLost === 0 &&
      f.wait() <= WAIT_LIMIT &&
      f.slowest() <= FRESH_LIMIT &&
      f.slowest('star') <= FRESH_LIMIT &&
      f.slowest('delete') <= GONE_LIMIT
    )
  },
}

function review(raw: Placement, settings: Settings): Review {
  const l = layout(raw)
  const s = chosen(settings)
  return {
    lines: [
      { label: 'Look-up line', yours: `Accounts over ${spoken(s.line)} followers are looked up`, reference: `Accounts over a line between ${spoken(LINE_FROM)} and ${spoken(LINE_TO)} followers: only the celebrity`, why: 'Reads outnumber tweets by far, so write into timelines when a tweet is sent. But one tweet by a celebrity is millions of writes, so look that account up when the timeline opens. Mid accounts are cheap to write and costly to look up.', ok: s.cutoff === 1 },
      { label: 'Timeline length', yours: `${s.length.toLocaleString()} tweets`, reference: `${LENGTH_FROM} to ${LENGTH_TO} tweets (about ${LENGTH})`, why: 'A timeline is as long as a reader scrolls. Shorter, and scrolling runs out and reads the store. Longer, and every timeline a restart loses costs more reads to build again.', ok: s.length >= LENGTH_FROM && s.length <= LENGTH_TO },
      { label: 'Timelines hold', yours: HOLDS_NAMES[s.thin ? 1 : 0], reference: 'Only the id of each tweet', why: 'A copy of the tweet is in every follower’s timeline, so an edit or a delete must find and rewrite them all. With only ids, a delete is one write: the tweet itself. Each open then fetches the tweets it shows, which is a cost worth paying.', ok: s.thin },
      { label: 'Rebuilding', yours: REBUILD_NAMES[s.collapse ? 1 : 0], reference: 'One rebuild per reader, the rest wait', why: 'When a cache machine restarts empty, many opens arrive for the same lost timeline. If each rebuilds it, the store is asked the same thing again and again. One rebuild, shared, is enough.', ok: s.collapse },
      { label: 'Tweet queue', yours: l.queue ? 'A queue in front of the workers' : 'None', reference: 'A queue in front of the workers', why: 'Tweets arrive in bursts. A queue holds them while the workers catch up, so none is turned away.', ok: !!l.queue },
      { label: 'Timeline caches', yours: `${l.caches.length} cache${l.caches.length === 1 ? '' : 's'}`, reference: `${NEED_CACHES} caches`, why: `Timelines live in memory, so an open is fast. Tweets and opens share a cache’s slots: about ${PEAK.opens + COPIES} operations a second at the peak, ${CACHE_OPS_A_SECOND} per cache. A restart empties one, so more than one also halves what it loses.`, ok: l.caches.length >= NEED_CACHES },
      { label: 'Timeline server', yours: `${l.servers.length} on the readers’ side`, reference: '1 on the readers’ side', why: 'Something has to build a timeline when a reader opens the app, and merge in the celebrities. One server is enough here, because the cache answers most of the work.', ok: l.servers.length >= 1 },
      { label: 'Workers', yours: `${l.workers.length} fan-out worker${l.workers.length === 1 ? '' : 's'}`, reference: `${NEED_WORKERS} fan-out workers`, why: `On this board, at the peak, ${PEAK.posts} tweets × ${FOLLOWERS.small} followers plus ${PEAK.mids} × ${FOLLOWERS.mid} is about ${COPIES} writes a second. A worker writes ${WRITES_A_SECOND}.`, ok: l.workers.length >= NEED_WORKERS },
      { label: 'Store', yours: `${l.shards.length} shard${l.shards.length === 1 ? '' : 's'}`, reference: `${NEED_SHARDS} shards`, why: `Each open reads the store ${OPEN_READS} times, so ${PEAK.opens} opens a second is ${PEAK.opens * OPEN_READS} reads, and a shard answers ${LOOKUPS_A_SECOND}. The rebuild after a restart comes on top, so keep one shard spare.`, ok: l.shards.length >= NEED_SHARDS },
      { label: 'Extras', yours: l.limits.length + l.extras ? 'Pieces this system does not need' : 'Only what is needed', reference: 'No limiter, breaker or hash ring', why: 'A rate limiter turns real readers and tweets away. A breaker guards calls to a failing service, and nothing here calls one. A hash ring has nothing to do when the shards already spread by reader.', ok: l.limits.length + l.extras === 0 },
    ],
    tradeoffs: [
      'Ids make a delete cheap and a timeline small, but every open now fetches the tweets it shows. A full copy opens faster and costs a write per follower for every edit.',
      'Timelines in memory are fast and can be lost. The store has them all, but rebuilding one means reading every account the reader follows.',
      'Two caches halve what a restart loses, and cost a second machine to run. Many small caches spread the loss thinner still.',
      'Where to draw the celebrity line is a choice. Too low and every open looks up many accounts. Too high and the writes for a big account bury the workers.',
    ],
    interview: [
      'Clarify: how many readers and tweets, how fresh a timeline must be, how it is ordered, whether tweets can be edited or deleted, whether there are celebrities.',
      'Estimate: 300 million readers opening 10 times a day is about 35,000 opens a second. 500 million tweets a day is about 5,800 a second, and 200 followers each is about 1.2 million timeline writes a second.',
      'Design: tweet service, queue, fan-out workers, timeline cache of ids sharded by reader, tweet store sharded by tweet id, timeline server that merges.',
      'Scale: write ids for normal accounts, look celebrities up when a timeline opens, fetch the tweets in batches, cache the tweets that are read most.',
      'Failures: a restarted cache is empty, so rebuild each timeline once, back off when the store is full, and rebuild only for readers who come back.',
    ],
  }
}

// The opening: a tiny timeline, from a tweet to a reader.
const INTRO_FIXED = [
  { id: 'writers', kind: 'users' as const, x: -8, z: -3 },
  { id: 'fan-0', kind: 'app' as const, x: -3, z: -3 },
  { id: 's0', kind: 'database' as const, x: 2.4, z: 0 },
  { id: 'feed', kind: 'app' as const, x: -3, z: 3 },
  { id: 'readers', kind: 'users' as const, x: -8, z: 3 },
]
export const INTRO: Intro = {
  task: {
    title: 'How a timeline works',
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
      const tl = new Timeline(rng ?? seeded(3), {
        cutoff: 0,
        thin: false,
        collapse: false,
        retry: RETRY_NEVER,
        queue: false,
        caches: [],
        servers: ['feed'],
        workers: ['fan-0'],
        shards: ['s0'],
        phases: [{ from: 0, opens: 2, posts: 1 }],
        stars: [],
        keys: { queue: 'queue' },
      })
      timelineOf.set(tl.flow, tl)
      return tl.flow
    },
    check: () => false,
  },
  steps: [
    { say: 'Someone you follow sends a tweet.', at: 'writers', label: 'A tweet' },
    { say: 'A worker writes the tweet into the timeline of everyone who follows its author. This is fan-out.', at: 'fan-0', label: 'Fan-out worker' },
    { say: 'The timelines are kept ready, one for each reader, holding the newest tweets.', at: 's0', label: 'Timelines' },
    { say: 'When you open the app, the timeline server reads your timeline and sends it back. One lookup.', at: 'feed', label: 'Timeline server' },
    { say: 'Your timeline is on screen. Easy for a few friends. Now picture 300 million readers, a celebrity, and a tweet that is deleted.' },
  ],
  start: 'Take the challenge →',
}

export const TWITTER_TIMELINE: Capstone = {
  id: 'twitter-timeline',
  title: 'Twitter timeline',
  stages: ['Requirements', 'First design', 'Where it breaks', 'Final review'],
  intro: INTRO,
  goals: ['Fast timelines', 'Fresh tweets', 'Deletes that stick', 'Survive a restart'],
  brief: BRIEF,
  estimate: {
    intro: 'Before drawing anything, work out how big this is. A few quick numbers decide the design.',
    summary: { title: 'About 35,000 opens a second, and 1.2 million writes to keep timelines fresh.', body: 'Timelines are written once, when a tweet is sent, and read many times. Holding only ids keeps them small enough for memory, and makes a delete one write instead of one per follower.' },
    questions: [
      { question: '300 million people open the app 10 times a day. About how many opens a second?', options: ['About 3,500', 'About 35,000', 'About 350,000'], answer: 1, at: 'readers', show: '35,000 opens / second', why: '3 billion opens a day ÷ 86,400 seconds is about 35,000.' },
      { question: '500 million tweets a day. About how many tweets a second?', options: ['About 580', 'About 5,800', 'About 58,000'], answer: 1, at: 'writers', show: '5,800 tweets / second', why: '500,000,000 ÷ 86,400 is about 5,800. Opens outnumber tweets about 6 to 1.' },
      { question: 'Each tweet is written into the timeline of each of its 200 followers. About how many writes a second?', options: ['About 120,000', 'About 1.2 million', 'About 12 million'], answer: 1, at: 'fan-0', show: '1.2 million writes / second', why: '5,800 tweets × 200 followers is about 1.2 million writes a second. Spread over many workers and caches, but it is a lot.' },
      { question: 'A timeline holds the 800 newest tweets, as ids of 8 bytes each. For 300 million readers, about how much memory?', options: ['About 19 GB', 'About 1.9 TB', 'About 190 TB'], answer: 1, at: 's0', show: '1.9 TB of ids', why: '800 × 8 bytes is 6.4 KB a reader. × 300 million is about 1.9 TB: a few dozen cache machines. Full 300-byte tweets would be 70 times more.' },
      { question: 'A tweet followed by 50 million people is deleted. Timelines hold full copies. How many writes to remove it everywhere?', options: ['One', 'About 50,000', 'About 50 million'], answer: 2, at: 'feed', show: '50 million writes, or 1 with ids', why: 'Every copy must be found and rewritten: 50 million writes for one delete. If timelines hold only the id, the tweet is changed in one place, and every timeline shows the change.' },
    ],
  },
  first: FIRST_DESIGN,
  scale: SCALE_UP,
  review,
}
