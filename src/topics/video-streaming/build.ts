import { createElement } from 'react'
import { ORDER_LOOK, hintFromReview } from '../../core/build/hint'
import { Tag } from '../../core/iso/primitives'
import type { BuildTask, Diagnosis, Placement, Requirement, Settings } from '../../core/build/types'
import type { FlowSim } from '../../core/flow/engine'
import type { Capstone, Intro, Review } from '../../core/capstone/types'
import { SECOND, Video, type Limit, type Phase } from './video'

// The design board: uploaders and viewers on the left, an upload lane above and a
// watch lane below, the origin on the right of the watch lane, and the video store at the end.
const UPLOADERS_AT = { x: -8.8, z: -4.4 }
const VIEWERS_AT = { x: -8.8, z: 4.4 }
const ENC_AT = { x: -1.6, z: -4.4 }
const ORIGIN_AT = { x: 1.4, z: 4.4 }
const STORE_AT = { x: 4.4, z: 0 }
const POS: Record<string, { x: number; z: number }> = {
  u1: { x: -5.2, z: -4.4 },
  w1: { x: 1.4, z: -4.4 },
  w2: { x: 4.4, z: -4.4 },
  v1: { x: -5.2, z: 4.4 },
  v2: { x: -1.8, z: 4.4 },
  d0: { x: -5.2, z: 0 },
  d1: { x: -1.6, z: 0 },
  y1: { x: 4.4, z: 4.4 },
}
const FIRST_SPOTS = ['u1', 'v1', 'v2', 'd1']
const ALL_SPOTS = ['u1', 'w1', 'w2', 'v1', 'v2', 'd0', 'd1', 'y1']
const spot = (id: string) => ({ id, ...POS[id], accepts: [] })

// The first design: an ordinary busy hour. Then the real day: a burst of uploads,
// a transcoder that crashes, a long film, and a premiere.
const T = (s: number) => s * SECOND
const FIRST_PHASES: Phase[] = [
  { from: 0, plays: 10, uploads: 0.25 },
  { from: T(4), plays: 30, uploads: 0.25 },
  { from: T(10), plays: 30, uploads: 1.2 },
  { from: T(14), plays: 30, uploads: 0.25 },
]
export const FIRST_SETTLED = T(30)
const SCALE_PHASES: Phase[] = [
  { from: 0, plays: 10, uploads: 0.4 },
  { from: T(6), plays: 30, uploads: 0.4 },
  { from: T(8), plays: 40, uploads: 1.8 },
  { from: T(18), plays: 40, uploads: 0.4 },
  { from: T(40), plays: 70, uploads: 0.4, premiere: 0.6 },
  { from: T(54), plays: 40, uploads: 0.4 },
]
const FILMS = [T(26)]
const CRASH = { at: T(12), down: T(6) }
export const SCALE_SETTLED = T(62)
const WAIT_LIMIT = 1 // seconds a play may take to start, on average
const FAIL_LIMIT = 3 // plays turned away in all
const BUFFER_LIMIT = 0.05 // share of plays that may stall
const READY_LIMIT = 16 // seconds an upload may take to be ready to watch
const WATCH_CAP = 30 // plays a second a rate limiter on the viewers' side lets through
const UPLOAD_CAP = 1 // uploads a second one on the uploaders' side lets through

const TIMELINE: NonNullable<BuildTask['timeline']> = {
  phases: [
    { name: 'A quiet morning', from: 0 },
    { name: 'A burst of uploads', from: T(8) },
    { name: 'A transcoder crashes', from: T(12) },
    { name: 'Quiet again', from: T(18) },
    { name: 'A long film', from: T(26) },
    { name: 'A premiere', from: T(40) },
    { name: 'Afterwards', from: T(54) },
  ],
  end: SCALE_SETTLED,
}

export const videoOf = new WeakMap<FlowSim, Video>()

