import { createElement } from 'react'
import { ORDER_LOOK, hintFromReview } from '../../core/build/hint'
import { Tag } from '../../core/iso/primitives'
import type { BuildTask, Diagnosis, Placement, Requirement, Settings } from '../../core/build/types'
import type { FlowSim } from '../../core/flow/engine'
import type { Capstone, Intro, Review } from '../../core/capstone/types'
import { Feed, SECOND, type Limit, type Phase } from './feed'

// The design board: writers and readers on the left, a lane for each, the fan-out
// workers and the feed server in the middle, and the feed store on the right.
const WRITERS_AT = { x: -8.8, z: -4.4 }
const READERS_AT = { x: -8.8, z: 4.4 }
const FAN_AT = { x: -1.6, z: -4.4 }
const FEED_AT = { x: -1.6, z: 4.4 }
const STORE_AT = { x: 4.4, z: 0 }
const POS: Record<string, { x: number; z: number }> = {
  a0: { x: -5.2, z: -4.4 },
  a1: { x: -5.2, z: 4.4 },
  w1: { x: -1.6, z: -1.4 },
  w2: { x: 1.4, z: -1.4 },
  s1: { x: 4.4, z: -4.4 },
  s2: { x: 4.4, z: 4.4 },
  d0: { x: -5.2, z: -1.6 },
  d1: { x: 1.4, z: 4.4 },
}
const FIRST_SPOTS = ['a0', 'a1', 'w1', 's1']
const ALL_SPOTS = ['a0', 'a1', 'w1', 'w2', 's1', 's2', 'd0', 'd1']
const spot = (id: string) => ({ id, ...POS[id], accepts: [] })

// The first design: ordinary accounts, a busy hour. Then the real day: a rush,
// two posts by a celebrity, and a cache that loses everything.
const T = (s: number) => s * SECOND
const FIRST_PHASES: Phase[] = [{ from: 0, opens: 14, posts: 3 }]
export const FIRST_SETTLED = T(30)
const SCALE_PHASES: Phase[] = [
  { from: 0, opens: 8, posts: 2, mids: 0.5 },
  { from: T(8), opens: 60, posts: 8, mids: 0.5 },
  { from: T(20), opens: 60, posts: 12, mids: 0.5 },
  { from: T(24), opens: 60, posts: 8, mids: 0.5 },
]
const STARS = [T(30), T(46)]
const COLD_AT = T(40)
export const SCALE_SETTLED = T(62)
const WAIT_LIMIT = 0.8 // seconds a reader may wait for a feed
const FRESH_LIMIT = 3 // seconds a post may take to reach every follower
const FAIL_LIMIT = 3 // readers turned away in all
const READ_CAP = 30 // opens a second a rate limiter on the readers' side lets through
const WRITE_CAP = 6 // posts a second one on the writers' side lets through

const TIMELINE: NonNullable<BuildTask['timeline']> = {
  phases: [
    { name: 'A calm morning', from: 0 },
    { name: 'The rush', from: T(8) },
    { name: 'A busy few seconds', from: T(20) },
    { name: 'A celebrity posts', from: T(30) },
    { name: 'The cache dies', from: T(40) },
    { name: 'Another post', from: T(46) },
  ],
  end: SCALE_SETTLED,
}

export const feedOf = new WeakMap<FlowSim, Feed>()

const seeded = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// Requests travel left to right. A cache or a queue that stands level with or
// right of the server it should come before has nothing to work with.
function outOfOrder(raw: Placement) {
  const bad = Object.entries(raw).flatMap(([id, kind]) => {
    if (kind === 'cache' && POS[id].x >= FEED_AT.x) return [{ id, why: 'The cache has to stand in front of the feed server, so that most opens are answered before they reach it. Here it does not.' }]
    if (kind === 'queue' && POS[id].x >= FAN_AT.x) return [{ id, why: 'The queue has to stand in front of the fan-out workers, to hold posts for them. Here it does not.' }]
    return []
  })
  return bad.length ? { ids: bad.map((b) => b.id), why: bad[0].why } : null
}

