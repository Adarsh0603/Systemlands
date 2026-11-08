import { createElement } from 'react'
import { ORDER_LOOK, hintFromReview } from '../../core/build/hint'
import { Tag } from '../../core/iso/primitives'
import type { BuildTask, Placement, Requirement, Settings } from '../../core/build/types'
import type { FlowSim } from '../../core/flow/engine'
import type { Capstone, Intro, Review } from '../../core/capstone/types'
import { BITS, BUDGETS, Crawler, DELAYS, SECOND, Web, type WebSpec } from './crawler'

// The design board: the seeds on the left, spots in a lane and above it for the
// stages, the fetchers, and on the right the page store.
const SEEDS_AT = { x: -8.8, z: 0 }
const APP_X = 2.8
const DB_AT = { x: 7.2, z: 0 }
const POS: Record<string, { x: number; z: number }> = {
  l0: { x: -6, z: 0 },
  l1: { x: -3.6, z: 0 },
  l2: { x: -1.2, z: 0 },
  t0: { x: -6, z: -4.4 },
  t1: { x: -3.6, z: -4.4 },
  t2: { x: -1.2, z: -4.4 },
  b0: { x: -3.6, z: 4.4 },
  b1: { x: -1.2, z: 4.4 },
  f1: { x: APP_X, z: -3.2 },
  f2: { x: APP_X, z: 3.2 },
}
const FIRST_SPOTS = ['l0', 'l1', 'l2', 't0', 't1', 't2']
const ALL_SPOTS = [...FIRST_SPOTS, 'f1', 'f2', 'b0', 'b1']
const spot = (id: string) => ({ id, ...POS[id], accepts: [] })

// The first design reads a small web. Then the real thing: bigger, with a calendar
// site whose pages never end, and a fetcher that dies partway.
const T = (s: number) => s * SECOND
const SMALL: WebSpec = { sizes: [15, 15, 15, 15], privateHost: 3, privateCount: 3 }
const BIG: WebSpec = { sizes: [40, 40, 40, 40, 40, 40, 40, 10], trapHost: 7, privateHost: 3, privateCount: 8, lateSeed: T(8) }
export const FIRST_SETTLED = T(34)
export const SCALE_SETTLED = T(66)
const CRASH_AT = T(26)
const NEED_FIRST = 0.98 // share of the pages a polite crawler can reach
const NEED_SCALE = 0.96
const TRAP_LIMIT = 54

const PHASES: [number, string][] = [
  [T(8), 'Spreading out'],
  [CRASH_AT, 'A calendar site appears'],
  [T(32), 'A fetcher dies'],
  [Infinity, 'Catching up'],
]
const phaseAt = (tick: number) => PHASES.find(([end]) => tick < end)![1]
const TIMELINE: NonNullable<BuildTask['timeline']> = {
  phases: [
    { name: 'Spreading out', from: 0 },
    { name: 'Calendar site', from: T(8) },
    { name: 'A crash', from: CRASH_AT },
    { name: 'Catching up', from: T(32) },
  ],
  end: SCALE_SETTLED,
}

export const crawlerOf = new WeakMap<FlowSim, Crawler>()

const seeded = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// URLs travel from the seeds on the left to the fetchers on the right, through
// whatever stands in their way, in this order. A part that stands level with or
// left of one that should come before it has nothing to work with, and URLs stop there.
const RANK: Partial<Record<string, number>> = { dedupe: 0, queue: 1, ring: 2, app: 3 }
const PART_NAMES: Record<string, string> = { dedupe: 'seen-set', queue: 'frontier', ring: 'hash ring', app: 'fetcher' }
function outOfOrder(raw: Placement) {
  const parts = [
    { id: 'app-0', kind: 'app', rank: 3, x: APP_X, fixed: true },
    ...Object.entries(raw)
      .filter(([, kind]) => RANK[kind] !== undefined)
      .map(([id, kind]) => ({ id, kind, rank: RANK[kind]!, x: POS[id].x, fixed: false })),
  ]
  const ahead = parts.flatMap((hi) => parts.filter((lo) => hi.rank > lo.rank && hi.x <= lo.x).map((lo) => ({ hi, lo })))
  if (ahead.length === 0) return null
  const first = ahead[0]
  return {
    ids: [...new Set(ahead.flatMap((a) => [a.hi, a.lo]).filter((p) => !p.fixed).map((p) => p.id))],
    why: `The ${PART_NAMES[first.hi.kind]} has to come after the ${PART_NAMES[first.lo.kind]}, but here it stands in front of it. URLs travel left to right, so they get stuck at the wrong one.`,
  }
}