const seeded = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// Requests travel left to right. A queue or a CDN that stands level with or right of
// the transcoder or origin it should come before has nothing to work with.
function outOfOrder(raw: Placement) {
  const bad = Object.entries(raw).flatMap(([id, kind]) => {
    if (kind === 'cache' && POS[id].x >= ORIGIN_AT.x) return [{ id, why: 'The CDN has to stand in front of the origin, so that most plays are answered before they reach it. Here it does not.' }]
    if (kind === 'queue' && POS[id].x >= ENC_AT.x) return [{ id, why: 'The queue has to stand in front of the transcoders, to hold uploads for them. Here it does not.' }]
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
    cdn: on('cache'),
    autoscale: !!on('autoscaler'),
    encoders: ['enc-0', ...all('app')],
    // A rate limiter guards the lane it stands in: viewers' below the middle line, uploaders' above it.
    limits: Object.entries(raw)
      .filter(([, k]) => k === 'limiter')
      .map(([id]): Limit => (POS[id].z > 0 ? { key: id, lane: 'watch', rate: WATCH_CAP } : { key: id, lane: 'upload', rate: UPLOAD_CAP })),
    extras: Object.values(raw).filter((k) => k === 'breaker' || k === 'ring').length,
    jam: outOfOrder(raw),
  }
}

export function chosen(settings: Settings) {
  return { chunks: settings.chunks === 1, qualities: settings.quality === 1, popularOnly: settings.cache === 1, shield: settings.shield === 1 }
}

interface Mode {
  phases: Phase[]
  films: number[]
  hard: boolean // long films, a crash, slow networks, a premiere
}

function assemble(raw: Placement, settings: Settings, mode: Mode, rng?: () => number) {
  const l = layout(raw)
  // The first design has no such choices: it only asks whether the work gets done.
  const s = mode.hard ? chosen(settings) : { chunks: true, qualities: false, popularOnly: true, shield: false }
  const video = new Video(rng ?? seeded(7), {
    encoders: l.encoders,
    queue: l.queue,
    cdn: l.cdn,
    limits: l.limits,
    autoscale: l.autoscale,
    chunks: s.chunks,
    qualities: s.qualities,
    popularOnly: s.popularOnly,
    shield: s.shield,
    phases: mode.phases,
    films: mode.films,
    crash: mode.hard ? CRASH : undefined,
    jam: l.jam?.ids,
  })
  videoOf.set(video.flow, video)
  return video.flow
}

// The checks a finished design must pass. Shown live; the win needs all green.
const watching = (deadline: number): Requirement => ({
  label: 'Watching',
  says: `Every play starts in under ${WAIT_LIMIT} seconds on average. No more than ${FAIL_LIMIT} plays turned away in all.`,
  read: (flow) => {
    const v = videoOf.get(flow)
    if (!v) return { text: '', ok: true }
    const slow = flow.tick >= T(16) && v.wait() > WAIT_LIMIT
    const text = v.tally.failed > 0 ? `${v.tally.failed} turned away` : `${v.wait().toFixed(2)} s`
    return { text, ok: v.tally.failed <= FAIL_LIMIT && !slow && (flow.tick < deadline || v.tally.played > 0) }
  },
})
const smooth: Requirement = {
  label: 'Smooth',
  says: `At most ${Math.round(BUFFER_LIMIT * 100)} in 100 plays may stall, on a fast network or a slow one.`,
  read: (flow) => {
    const v = videoOf.get(flow)
    if (!v) return { text: '', ok: true }
    const share = v.buffering()
    return { text: share === 0 ? 'no stalls' : `${Math.round(share * 100)}% stall`, ok: v.tally.played < 40 || share <= BUFFER_LIMIT }
  },
}
const ready: Requirement = {
  label: 'Ready',
  says: `An upload must be ready to watch within ${READY_LIMIT} seconds, a long film too.`,
  read: (flow) => {
    const v = videoOf.get(flow)
    if (!v) return { text: '', ok: true }
    return { text: `${v.slowest().toFixed(1)} s`, ok: v.slowest() <= READY_LIMIT }
  },
}
const uploads: Requirement = {
  label: 'Uploads',
  says: 'No upload may be lost on its way, even when a transcoder crashes.',
  read: (flow) => {
    const n = videoOf.get(flow)?.tally.lost ?? 0
    return { text: n === 0 ? 'none lost' : `${n} lost`, ok: n === 0 }
  },
}

const BRIEF = {
  title: 'The brief',
  lines: [
    'A video site lets anyone upload a video and lets everyone else watch it, on any phone, on any network, right away.',
    'Build one. Uploads must be turned into a form every device can play. Viewers press play and the video must start.',
    'Plan for 100 million people who watch an hour a day, and a million videos uploaded a day. A few videos are watched by millions, and a new one can be watched by millions the moment it appears.',
    'A video must start fast and not stall, and an upload must not take long to be ready, or get lost.',
  ],
}

const FIXED = [
  { id: 'uploaders', kind: 'users' as const, ...UPLOADERS_AT },
  { id: 'viewers', kind: 'users' as const, ...VIEWERS_AT },
  { id: 'enc-0', kind: 'app' as const, ...ENC_AT },
  { id: 'origin', kind: 'app' as const, ...ORIGIN_AT },
  { id: 's0', kind: 'database' as const, ...STORE_AT },
]
const LABELS = [
  { at: [UPLOADERS_AT.x, 1.6, UPLOADERS_AT.z] as [number, number, number], text: 'Uploaders' },
  { at: [VIEWERS_AT.x, 1.6, VIEWERS_AT.z] as [number, number, number], text: 'Viewers' },
  { at: [ENC_AT.x, 1.6, ENC_AT.z] as [number, number, number], text: 'Transcoder' },
  { at: [ORIGIN_AT.x, 1.6, ORIGIN_AT.z] as [number, number, number], text: 'Origin' },
  { at: [STORE_AT.x, 2.2, STORE_AT.z] as [number, number, number], text: 'Video store' },
]
const NAMES: BuildTask['names'] = { app: 'Transcoder', queue: 'Upload queue', cache: 'CDN', autoscaler: 'Autoscaler' }
const PIECE_HINTS: BuildTask['hints'] = {
  app: 'turns an upload into the forms a phone can play',
  queue: 'holds uploads until a transcoder is free',
  cache: 'keeps the videos people watch close to them',
  autoscaler: 'adds transcoders when uploads pile up',
  limiter: 'lets only so many requests a second through',
  breaker: 'stops calling a service that keeps failing',
  ring: 'gives each key to one machine',
}

const SETTINGS = [
  { id: 'chunks', label: 'a long video is transcoded', when: 'app' as const, min: 0, max: 1, step: 1, initial: 0, options: ['Whole, on one transcoder', 'In short segments, in parallel'],
    tradeoffs: [
      { gain: 'Simple: one job per video.', cost: 'A long video takes as long as one transcoder needs.' },
      { gain: 'Many transcoders share a long video.', cost: 'Segments must be split, tracked and joined.' },
    ],
  },
  { id: 'quality', label: 'every video is made in', when: 'app' as const, min: 0, max: 1, step: 1, initial: 0, options: ['One quality', 'Several qualities'],
    tradeoffs: [
      { gain: 'Least transcoding and storage.', cost: 'Slow connections stall, and fast ones get no better picture.' },
      { gain: 'Each viewer gets a quality their connection keeps up with.', cost: 'More transcoding and storage per video.' },
    ],
  },
  { id: 'cache', label: 'the CDN keeps', when: 'cache' as const, min: 0, max: 1, step: 1, initial: 0, options: ['Every video watched', 'Only videos watched again soon'],
    tradeoffs: [
      { gain: 'Anything watched once is close by.', cost: 'Rarely watched videos push out popular ones.' },
      { gain: 'Space goes to videos people come back to.', cost: 'A first view of anything goes back to the source.' },
    ],
  },
  { id: 'shield', label: 'a CDN edge that lacks a video asks', when: 'cache' as const, min: 0, max: 1, step: 1, initial: 0, options: ['The origin', 'One shared cache first'],
    tradeoffs: [
      { gain: 'One hop fewer on a miss.', cost: 'Every edge that misses asks the origin itself.' },
      { gain: 'Edges share one copy, so the origin is asked once.', cost: 'An extra hop on every miss.' },
    ],
  },
]

function decorate(flow: FlowSim, raw: Placement) {
  const v = videoOf.get(flow)
  if (!v) return null
  const l = layout(raw)
  const hard = v.cfg.crash !== undefined
  const out = [createElement(Tag, { key: 'phase', at: [UPLOADERS_AT.x, 2.4, UPLOADERS_AT.z], label: hard ? (TIMELINE.phases.filter((p) => p.from <= flow.tick).pop()?.name ?? '') : 'A busy hour' })]
  for (const id of l.jam?.ids ?? []) out.push(createElement(Tag, { key: `jam-${id}`, at: [POS[id].x, 1.8, POS[id].z], label: 'Stops here', danger: true }))
  const enc = v.fleet[0]
  out.push(createElement(Tag, { key: 'workers', at: [ENC_AT.x, 2.7, ENC_AT.z], label: `${v.running()} transcoder${v.running() === 1 ? '' : 's'} running`, danger: !enc.alive }))
  const backlog = v.backlog()
  if (backlog > 0) out.push(createElement(Tag, { key: 'backlog', at: [ENC_AT.x, 3.3, ENC_AT.z], label: `${backlog} tasks waiting`, danger: backlog > 40 }))
  const load = v.originLoad()
  out.push(createElement(Tag, { key: 'origin', at: [ORIGIN_AT.x, 2.4, ORIGIN_AT.z], label: `Origin ${Math.round(load * 100)}% full`, danger: load > 0.75 }))
  if (l.cdn) out.push(createElement(Tag, { key: 'cdn', at: [POS[l.cdn].x, 1.6, POS[l.cdn].z], label: `${Math.round(v.hitRatio() * 100)}% answered here` }))
  const store = v.storeLoad()
  out.push(createElement(Tag, { key: 'store', at: [STORE_AT.x, 3.0, STORE_AT.z], label: `Store ${Math.round(store * 100)}% full`, danger: store > 0.75 }))
  return out
}

function common(): Pick<BuildTask, 'pinned' | 'manualStart' | 'rps' | 'shot' | 'fixed' | 'labels' | 'decorate' | 'hints' | 'names' | 'failFast' | 'anywhere' | 'replies'> {
  return {
    pinned: BRIEF,
    manualStart: true,
    replies: (job) => job.from === 'play',
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
function symptom(v: Video): Diagnosis | null {
  const t = v.tally
  if (t.lost > 0) return { because: `Some uploads were lost.${t.limited ? ' Some were turned away by a rate limiter.' : ''}`, look: 'Where does an upload wait while it is being processed, and what happens if that place is full?' }
  if (t.failed > FAIL_LIMIT) return { because: `Some plays were turned away.${t.limited ? ' Some were turned away by a rate limiter.' : ''}`, look: 'Which part fills up when plays start, and where do the videos come from?' }
  if (v.slowest() > READY_LIMIT) return { because: 'An upload has waited too long to be ready.', look: 'How many processing tasks does each upload make, and who works through them?' }
  if (v.wait() > WAIT_LIMIT) return { because: 'Some plays take too long to start.', look: 'Where does a play get its video from, and how far away is it?' }
  if (v.tally.played >= 40 && v.buffering() > BUFFER_LIMIT) return { because: 'Some plays stalled in the middle.', look: 'Is the video arriving as fast as it is watched?' }
  return null
}

// Stage 2: an ordinary hour, and the new idea: keep the popular videos close to the viewers.
export const FIRST_DESIGN: BuildTask = {
  ...common(),
  title: 'First design: a busy hour.',
  sub: 'Get every upload turned into something playable, and every play started fast. Changing anything restarts the run.',
  goal: 'Start every play in under a second, and make every upload ready within 12 seconds.',
  goalShort: 'Fast plays · uploads ready',
  win: 'Put a CDN in front of the origin, so the popular videos are answered close to the viewer. Put a queue in front of the transcoder, so uploads wait their turn instead of being turned away.',
  holdSeconds: 4,
  testSeconds: 36,
  pads: FIRST_SPOTS.map(spot),
  toolbox: [
    { kind: 'queue', count: 1 },
    { kind: 'cache', count: 1 },
  ],
  watch: [{ kind: 'busy', key: 'origin', label: 'Origin busy' }],
  requirements: [watching(FIRST_SETTLED), ready, uploads],
  assemble: (placed, settings, rng) => assemble(placed, settings, { phases: FIRST_PHASES, films: [], hard: false }, rng),
  diagnose(_m, raw, _settings, flow) {
    const v = videoOf.get(flow)
    if (!v) return null
    const l = layout(raw)
    if (l.jam) return { because: l.jam.why, look: ORDER_LOOK }
    return symptom(v)
  },
  problem: (m, raw, settings, flow) => FIRST_DESIGN.diagnose!(m, raw, settings, flow)?.because ?? null,
  hint: (_m, raw, settings) => hintFromReview(review(raw, settings).lines, ['CDN', 'Upload queue'], false),
  check(_m, _raw, _settings, flow) {
    const v = flow && videoOf.get(flow)
    if (!v || flow.tick < FIRST_SETTLED) return false
    return v.tally.failed <= FAIL_LIMIT && v.tally.lost === 0 && v.wait() <= WAIT_LIMIT && v.slowest() <= READY_LIMIT && v.tally.played > 0
  },
}

// Stage 3: the real day. Each phase brings a new way to fail.
export const SCALE_UP: BuildTask = {
  ...common(),
  title: 'Where it breaks: a premiere.',
  sub: 'A burst of uploads, a crash, a long film and a premiere. Watch the numbers, then tune it.',
  goal: 'Get through the whole day: every play smooth, every upload ready, nothing lost.',
  goalShort: 'Survive the whole day',
  win: 'A queue and an autoscaler for the uploads. Cut long videos into segments, and make several qualities. A CDN that keeps only videos watched again soon, and asks one shared cache before the origin.',
  holdSeconds: 4,
  testSeconds: 66,
  pads: ALL_SPOTS.map(spot),
  toolbox: [
    { kind: 'queue', count: 1 },
    { kind: 'autoscaler', count: 1 },
    { kind: 'cache', count: 1 },
    { kind: 'app', count: 2 },
    { kind: 'limiter', count: 1 },
    { kind: 'breaker', count: 1 },
    { kind: 'ring', count: 1 },
  ],
  timeline: TIMELINE,
  settings: SETTINGS,
  watch: [{ kind: 'busy', key: 'origin', label: 'Origin busy' }],
  requirements: [watching(SCALE_SETTLED), smooth, ready, uploads],
  assemble: (placed, settings, rng) => assemble(placed, settings, { phases: SCALE_PHASES, films: FILMS, hard: true }, rng),
  diagnose(_m, raw, _settings, flow) {
    const v = videoOf.get(flow)
    if (!v) return null
    const l = layout(raw)
    if (l.jam) return { because: l.jam.why, look: ORDER_LOOK }
    return symptom(v)
  },
  problem: (m, raw, settings, flow) => SCALE_UP.diagnose!(m, raw, settings, flow)?.because ?? null,
  hint: (_m, raw, settings) => hintFromReview(review(raw, settings).lines, undefined, false),
  check(_m, _raw, _settings, flow) {
    const v = flow && videoOf.get(flow)
    if (!v || flow.tick < SCALE_SETTLED) return false
    return v.tally.failed <= FAIL_LIMIT && v.tally.lost === 0 && v.wait() <= WAIT_LIMIT && v.slowest() <= READY_LIMIT && v.buffering() <= BUFFER_LIMIT && v.tally.played > 0
  },
}

function review(raw: Placement, settings: Settings): Review {
  const l = layout(raw)
  const s = chosen(settings)
  return {
    lines: [
      { label: 'Upload queue', yours: l.queue ? 'A queue in front of the transcoders' : 'None', reference: 'A queue in front of the transcoders', why: 'Uploads come in bursts. A queue holds the work while transcoders catch up, and gives back a task a crashed transcoder was holding, so nothing is lost.', ok: !!l.queue },
      { label: 'Autoscaler', yours: l.autoscale ? 'Transcoders are added when uploads pile up' : `${l.encoders.length} transcoder${l.encoders.length > 1 ? 's' : ''}, always`, reference: 'An autoscaler on the queue', why: 'A burst of uploads needs many transcoders for a short time. Paying for them all day is wasteful, so add them while the queue is long and remove them when it is empty.', ok: l.autoscale },
      { label: 'Long videos', yours: s.chunks ? 'Cut into segments, in parallel' : 'Whole, on one transcoder', reference: 'Cut into short segments, in parallel', why: 'A two-hour film on one transcoder takes hours. Cut into segments, every free transcoder takes a few, and it is ready in minutes. Segments are also what the player downloads.', ok: s.chunks },
      { label: 'Qualities', yours: s.qualities ? 'Several qualities' : 'One quality', reference: 'Several qualities', why: 'A phone on a slow network cannot play a video made for fast ones, so it stalls. With several qualities the player picks the best one it can download, and changes as the network does. This costs more transcoding and storage.', ok: s.qualities },
      { label: 'CDN', yours: l.cdn ? 'A CDN in front of the origin' : 'None', reference: 'A CDN in front of the origin', why: 'Most plays are for the same few videos. A CDN keeps them close to viewers and answers them without the origin, which would otherwise carry every viewer.', ok: !!l.cdn },
      { label: 'What the CDN keeps', yours: s.popularOnly ? 'Only videos watched again soon' : 'Every video watched', reference: 'Only videos watched again soon', why: 'Most videos are watched once, and an edge has room for few. If it keeps all of them, the rare ones push the popular ones out.', ok: s.popularOnly },
      { label: 'Shared cache', yours: s.shield ? 'Edges ask one shared cache first' : 'Edges ask the origin', reference: 'Edges ask one shared cache first', why: 'A new video is on no edge. If every edge asks the origin for it at once, the origin gets thousands of the same request. A shared cache asks the origin once and hands the answer to all.', ok: s.shield },
      { label: 'Extras', yours: l.limits.length + l.extras ? 'Pieces this system does not need' : 'Only what is needed', reference: 'No limiter, breaker or hash ring', why: 'A rate limiter turns real viewers and uploads away. A breaker guards calls to a failing service, and nothing here calls one. A hash ring has nothing to place.', ok: l.limits.length + l.extras === 0 },
    ],
    tradeoffs: [
      'More qualities mean more transcoding work and more storage for every video, for the sake of viewers on slow networks.',
      'A shared cache adds a hop to every miss, and it must be big. It is worth it when many edges ask for the same new video.',
      'An autoscaler takes a few seconds to add a transcoder. For the first seconds of a burst the queue absorbs the work, so uploads are slower, not lost.',
      'Segments let a film use many transcoders, but each one must be joined and listed in a manifest file the player reads. Short segments mean more requests, long segments mean slower starts.',
    ],
    interview: [
      'Clarify: upload size and length, live or recorded, qualities and devices, regions, how soon an upload must be watchable, and whether there are recommendations.',
      'Estimate: 100 million people watching an hour a day at 3 Mbps is about 12 Tbps at once. A million 10-minute videos a day in several qualities is about 35,000 transcoders busy all day.',
      'Design: uploads go to object storage, a queue feeds transcoders that cut the video into segments in several qualities, and a CDN serves the segments. The player picks the quality it can download.',
      'Scale: autoscale transcoders on the queue length, put a shared cache between the CDN edges and the origin, and keep only popular videos on the edges.',
      'Failures: a crashed transcoder returns its task to the queue. A premiere is a thundering herd, so warm the caches ahead of time or collapse requests for the same video.',
    ],
  }
}

// The opening: a tiny site, from an upload to a play.
const INTRO_FIXED = [
  { id: 'uploaders', kind: 'users' as const, x: -8, z: -3 },
  { id: 'viewers', kind: 'users' as const, x: -8, z: 3 },
  { id: 'enc-0', kind: 'app' as const, x: -3.4, z: -3 },
  { id: 'origin', kind: 'app' as const, x: -3.4, z: 3 },
  { id: 's0', kind: 'database' as const, x: 2.4, z: 0 },
]
export const INTRO: Intro = {
  task: {
    title: 'How a video site works',
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
      const video = new Video(rng ?? seeded(3), {
        encoders: ['enc-0'],
        limits: [],
        autoscale: false,
        chunks: true,
        qualities: true,
        popularOnly: true,
        shield: false,
        phases: [{ from: 0, plays: 1, uploads: 0.4 }],
        films: [],
      })
      videoOf.set(video.flow, video)
      return video.flow
    },
    check: () => false,
  },
  steps: [
    { say: 'Joe uploads a video filmed on a phone. It is large, and made for one phone only.', at: 'uploaders', label: 'Joe' },
    { say: 'A transcoder turns it into smaller files in several qualities, so any phone on any network can play it.', at: 'enc-0', label: 'Transcoder' },
    { say: 'The finished files are kept in the video store, cut into short segments a few seconds long.', at: 's0', label: 'Video store' },
    { say: 'Someone presses play. The origin reads the first segments from the store and sends them on, one after another.', at: 'origin', label: 'Origin' },
    { say: 'The video starts. Easy for one viewer. Now picture millions at once, and a new video everyone wants to watch.' },
  ],
  start: 'Take the challenge →',
}

export const VIDEO_STREAMING: Capstone = {
  id: 'video-streaming',
  title: 'Video streaming',
  stages: ['Requirements', 'First design', 'Where it breaks', 'Final review'],
  intro: INTRO,
  goals: ['Fast start', 'Never stalls', 'Uploads ready fast', 'Survive a premiere'],
  brief: BRIEF,
  estimate: {
    intro: 'Before drawing anything, work out how big this is. A few quick numbers decide the design.',
    summary: { title: 'About 12 Tbps to serve, and 35,000 transcoders busy all day.', body: 'Serving is the huge number: no origin carries it, so a CDN must answer nearly every play. Transcoding is the other: it is slow, bursty work, so queue it, cut it into pieces and add machines when the queue grows. And a new video that millions want at once is on no cache yet.' },
    questions: [
      { question: '100 million people watch an hour a day, at 3 Mbps. About how much bandwidth is in use on average?', options: ['About 125 Gbps', 'About 12 Tbps', 'About 1.2 Pbps'], answer: 1, at: 'viewers', show: '12 Tbps', why: 'An hour a day is one in 24 people watching at any moment: about 4 million. 4 million × 3 Mbps is about 12 Tbps. No single origin can send that, so a CDN has to.' },
      { question: 'A million videos are uploaded a day, each 100 MB. About how much new storage a day, before any qualities?', options: ['About 10 TB', 'About 100 TB', 'About 1 PB'], answer: 1, at: 's0', show: '100 TB / day', why: '1 million × 100 MB is 100 TB. The qualities made from each add about twice that again, so around 300 TB a day, over 100 PB a year.' },
      { question: 'Each video is 10 minutes and takes about 10 minutes to transcode in each of 5 qualities. About how many transcoders are busy all day?', options: ['About 350', 'About 3,500', 'About 35,000'], answer: 2, at: 'enc-0', show: '35,000 transcoders', why: '1 million × 5 × 10 minutes is 50 million minutes of work a day. A day has 1,440 minutes, so about 35,000 transcoders. Autoscaling keeps them busy only when there is work.' },
      { question: 'The CDN answers 95 of every 100 plays, from 12 Tbps. About how much still reaches the origin?', options: ['About 60 Gbps', 'About 600 Gbps', 'About 6 Tbps'], answer: 1, at: 'origin', show: '600 Gbps', why: '5% of 12 Tbps is 600 Gbps. Even a good CDN leaves the origin a lot, so every extra point of hit rate matters, and a shared cache in front of the origin helps.' },
      { question: 'A film is two hours long and is cut into segments of 10 seconds. About how many segments?', options: ['About 72', 'About 720', 'About 7,200'], answer: 1, at: 'uploaders', show: '720 segments', why: '7,200 seconds ÷ 10 is 720. Each is a separate task, so 720 transcoders could work on one film at once, and the player downloads them one at a time.' },
    ],
  },
  first: FIRST_DESIGN,
  scale: SCALE_UP,
  review,
}