// Which parts are on the floor, and where. A piece can go on any spot, so what it does comes from its kind.
function layout(raw: Placement) {
  const on = (kind: string) => Object.entries(raw).find(([, k]) => k === kind)?.[0]
  const all = (kind: string) => Object.entries(raw).filter(([, k]) => k === kind).map(([id]) => id)
  return {
    queue: on('queue'),
    cache: on('cache'),
    workers: ['fan-0', ...all('app')],
    shards: ['s0', ...all('database')],
    // A rate limiter guards the lane it stands in: readers' below the middle line, writers' above it.
    limits: Object.entries(raw)
      .filter(([, k]) => k === 'limiter')
      .map(([id]): Limit => (POS[id].z > 0 ? { key: id, lane: 'read', rate: READ_CAP } : { key: id, lane: 'write', rate: WRITE_CAP })),
    extras: Object.values(raw).filter((k) => k === 'breaker' || k === 'ring').length,
    jam: outOfOrder(raw),
  }
}

export const CUTOFF_NAMES = ['Every post is copied', 'Accounts over 1 million followers are looked up', 'Accounts over 10,000 followers are looked up', 'Every account is looked up']
export function chosen(settings: Settings) {
  // The first design has only small accounts, so its choice is just copy or look up.
  const cutoff = settings.when !== undefined ? (settings.when === 1 ? 3 : 0) : (settings.cutoff ?? 0)
  return { cutoff, skipIdle: (settings.idle ?? 0) === 1 }
}

interface Mode {
  phases: Phase[]
  stars: number[]
  coldAt?: number
}

function assemble(raw: Placement, settings: Settings, mode: Mode, rng?: () => number) {
  const l = layout(raw)
  const s = chosen(settings)
  const feed = new Feed(rng ?? seeded(7), {
    cutoff: s.cutoff,
    queue: !!l.queue,
    cache: !!l.cache,
    skipIdle: s.skipIdle,
    workers: l.workers,
    shards: l.shards,
    phases: mode.phases,
    stars: mode.stars,
    limits: l.limits,
    coldAt: mode.coldAt,
    jam: l.jam?.ids,
    keys: { queue: l.queue ?? 'queue', cache: l.cache ?? 'cache' },
  })
  feedOf.set(feed.flow, feed)
  return feed.flow
}

// The checks a finished design must pass. Shown live; the win needs all green.
const opens = (deadline: number): Requirement => ({
  label: 'Feeds',
  says: `Every reader gets a feed, in under ${WAIT_LIMIT} seconds. No more than ${FAIL_LIMIT} readers turned away in all.`,
  read: (flow) => {
    const f = feedOf.get(flow)
    if (!f) return { text: '', ok: true }
    const slow = flow.tick >= T(4) && f.wait() > WAIT_LIMIT
    const text = f.tally.failed > 0 ? `${f.tally.failed} turned away` : `${f.wait().toFixed(2)} s`
    return { text, ok: f.tally.failed <= FAIL_LIMIT && !slow && (flow.tick < deadline || f.tally.opened > 0) }
  },
})
const posts: Requirement = {
  label: 'Posts',
  says: 'No post may be lost on its way to the followers.',
  read: (flow) => {
    const n = feedOf.get(flow)?.tally.lost ?? 0
    return { text: n === 0 ? 'none lost' : `${n} lost`, ok: n === 0 }
  },
}
const fresh: Requirement = {
  label: 'Fresh',
  says: `A post must reach every follower within ${FRESH_LIMIT} seconds, a celebrity’s as well.`,
  read: (flow) => {
    const f = feedOf.get(flow)
    if (!f) return { text: '', ok: true }
    const slowest = Math.max(f.slowest(), f.slowest(true))
    return { text: `${slowest.toFixed(1)} s`, ok: slowest <= FRESH_LIMIT }
  },
}

const BRIEF = {
  title: 'The brief',
  lines: [
    'A social feed shows you the latest posts from the people you follow. You open the app and it must already be there.',
    'Build one. People post all day. Each reader opens a feed made of the newest posts of everyone they follow.',
    'Plan for 500 million readers who open the app 10 times a day, and 100 million posts a day. People follow about 200 accounts, and a few accounts are followed by tens of millions.',
    'Readers do not wait, and a post is not allowed to take long to arrive.',
  ],
}