// Which parts are on the floor, and the spot each one stands on. A piece can go on
// any spot, so what it does comes from its kind.
function layout(raw: Placement) {
  const on = (kind: string) => Object.entries(raw).find(([, k]) => k === kind)?.[0]
  return {
    seen: on('dedupe'),
    frontier: on('queue'),
    ring: on('ring'),
    polite: on('limiter') !== undefined,
    cache: on('cache') !== undefined,
    apps: ['app-0', ...Object.entries(raw).filter(([, k]) => k === 'app').map(([id]) => id)],
    jam: outOfOrder(raw),
  }
}

// What the learner has chosen.
export function chosen(settings: Settings) {
  return {
    bits: BITS[settings.bits ?? 0],
    budget: BUDGETS[settings.budget ?? 4],
    keep: (settings.keep ?? 0) === 1,
    delay: DELAYS[settings.delay ?? 1],
    robots: (settings.robots ?? 0) === 1,
  }
}

interface Mode {
  web: WebSpec
  crash?: number
}

function assemble(raw: Placement, settings: Settings, mode: Mode, rng?: () => number) {
  const l = layout(raw)
  const s = chosen(settings)
  const c = new Crawler(rng ?? seeded(7), {
    web: new Web(mode.web),
    apps: l.apps,
    seen: l.seen ? s.bits : undefined,
    frontier: !!l.frontier,
    ring: !!l.ring,
    budget: l.frontier ? s.budget : Infinity,
    keep: !!l.frontier && s.keep,
    delay: l.polite ? s.delay : 0,
    robots: s.robots,
    keys: { seen: l.seen ?? 'seen', frontier: l.frontier ?? 'frontier', ring: l.ring ?? 'ring' },
    jam: l.jam?.ids,
    crashAt: mode.crash,
    crashKey: mode.crash !== undefined && l.apps.length > 1 ? l.apps[1] : undefined,
  })
  crawlerOf.set(c.flow, c)
  return c.flow
}

// The checks a finished design must pass. Shown live; the win needs all green.
const coverage = (need: number, deadline: number): Requirement => ({
  label: 'Pages',
  says: `By the end, at least ${Math.round(need * 100)}% of the pages a polite crawler can reach must be downloaded and saved.`,
  read: (flow) => {
    const c = crawlerOf.get(flow)
    if (!c) return { text: '', ok: true }
    const got = c.got()
    return { text: `${got} of ${c.wanted}`, ok: !c.jammed && (flow.tick < deadline || got >= Math.ceil(need * c.wanted)) }
  },
})
const polite: Requirement = {
  label: 'Manners',
  says: 'No site may ban the crawler. Sites ban visitors who come back too soon, again and again.',
  read: (flow) => {
    const n = crawlerOf.get(flow)?.banned.size ?? 0
    return { text: n === 0 ? 'no bans' : `${n} banned us`, ok: n === 0 }
  },
}
const rules: Requirement = {
  label: 'Rules',
  says: 'robots.txt lists pages a site does not want read. Read none of them.',
  read: (flow) => {
    const n = crawlerOf.get(flow)?.tally.robotsBreaks ?? 0
    return { text: n === 0 ? 'none read' : `${n} read`, ok: n === 0 }
  },
}
const once: Requirement = {
  label: 'Repeats',
  says: 'Do not download the same page twice. No more than 5 repeats.',
  read: (flow) => {
    const n = crawlerOf.get(flow)?.tally.refetch ?? 0
    return { text: `${n} twice`, ok: n <= 5 }
  },
}
const noWaste: Requirement = {
  label: 'Waste',
  says: `Do not sink time into an endless site. No more than ${TRAP_LIMIT} of its made-up pages.`,
  read: (flow) => {
    const n = crawlerOf.get(flow)?.tally.trapFetched ?? 0
    return { text: `${n} endless`, ok: n <= TRAP_LIMIT }
  },
}
const kept: Requirement = {
  label: 'Kept',
  says: 'No more than 4 addresses may be thrown away on the way, never to be read.',
  read: (flow) => {
    const n = crawlerOf.get(flow)?.lost() ?? 0
    return { text: `${n} lost`, ok: n <= 4 }
  },
}

const BRIEF = {
  title: 'The brief',
  lines: [
    'A search engine can only answer with pages it has already read. Someone has to go out and read the web, page by page, and keep a copy. That is a crawler.',
    'Build one. It starts from a few known links, downloads each page, saves it, and follows the links on the page to find more.',
    'Plan for 1 billion pages a month. A page links to about 50 others, and the same page is linked from many places.',
    'Be a good guest. A site that is visited too often bans you, and some pages are marked off limits in robots.txt.',
  ],
}

const FIXED = [
  { id: 'seeds', kind: 'users' as const, ...SEEDS_AT },
  { id: 'app-0', kind: 'app' as const, x: APP_X, z: 0 },
  { id: 'db', kind: 'database' as const, ...DB_AT },
]
const LABELS = [
  { at: [SEEDS_AT.x, 1.6, SEEDS_AT.z] as [number, number, number], text: 'Seeds' },
  { at: [DB_AT.x, 2.2, DB_AT.z] as [number, number, number], text: 'Page store' },
]
const NAMES: BuildTask['names'] = { dedupe: 'Seen-set', queue: 'Frontier', limiter: 'Politeness timer', app: 'Fetcher' }
const PIECE_HINTS: BuildTask['hints'] = {
  dedupe: 'a Bloom filter: a row of switches that says “seen it” or “new”',
  queue: 'the to-do list of addresses',
  limiter: 'waits between visits to one site',
  app: 'downloads pages',
  ring: 'Gives each site to one fetcher',
  cache: 'Keeps answers to repeated requests',
}

const SETTINGS = [
  { id: 'bits', label: 'row size', when: 'dedupe' as const, min: 0, max: BITS.length - 1, step: 1, initial: 0, options: BITS.map((n) => `${n} switches per page`),
    tradeoffs: [
      { gain: 'Least memory.', cost: 'Many new pages look already seen, and are skipped.' },
      { gain: 'Little memory.', cost: 'Some new pages look seen, and are skipped.' },
      { gain: 'Few new pages are wrongly skipped.', cost: 'More memory.' },
      { gain: 'Very few new pages are wrongly skipped.', cost: 'Even more memory.' },
      { gain: 'Almost no new page is wrongly skipped.', cost: 'The most memory.' },
    ],
  },
  { id: 'budget', label: 'each site may add', when: 'queue' as const, min: 0, max: BUDGETS.length - 1, step: 1, initial: BUDGETS.length - 1, options: BUDGETS.map((n) => (n === Infinity ? 'No limit' : `${n} pages`)),
    tradeoffs: [
      { gain: 'No site can crowd the frontier.', cost: 'Big sites are crawled only in part.' },
      { gain: 'Sites are kept in check.', cost: 'Large sites are cut short.' },
      { gain: 'Room for mid-size sites.', cost: 'A trap site can still add 50 pages.' },
      { gain: 'Most real sites fit.', cost: 'A trap site can add 80 pages.' },
      { gain: 'Every page of every site can be reached.', cost: 'A site that makes endless pages can fill the frontier.' },
    ],
  },
  { id: 'keep', label: 'a handed-out address is', when: 'queue' as const, min: 0, max: 1, step: 1, initial: 0, options: ['Forgotten at once', 'Kept until fetched'],
    tradeoffs: [
      { gain: 'Nothing to track.', cost: 'An address lost with a crashed fetcher is never fetched.' },
      { gain: 'An address a fetcher drops is handed out again.', cost: 'Every handed-out address is tracked until it is fetched.' },
    ],
  },
  { id: 'delay', label: 'waits', when: 'limiter' as const, min: 0, max: DELAYS.length - 1, step: 1, initial: 1, options: ['No time', '0.25 s', '0.5 s', '1 s', '2 s'],
    tradeoffs: [
      { gain: 'The fastest crawl.', cost: 'A site can be flooded with requests.' },
      { gain: 'A fast crawl.', cost: 'Small sites may still feel the load.' },
      { gain: 'Gentler on each site.', cost: 'Each site is crawled more slowly.' },
      { gain: 'Polite to every site.', cost: 'Big sites take a long time.' },
      { gain: 'Very gentle.', cost: 'Fetchers spend much of their time waiting.' },
    ],
  },
  { id: 'robots', label: 'robots.txt', when: 'app' as const, min: 0, max: 1, step: 1, initial: 0, options: ['Ignore it', 'Read it first'],
    tradeoffs: [
      { gain: 'No extra fetch per site.', cost: 'Crawls pages the site asked to be left alone.' },
      { gain: 'Honours what each site allows.', cost: 'One extra fetch per site before anything else.' },
    ],
  },
]