const FIXED = [
  { id: 'writers', kind: 'users' as const, ...WRITERS_AT },
  { id: 'readers', kind: 'users' as const, ...READERS_AT },
  { id: 'fan-0', kind: 'app' as const, ...FAN_AT },
  { id: 'feed', kind: 'app' as const, ...FEED_AT },
  { id: 's0', kind: 'database' as const, ...STORE_AT },
]
const LABELS = [
  { at: [WRITERS_AT.x, 1.6, WRITERS_AT.z] as [number, number, number], text: 'Writers' },
  { at: [READERS_AT.x, 1.6, READERS_AT.z] as [number, number, number], text: 'Readers' },
  { at: [FAN_AT.x, 1.6, FAN_AT.z] as [number, number, number], text: 'Fan-out worker' },
  { at: [FEED_AT.x, 1.6, FEED_AT.z] as [number, number, number], text: 'Feed server' },
  { at: [STORE_AT.x, 2.2, STORE_AT.z] as [number, number, number], text: 'Feed store' },
]
const NAMES: BuildTask['names'] = { queue: 'Post queue', cache: 'Feed cache', app: 'Fan-out worker', database: 'Store shard' }
const PIECE_HINTS: BuildTask['hints'] = {
  queue: 'holds posts until a worker is free',
  cache: 'remembers a reader’s feed for a few seconds',
  app: 'copies posts into followers’ inboxes',
  database: 'one more piece of the feed store',
  limiter: 'lets only so many requests a second through',
  breaker: 'stops calling a service that keeps failing',
  ring: 'gives each key to one machine',
}

// Stage 2 has only small accounts, so the choice is just when the work is done.
const WHEN = { id: 'when', label: 'a feed is made', when: 'app' as const, min: 0, max: 1, step: 1, initial: 0, options: ['When a post is made', 'When a feed opens'],
  tradeoffs: [
    { gain: 'A feed opens at once: it is already made.', cost: 'Every post is copied to every follower.' },
    { gain: 'A post is one write.', cost: 'Every open gathers posts from everyone followed.' },
  ],
}

const SETTINGS = [
  { id: 'cutoff', label: 'when a feed opens', when: 'app' as const, min: 0, max: 3, step: 1, initial: 0, options: CUTOFF_NAMES,
    tradeoffs: [
      { gain: 'Every feed is ready ahead.', cost: 'A big account’s post means millions of copies.' },
      { gain: 'Only the biggest accounts skip copying.', cost: 'Accounts just under 1 million still copy to every follower.' },
      { gain: 'Far fewer copies.', cost: 'A feed that follows many large accounts does more work when it opens.' },
      { gain: 'No copies at all.', cost: 'Every open gathers posts from everyone followed.' },
    ],
  },
  { id: 'idle', label: 'posts are copied to', when: 'app' as const, min: 0, max: 1, step: 1, initial: 0, options: ['All followers', 'Active followers only'],
    tradeoffs: [
      { gain: 'Every feed is ready, whoever opens it.', cost: 'Copies go to people who may never look.' },
      { gain: 'No copies to people who are away.', cost: 'A returning follower’s feed is built when they open it.' },
    ],
  },
]