function decorate(flow: FlowSim, raw: Placement) {
  const c = crawlerOf.get(flow)
  if (!c) return null
  const l = layout(raw)
  const out = [createElement(Tag, { key: 'phase', at: [SEEDS_AT.x, 2.4, SEEDS_AT.z], label: c.web.spec.trapHost === undefined ? 'A small web' : phaseAt(flow.tick) })]
  for (const id of l.jam?.ids ?? []) out.push(createElement(Tag, { key: `jam-${id}`, at: [POS[id].x, 1.8, POS[id].z], label: 'Stops here', danger: true }))
  if (c.seen && l.seen) out.push(createElement(Tag, { key: 'seen', at: [POS[l.seen].x, 1.7, POS[l.seen].z], label: `${Math.round(c.seen.fill() * 100)}% of switches on` }))
  if (c.frontier && l.frontier) out.push(createElement(Tag, { key: 'frontier', at: [POS[l.frontier].x, 1.5, POS[l.frontier].z], label: `${c.frontier.jobs.length} waiting`, danger: c.frontier.jobs.length >= c.frontier.capacity * 0.9 }))
  if (c.banned.size) out.push(createElement(Tag, { key: 'ban', at: [APP_X, 2.6, 0], label: `Banned by ${c.banned.size} site${c.banned.size > 1 ? 's' : ''}`, danger: true }))
  out.push(createElement(Tag, { key: 'saved', at: [DB_AT.x, 3.0, DB_AT.z], label: `${c.got()} of ${c.wanted} pages` }))
  return out
}

function common(): Pick<BuildTask, 'pinned' | 'manualStart' | 'rps' | 'shot' | 'fixed' | 'labels' | 'decorate' | 'hints' | 'names' | 'failFast' | 'anywhere'> {
  return {
    pinned: BRIEF,
    manualStart: true,
    rps: 4,
    shot: { target: [-0.8, 0.8, 0], zoom: 0.5 },
    fixed: FIXED,
    labels: LABELS,
    decorate,
    hints: PIECE_HINTS,
    names: NAMES,
    failFast: true,
    anywhere: true,
  }
}

// Stage 2: a small web, and the new idea: remember what you have seen.
export const FIRST_DESIGN: BuildTask = {
  ...common(),
  title: 'First design: read a small web.',
  sub: 'Place the seen-set, the frontier and the politeness timer, then set each one. Changing anything restarts the run.',
  goal: 'Download every page you may read, once each, without annoying a site.',
  goalShort: 'Every page once · polite',
  win: 'A seen-set with a big enough row of switches, a frontier to wait in, and a pause between visits to one site: every page read once, none forbidden.',
  holdSeconds: 4,
  testSeconds: 40,
  pads: FIRST_SPOTS.map(spot),
  toolbox: [
    { kind: 'dedupe', count: 1 },
    { kind: 'queue', count: 1 },
    { kind: 'limiter', count: 1 },
  ],
  settings: [SETTINGS[0], SETTINGS[3], SETTINGS[4]],
  watch: [{ kind: 'busy', key: 'app-0', label: 'Fetcher busy' }],
  requirements: [coverage(NEED_FIRST, FIRST_SETTLED), polite, rules, once],
  assemble: (placed, settings, rng) => assemble(placed, settings, { web: SMALL }, rng),
  diagnose(_m, raw, _settings, flow) {
    const c = crawlerOf.get(flow)
    if (!c) return null
    const l = layout(raw)
    if (l.jam) return { because: l.jam.why, look: ORDER_LOOK }
    const t = c.tally
    if (c.banned.size > 0) return { because: 'A site banned the crawler.', look: l.polite ? 'Compare the wait between visits to one site with how often a site tolerates a visit.' : 'How many pages of the same site does a fetcher open at once?' }
    if (t.robotsBreaks > 0) return { because: 'The crawler read a page that robots.txt forbids.', look: 'What does the crawler check before it fetches a page?' }
    if (t.refetch > 5) return { because: 'The same pages are being downloaded again.', look: 'Pages link to each other in circles. How does the crawler know it has been here before?' }
    if (!l.frontier && c.lost() > 4) return { because: 'Links arrive faster than the fetcher can read them, and the extra ones are thrown away.', look: 'Where do discovered links wait for their turn?' }
    if (l.seen && c.missedByFilter() > 1) return { because: 'Some new pages were skipped because the seen-set said “seen it”.', look: 'How does the seen-set decide, and how full is it?' }
    if (flow.tick >= FIRST_SETTLED && c.got() < Math.ceil(NEED_FIRST * c.wanted)) return { because: 'Too few pages were downloaded.', look: 'Which part of the crawl is the slowest?' }
    return null
  },
  problem: (m, raw, settings, flow) => FIRST_DESIGN.diagnose!(m, raw, settings, flow)?.because ?? null,
  hint: (_m, raw, settings) => hintFromReview(review(raw, settings).lines, ['Seen-set', 'Frontier', 'Manners', 'robots.txt'], false),
  check(_m, raw, settings, flow) {
    const c = flow && crawlerOf.get(flow)
    if (!c || flow.tick < FIRST_SETTLED) return false
    const l = layout(raw)
    return !l.jam && !!l.seen && !!l.frontier && l.polite && c.got() >= Math.ceil(NEED_FIRST * c.wanted) && c.banned.size === 0 && c.tally.robotsBreaks === 0 && c.tally.refetch <= 5 && chosen(settings).robots
  },
}