function decorate(flow: FlowSim, raw: Placement) {
  const f = feedOf.get(flow)
  if (!f) return null
  const l = layout(raw)
  const out = [createElement(Tag, { key: 'phase', at: [WRITERS_AT.x, 2.4, WRITERS_AT.z], label: f.cfg.stars.length ? (TIMELINE.phases.filter((p) => p.from <= flow.tick).pop()?.name ?? '') : 'A busy hour' })]
  for (const id of l.jam?.ids ?? []) out.push(createElement(Tag, { key: `jam-${id}`, at: [POS[id].x, 1.8, POS[id].z], label: 'Stops here', danger: true }))
  const load = f.storeLoad()
  out.push(createElement(Tag, { key: 'store', at: [STORE_AT.x, 3.0, STORE_AT.z], label: `Store ${Math.round(load * 100)}% full`, danger: load > 0.75 }))
  const backlog = f.backlog()
  if (backlog > 0) out.push(createElement(Tag, { key: 'backlog', at: [FAN_AT.x, 2.4, FAN_AT.z], label: `${backlog} copies waiting`, danger: backlog > 60 }))
  if (l.cache) out.push(createElement(Tag, { key: 'cache', at: [POS[l.cache].x, 1.6, POS[l.cache].z], label: `${f.tally.opened === 0 ? 0 : Math.round((f.tally.hits / f.tally.opened) * 100)}% answered here` }))
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
function symptom(f: Feed): Diagnosis | null {
  const t = f.tally
  if (t.failed > FAIL_LIMIT) return { because: `Some readers were turned away.${t.limited ? ' Some were turned away by a rate limiter.' : ''}`, look: 'Which part fills up when readers arrive?' }
  if (t.lost > 0) return { because: `Some posts were lost.${t.limited ? ' Some were turned away by a rate limiter.' : ''}`, look: 'Where does a post wait when the machine writing it is busy?' }
  const slow = Math.max(f.slowest(), f.slowest(true))
  if (slow > FRESH_LIMIT) return { because: 'A post took too long to reach its followers.', look: 'Where are the copies of a post waiting, and how many writers are there?' }
  if (f.wait() > WAIT_LIMIT) return { because: 'Opening the app is slow.', look: 'What does the app read from on every open, and how busy is it?' }
  return null
}

// Stage 2: ordinary accounts, and the new idea: do the work when a post is made.
export const FIRST_DESIGN: BuildTask = {
  ...common(),
  title: 'First design: a busy hour.',
  sub: 'Decide when a post is turned into a feed, and add what helps. Changing anything restarts the run.',
  goal: 'Give every reader a feed in under a second, and get every post to its followers within 3 seconds.',
  goalShort: 'Fast feeds · fresh posts',
  win: 'Copy each post into its followers’ inboxes when it is made, so opening the app is one lookup. Or look up when opened, with a cache that answers most opens.',
  holdSeconds: 4,
  testSeconds: 36,
  pads: FIRST_SPOTS.map(spot),
  toolbox: [
    { kind: 'queue', count: 1 },
    { kind: 'cache', count: 1 },
  ],
  settings: [WHEN],
  watch: [{ kind: 'busy', key: 'feed', label: 'Feed server busy' }],
  requirements: [opens(FIRST_SETTLED), posts, fresh],
  assemble: (placed, settings, rng) => assemble(placed, settings, { phases: FIRST_PHASES, stars: [] }, rng),
  diagnose(_m, raw, _settings, flow) {
    const f = feedOf.get(flow)
    if (!f) return null
    const l = layout(raw)
    if (l.jam) return { because: l.jam.why, look: ORDER_LOOK }
    return symptom(f)
  },
  problem: (m, raw, settings, flow) => FIRST_DESIGN.diagnose!(m, raw, settings, flow)?.because ?? null,
  hint: (_m, raw, settings) => hintFromReview(review(raw, settings).lines, ['Feed cache', 'Workers', 'Store'], false),
  check(_m, _raw, _settings, flow) {
    const f = flow && feedOf.get(flow)
    if (!f || flow.tick < FIRST_SETTLED) return false
    return f.tally.failed <= FAIL_LIMIT && f.tally.lost === 0 && f.wait() <= WAIT_LIMIT && f.slowest() <= FRESH_LIMIT && f.tally.opened > 0
  },
}

// Stage 3: the real day. Each phase brings a new way to fail.
export const SCALE_UP: BuildTask = {
  ...common(),
  title: 'Where it breaks: a celebrity.',
  sub: 'A rush of readers, accounts of every size, a celebrity, and a cache that dies. Watch the numbers, then tune it.',
  goal: 'Get through the whole day: nobody turned away, no post lost, every post fresh.',
  goalShort: 'Survive the whole day',
  win: 'Look up only the celebrity when a feed opens and copy the rest. Queue the posts, keep a cache, and give the store and the workers room.',
  holdSeconds: 4,
  testSeconds: 66,
  pads: ALL_SPOTS.map(spot),
  toolbox: [
    { kind: 'queue', count: 1 },
    { kind: 'cache', count: 1 },
    { kind: 'app', count: 2 },
    { kind: 'database', count: 2 },
    { kind: 'limiter', count: 1 },
    { kind: 'breaker', count: 1 },
    { kind: 'ring', count: 1 },
  ],
  timeline: TIMELINE,
  settings: SETTINGS,
  watch: [{ kind: 'busy', key: 'feed', label: 'Feed server busy' }],
  requirements: [opens(SCALE_SETTLED), posts, fresh],
  assemble: (placed, settings, rng) => assemble(placed, settings, { phases: SCALE_PHASES, stars: STARS, coldAt: COLD_AT }, rng),
  diagnose(_m, raw, _settings, flow) {
    const f = feedOf.get(flow)
    if (!f) return null
    const l = layout(raw)
    if (l.jam) return { because: l.jam.why, look: ORDER_LOOK }
    return symptom(f)
  },
  problem: (m, raw, settings, flow) => SCALE_UP.diagnose!(m, raw, settings, flow)?.because ?? null,
  hint: (_m, raw, settings) => hintFromReview(review(raw, settings).lines, undefined, false),
  check(_m, _raw, _settings, flow) {
    const f = flow && feedOf.get(flow)
    if (!f || flow.tick < SCALE_SETTLED) return false
    return f.tally.failed <= FAIL_LIMIT && f.tally.lost === 0 && f.wait() <= WAIT_LIMIT && f.slowest() <= FRESH_LIMIT && f.slowest(true) <= FRESH_LIMIT
  },
}

function review(raw: Placement, settings: Settings): Review {
  const l = layout(raw)
  const s = chosen(settings)
  return {
    lines: [
      { label: 'Cutoff', yours: CUTOFF_NAMES[s.cutoff], reference: 'Only accounts over 1 million followers are looked up', why: 'Reads outnumber posts by far, so copy when a post is made. But one post by a celebrity is millions of copies, so look that account up when the feed opens. Mid accounts are cheap to copy and costly to look up, since every reader follows several.', ok: s.cutoff === 1 },
      { label: 'Post queue', yours: l.queue ? 'A queue in front of the workers' : 'None', reference: 'A queue in front of the workers', why: 'Posts arrive in bursts. A queue holds them while the workers catch up, so none is turned away.', ok: !!l.queue },
      { label: 'Feed cache', yours: l.cache ? 'A cache in front of the feed server' : 'None', reference: 'A cache in front of the feed server', why: 'The same readers open the app again and again. A cache answers most opens without the store, and absorbs the rush.', ok: !!l.cache },
      { label: 'Workers', yours: `${l.workers.length} fan-out worker${l.workers.length > 1 ? 's' : ''}`, reference: '3 fan-out workers', why: 'Each worker copies a few writes a tick. The busiest seconds need three of them to keep every post fresh.', ok: l.workers.length >= 3 },
      { label: 'Store', yours: `${l.shards.length} shard${l.shards.length > 1 ? 's' : ''}`, reference: '3 shards', why: 'Lookups and writes share the store. Split over shards, a burst of writes does not starve the readers.', ok: l.shards.length >= 3 },
      { label: 'Extras', yours: l.limits.length + l.extras ? 'Pieces this system does not need' : 'Only what is needed', reference: 'No limiter, breaker or hash ring', why: 'A rate limiter turns real readers and posts away. A breaker guards calls to a failing service, and nothing here calls one. A hash ring has nothing to do when the shards already spread by reader.', ok: l.limits.length + l.extras === 0 },
    ],
    tradeoffs: [
      'The cache shows a feed that can be a few seconds old. Readers rarely notice, and the store is spared.',
      'Two ways to build a feed means every open merges the inbox with the accounts looked up, so the feed server does more per open.',
      'Skipping idle followers saves writes, but a returning reader has no inbox: their open looks up every account they follow, and skips the cache. Enough of those at once and the store is swamped.',
      'Where to draw the line is a choice. Too low and every reader looks up many accounts per open. Too high and the copies of a big account bury the workers.',
    ],
    interview: [
      'Clarify: how many readers and posts, how fresh must a feed be, how is the feed ordered, are there celebrities, images or video.',
      'Estimate: 500 million readers opening 10 times a day is about 58,000 opens a second. 100 million posts a day is about 1,200 a second, and 200 followers each is about 240,000 copies a second.',
      'Design: post service, queue, fan-out workers, feed store sharded by reader, feed cache, feed server that merges.',
      'Scale: copy at post time for normal accounts, look celebrities up at open time, skip inactive followers, cache feeds.',
      'Failures: a cold cache can flood the store, so warm it or rate-limit it. Retry copies that fail.',
    ],
  }
}

// The opening: a tiny feed, from a post to a reader.
const INTRO_FIXED = [
  { id: 'writers', kind: 'users' as const, x: -8, z: -3 },
  { id: 'fan-0', kind: 'app' as const, x: -3, z: -3 },
  { id: 's0', kind: 'database' as const, x: 2.4, z: 0 },
  { id: 'feed', kind: 'app' as const, x: -3, z: 3 },
  { id: 'readers', kind: 'users' as const, x: -8, z: 3 },
]
export const INTRO: Intro = {
  task: {
    title: 'How a social feed works',
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
      const feed = new Feed(rng ?? seeded(3), {
        cutoff: 0,
        queue: false,
        cache: false,
        skipIdle: false,
        workers: ['fan-0'],
        shards: ['s0'],
        phases: [{ from: 0, opens: 2, posts: 1 }],
        stars: [],
        keys: { queue: 'queue', cache: 'cache' },
      })
      feedOf.set(feed.flow, feed)
      return feed.flow
    },
    check: () => false,
  },
  steps: [
    { say: 'People post all day. Someone you follow posts a photo.', at: 'writers', label: 'A post' },
    { say: 'A worker copies the post into the inbox of everyone who follows its author. This is called fan-out.', at: 'fan-0', label: 'Fan-out worker' },
    { say: 'The inboxes live in the feed store. Each reader has one, already holding the newest posts.', at: 's0', label: 'Feed store' },
    { say: 'When you open the app, the feed server reads your inbox and sends it back. One lookup, no searching.', at: 'feed', label: 'Feed server' },
    { say: 'Your feed is on screen. Easy for a few friends. Now picture a celebrity with 50 million followers.' },
  ],
  start: 'Take the challenge →',
}