// Stage 3: the real web. Each phase brings a new way to fail.
export const SCALE_UP: BuildTask = {
  ...common(),
  title: 'Where it breaks: the real web.',
  sub: 'A bigger web, a calendar that never ends, and a fetcher that dies. Watch what turns red, then fix it.',
  goal: 'Get through the whole crawl: nearly every page read, nobody banned, nothing wasted or thrown away.',
  goalShort: 'Survive the whole crawl',
  win: 'Three fetchers, one site to one fetcher on a hash ring, a cap on pages per site, and a frontier that keeps what it hands out: the whole crawl held.',
  holdSeconds: 4,
  testSeconds: 72,
  pads: ALL_SPOTS.map(spot),
  toolbox: [
    { kind: 'dedupe', count: 1 },
    { kind: 'queue', count: 1 },
    { kind: 'ring', count: 1 },
    { kind: 'limiter', count: 1 },
    { kind: 'app', count: 2 },
    { kind: 'cache', count: 1 },
  ],
  timeline: TIMELINE,
  settings: SETTINGS,
  watch: [{ kind: 'busy', key: 'app-0', label: 'Fetcher busy' }],
  requirements: [coverage(NEED_SCALE, SCALE_SETTLED), polite, rules, once, noWaste, kept],
  assemble: (placed, settings, rng) => assemble(placed, settings, { web: BIG, crash: CRASH_AT }, rng),
  diagnose(_m, raw, settings, flow) {
    const c = crawlerOf.get(flow)
    if (!c) return null
    const l = layout(raw)
    if (l.jam) return { because: l.jam.why, look: ORDER_LOOK }
    const s = chosen(settings)
    const t = c.tally
    const tick = flow.tick
    if (c.banned.size > 0) {
      if (!l.polite) return { because: 'A site banned the crawler.', look: 'How many pages of one site can be open at the same time?' }
      if (!l.ring && l.apps.length > 1) return { because: 'A site banned the crawler although each fetcher waits between visits.', look: 'Each fetcher keeps its own timer. Do the fetchers share sites?' }
      return { because: 'A site banned the crawler.', look: 'Compare the wait between visits to one site with how often a site tolerates a visit.' }
    }
    if (t.robotsBreaks > 0) return { because: 'The crawler read a page that robots.txt forbids.', look: 'What does the crawler check before it fetches a page?' }
    if (t.refetch > 5) return { because: 'The same pages are being downloaded again.', look: 'Pages link to each other in circles. How does the crawler know it has been here before?' }
    if (!l.frontier && c.lost() > 4) return { because: 'Links arrive faster than the fetchers can read them, and the extra ones are thrown away.', look: 'Where do discovered links wait for their turn?' }
    if (t.trapFetched > TRAP_LIMIT) return { because: 'The crawler is lost in an endless calendar.', look: 'Every page links to three newer ones. What limits how deep a crawl goes?' }
    if (l.seen && c.missedByFilter() > 3) return { because: 'Some new pages were skipped because the seen-set said “seen it”.', look: 'How does the seen-set decide, and how full is it?' }
    if (tick >= CRASH_AT + T(4) && c.lost() > 4) {
      if (l.frontier && !s.keep) return { because: 'A fetcher died holding addresses it had been handed, and they were forgotten.', look: 'What is kept of an address once it has been handed to a fetcher?' }
      return { because: 'Some addresses were thrown away and never read.', look: 'Where do addresses wait, and what is lost when something dies?' }
    }
    if (l.frontier && s.budget < 40 && tick >= T(30)) return { because: 'A site with many real pages is cut off.', look: 'What limits how many pages are taken from one site?' }
    if (l.cache) return { because: 'A cache keeps the answer to a request that comes again. Every page is downloaded once, so nothing is asked twice.', look: 'Which piece on the board is not helping this system?' }
    if (tick >= SCALE_SETTLED && c.got() < Math.ceil(NEED_SCALE * c.wanted)) {
      const because = 'Too few pages were downloaded in time.'
      if (l.apps.length < 3) return { because, look: 'How many pages can one fetcher read in a second, and how many are needed?' }
      if (s.delay > 20) return { because, look: 'Compare the wait between visits to one site with the time allowed.' }
      return { because, look: 'Which part of the crawl is the slowest?' }
    }
    return null
  },
  problem: (m, raw, settings, flow) => SCALE_UP.diagnose!(m, raw, settings, flow)?.because ?? null,
  hint: (_m, raw, settings) => hintFromReview(review(raw, settings).lines, undefined, false),
  check(_m, raw, _settings, flow) {
    const c = flow && crawlerOf.get(flow)
    if (!c || flow.tick < SCALE_SETTLED) return false
    return c.got() >= Math.ceil(NEED_SCALE * c.wanted) && c.banned.size === 0 && c.tally.robotsBreaks === 0 && c.tally.refetch <= 5 && c.tally.trapFetched <= TRAP_LIMIT && c.lost() <= 4 && !layout(raw).cache && !layout(raw).jam
  },
}