export const NEWS_FEED: Capstone = {
  id: 'news-feed',
  title: 'Social feed',
  stages: ['Requirements', 'First design', 'Where it breaks', 'Final review'],
  intro: INTRO,
  goals: ['Fast feeds', 'Fresh posts', 'No post lost', 'Survive a celebrity'],
  brief: BRIEF,
  estimate: {
    intro: 'Before drawing anything, work out how big this is. A few quick numbers decide the design.',
    summary: { title: 'About 58,000 opens a second, and copying costs only 240,000 writes.', body: 'Reading every followed account on every open is 12 million lookups a second. Copying once when a post is made is far cheaper. Except for a celebrity, whose one post is tens of millions of copies.' },
    questions: [
      { question: '500 million people open the app 10 times a day. About how many opens a second?', options: ['About 5,800', 'About 58,000', 'About 580,000'], answer: 1, at: 'readers', show: '58,000 opens / second', why: '5 billion opens a day ÷ 86,400 seconds is about 58,000.' },
      { question: '100 million posts a day. About how many posts a second?', options: ['About 120', 'About 1,200', 'About 12,000'], answer: 1, at: 'writers', show: '1,200 posts / second', why: '100,000,000 ÷ 86,400 is about 1,200. Reads outnumber writes about 50 to 1.' },
      { question: 'Without copies, each open looks up the 200 accounts the reader follows. About how many lookups a second?', options: ['About 120,000', 'About 1.2 million', 'About 12 million'], answer: 2, at: 'feed', show: '12 million lookups / second', why: '58,000 opens × 200 accounts is about 12 million lookups a second. No store takes that.' },
      { question: 'With copies, each post is written into the inbox of each of its 200 followers. About how many writes a second?', options: ['About 24,000', 'About 240,000', 'About 2.4 million'], answer: 1, at: 's0', show: '240,000 writes / second', why: '1,200 posts × 200 followers is about 240,000 writes a second. Much less than 12 million lookups, so do the work when a post is made.' },
      { question: 'A celebrity with 50 million followers posts once. How many writes is that?', options: ['About 50,000', 'About 500,000', 'About 50 million'], answer: 2, at: 'fan-0', show: '50 million writes', why: 'One write per follower: 50 million for a single post. Copying every post this way would bury the store.' },
    ],
  },
  first: FIRST_DESIGN,
  scale: SCALE_UP,
  review,
}