function review(raw: Placement, settings: Settings): Review {
  const l = layout(raw)
  const s = chosen(settings)
  const apps = l.apps.length
  const seconds = (n: number) => (n === 0 ? 'No wait' : `${n / SECOND} s`)
  return {
    lines: [
      { label: 'Seen-set', yours: l.seen ? `Bloom filter, ${s.bits} switches per page` : 'None', reference: 'Bloom filter, about 12 switches per page', why: 'It answers “seen it?” 20,000 times a second in a few bits per URL. It can be wrong one way: it may call a new page seen, never the other way round.', ok: !!l.seen && s.bits >= 8 },
      { label: 'Frontier', yours: l.frontier ? (s.keep ? 'A queue, keeps addresses until fetched' : 'A queue, forgets addresses when handed out') : 'None', reference: 'A queue that keeps an address until its fetcher is done', why: 'Fetchers crash. An address only leaves the list when the page is safely saved.', ok: !!l.frontier && s.keep },
      { label: 'Per site', yours: l.frontier ? (s.budget === Infinity ? 'No limit' : `${s.budget} pages`) : 'No frontier', reference: 'A cap a little above the biggest real site', why: 'An endless site makes up pages forever. A cap stops it, and still lets a normal site finish.', ok: !!l.frontier && s.budget >= 40 && s.budget <= 50 },
      { label: 'Manners', yours: l.polite ? `Waits ${seconds(s.delay)}` : 'No wait', reference: 'Wait 0.5 to 1 s between visits to one site', why: 'A site tolerates a visit every half second or so. Faster, and it bans you.', ok: l.polite && s.delay >= 10 && s.delay <= 20 },
      { label: 'Fetchers', yours: `${apps} fetcher${apps > 1 ? 's' : ''}${l.ring ? ' on a hash ring' : ''}`, reference: '3 fetchers on a hash ring, one site each', why: 'Each timer only knows its own fetcher’s visits, so a site must always go to the same one. A ring keeps that true when a fetcher dies.', ok: apps >= 3 && !!l.ring },
      { label: 'robots.txt', yours: s.robots ? 'Read first' : 'Ignored', reference: 'Read first, always', why: 'It is how a site says which pages to leave alone. It costs one small request per site.', ok: s.robots },
      { label: 'Extras', yours: l.cache ? 'A cache, which does nothing here' : 'Only what is needed', reference: 'No cache', why: 'Every page is downloaded once, so a cache never answers anything. An extra piece is one more thing to run and fail.', ok: !l.cache },
    ],
    tradeoffs: [
      'A Bloom filter can skip a new page for good. A bigger filter lowers the chance, and pages with many links in still get found another way.',
      'A plain queue treats a spam page like a front page. Real crawlers rank the frontier by how important and how fresh a page is.',
      'Hashing by site keeps manners simple, but one huge site becomes one busy fetcher. Big sites get split across a few fetchers that share a timer.',
      'Keeping an address until it is saved means a crash can cause a repeat. Fetching a page twice is harmless, losing it quietly is not.',
    ],
    interview: [
      'Clarify: how many pages a month, how fresh must they be, which kinds of pages, do we obey robots.txt, is it one machine or many.',
      'Estimate: 1 billion pages a month is about 400 a second. At 500 KB each that is about 200 MB a second and 500 TB a month.',
      'Design: seeds into a frontier, fetchers that download and parse, links through a seen-set back to the frontier, pages into blob storage.',
      'Scale: shard the frontier by site on a hash ring, one timer per site, a Bloom filter for the seen-set, retry what a dead fetcher held.',
      'Traps: a cap per site, a depth limit, and ignore URLs that grow without end.',
    ],
  }
}

// The opening: a tiny crawl, from a link to a saved page.
const INTRO_WEB: WebSpec = { sizes: [12, 12], privateHost: 1, privateCount: 0 }
const INTRO_FIXED = [
  { id: 'seeds', kind: 'users' as const, x: -8, z: 0 },
  { id: 'seen', kind: 'dedupe' as const, x: -5.4, z: 0 },
  { id: 'frontier', kind: 'queue' as const, x: -2.8, z: 0 },
  { id: 'app-0', kind: 'app' as const, x: 0.4, z: 0 },
  { id: 'db', kind: 'database' as const, x: 3.8, z: 0 },
]
export const INTRO: Intro = {
  task: {
    title: 'How a crawler works',
    sub: '',
    goal: '',
    win: '',
    holdSeconds: 1,
    rps: 1,
    shot: { target: [-2, 0.8, 0], zoom: 0.85 },
    fixed: INTRO_FIXED,
    pads: [],
    toolbox: [],
    assemble: (_placed, _settings, rng) => {
      const c = new Crawler(rng ?? seeded(3), {
        web: new Web(INTRO_WEB),
        apps: ['app-0'],
        seen: 12,
        frontier: true,
        ring: false,
        budget: Infinity,
        keep: false,
        delay: 10,
        robots: true,
        keys: { seen: 'seen', frontier: 'frontier', ring: 'ring' },
      })
      crawlerOf.set(c.flow, c)
      return c.flow
    },
    check: () => false,
  },
  steps: [
    { say: 'You search for a page. The search engine can only find it if it has already read it. So first, something has to go and read the web.', at: 'seeds', label: 'A few known links' },
    { say: 'Each new address is checked first: have we met this one before? If not, it goes on the list. Remembering billions of addresses in full would not fit in memory, so this is the Bloom filter: a row of switches.', at: 'seen', label: 'Seen-set' },
    { say: 'The list holds the addresses still to visit, in order.', at: 'frontier', label: 'Frontier' },
    { say: 'A fetcher takes one address, downloads the page and hands it over to be saved.', at: 'app-0', label: 'Fetcher' },
    { say: 'The page is saved. And every link on it goes back through the seen-set, so the crawl keeps growing by itself.', at: 'db', label: 'Page store' },
    { say: 'Easy for a few pages. Now picture a billion a month, where pages link in circles, sites ban rude visitors, and machines crash.' },
  ],
  start: 'Take the challenge →',
}

export const WEB_CRAWLER: Capstone = {
  id: 'web-crawler',
  title: 'Web crawler',
  stages: ['Requirements', 'First design', 'Where it breaks', 'Final review'],
  intro: INTRO,
  goals: ['Every page, once', 'Be polite', 'Obey robots.txt', 'Escape the trap'],
  brief: BRIEF,
  estimate: {
    intro: 'Before drawing anything, work out how big this is. A few quick numbers decide the design.',
    summary: { title: 'About 400 pages and 20,000 checks a second, around 500 TB a month.', body: 'The network and the sites’ patience set the pace, not the machines. And “have I seen this?” must be answered from memory, so it has to be small.' },
    questions: [
      { question: 'The crawler must read 1 billion pages a month. About how many pages a second is that?', options: ['About 40', 'About 400', 'About 4,000'], answer: 1, at: 'app-0', show: '400 pages / second', why: 'A month has about 2.6 million seconds. 1,000,000,000 ÷ 2,600,000 is about 400.' },
      { question: 'An average page is about 500 KB. About how much data arrives every second?', options: ['About 20 MB', 'About 200 MB', 'About 2 GB'], answer: 1, at: 'db', show: '200 MB / second', why: '400 pages × 500 KB is about 200 MB a second, more than one ordinary machine takes in.' },
      { question: 'Each page links to about 50 others. About how many “have I seen this?” checks a second?', options: ['About 400', 'About 4,000', 'About 20,000'], answer: 2, at: 'seen', show: '20,000 checks / second', why: '400 pages a second × 50 links is 20,000 checks a second. Far too many to ask a disk. Keeping every address in full would not fit in memory either, so the seen-set is a Bloom filter: a few switches per page instead of the whole address.' },
      { question: 'Keep every page for a month. About how much storage is that?', options: ['About 5 TB', 'About 50 TB', 'About 500 TB'], answer: 2, why: '1 billion pages × 500 KB is 500 TB. It lives in blob storage, spread over many machines.' },
    ],
  },
  first: FIRST_DESIGN,
  scale: SCALE_UP,
  review,
}
