import { createElement } from 'react'
import { ORDER_LOOK, hintFromReview } from '../../core/build/hint'
import { Tag } from '../../core/iso/primitives'
import type { BuildTask, Diagnosis, Placement, Requirement, Settings } from '../../core/build/types'
import type { FlowSim } from '../../core/flow/engine'
import type { Capstone, Intro, Review } from '../../core/capstone/types'
import { jitter, seeded } from '../../core/build/day'
import { BATCH, BIG_MB, CHUNKS_PER_TICK, COPY_MB, Dropbox, EDIT_MB, FILE_MB, MB_PER_TICK, META_SLOTS, NOTIFY_PER, SECOND, SHARD_SLOTS, SHIFT_MB, STORM_MEMBERS, type Limit, type Phase } from './dropbox'

// The design board: laptops and the other devices on the left. The learner places every machine:
// metadata servers on the laptops' side (above the middle line), notifiers on the devices' side
// (below it), the change queue between them, and the shards of the block store on the right.
const LAPTOPS_AT = { x: -8.8, z: -4.4 }
const DEVICES_AT = { x: -8.8, z: 4.4 }
const STORE_AT = { x: 4.4, z: 0 }
// Stage 3 has exactly as many pads as the reference design has pieces (a queue, two metadata
// servers, three notifiers and three shards), and more pieces in the toolbox than that.
const POS: Record<string, { x: number; z: number }> = {
  m1: { x: -5.2, z: -4.4 },
  m2: { x: -5.2, z: -2.2 },
  q1: { x: -5.2, z: 0 },
  n1: { x: -1.6, z: 4.4 },
  n2: { x: -1.6, z: 2.2 },
  n3: { x: 1.4, z: 4.4 },
  s1: { x: 4.4, z: -2.2 },
  s2: { x: 4.4, z: 0 },
  s3: { x: 4.4, z: 2.2 },
}
const FIRST_SPOTS = ['m1', 'q1', 'n1', 's2']
const ALL_SPOTS = Object.keys(POS)
const spot = (id: string) => ({ id, ...POS[id], accepts: [] })

const T = (s: number) => s * SECOND

// The first design: an ordinary busy hour, a big file edited, and a team folder that changes at once.
const FIRST_PHASES: Phase[] = [
  { from: 0, saves: 6 },
  { from: T(8), saves: 10 },
]
const FIRST_BIGS = [T(10)]
const TEAM_MEMBERS = 80
const FIRST_STORMS = [T(14), T(14), T(14), T(14)]
export const FIRST_SETTLED = T(30)

// The real day: a quiet morning, big files, a file everyone uploads, a line added at the top of
// many files, a rack that loses power, and a shared folder with hundreds of devices.
const SCALE_PHASES: Phase[] = [
  { from: 0, saves: 12 },
  { from: T(16), saves: 12, copies: 5 },
  { from: T(24), saves: 12 },
  { from: T(30), saves: 12, shifts: 4 },
  { from: T(38), saves: 12 },
]
const BIGS_AT = [T(8), T(8) + 6, T(8) + 12]
const CRASH_AT = T(44)
const CRASH_DOWN = T(6)
const STORMS_AT = [T(56), T(56) + 6, T(56) + 12, T(57), T(57) + 6, T(57) + 12]
export const SCALE_SETTLED = T(66)

// Every run is a slightly different day: busier by up to a fifth, and the crash a few seconds
// later. Each stays inside its own part of the day, so the strip above the board still reads true.
function scaleDay(rng: () => number): Omit<Mode, 'hard'> {
  const load = jitter(rng, 1, 0.2)
  const crash = Math.floor(jitter(rng, 0, 3) * SECOND)
  return {
    phases: SCALE_PHASES.map((p, i) => (i === 0 ? p : { ...p, saves: p.saves * load })),
    bigs: BIGS_AT,
    storms: STORMS_AT,
    crash: { at: CRASH_AT + crash, down: CRASH_DOWN, shards: 2 },
  }
}

const REF_CHUNK = 4
const CHUNK_FROM = 2 // smaller, and the metadata servers drown in chunk lists
const CHUNK_TO = 8 // larger, and a one-line edit sends too much
const REF_COPIES = 3
const NEED_METAS = 2
const NEED_NOTIFIERS = 3
const NEED_SHARDS = 3
const SAVE_LIMIT = 6 // seconds a save may take to be safe
const SYNC_LIMIT = 6 // seconds the other devices may take to catch up
const LOSS_LIMIT = 0
const UPLOAD_CAP = 10 // saves a second a rate limiter on the laptops' side lets through
const NOTICE_CAP = 8 // notices a second one on the devices' side lets through

const PEAK = SCALE_PHASES[3]
const SHARD_MB_A_SECOND = SHARD_SLOTS * SECOND * MB_PER_TICK
const META_CHUNKS_A_SECOND = META_SLOTS * SECOND * CHUNKS_PER_TICK
const NOTIFIER_A_SECOND = Math.round(SECOND / NOTIFY_PER)

const TIMELINE: NonNullable<BuildTask['timeline']> = {
  phases: [
    { name: 'A quiet morning', from: 0 },
    { name: 'Big files are edited', from: T(8) },
    { name: 'Everyone uploads one file', from: T(16) },
    { name: 'Quiet again', from: T(24) },
    { name: 'A line added to many files', from: T(30) },
    { name: 'Calm', from: T(38) },
    { name: 'A rack loses power', from: T(44) },
    { name: 'A shared folder changes', from: T(56) },
    { name: 'Calm again', from: T(60) },
  ],
  end: SCALE_SETTLED,
}

export const dropboxOf = new WeakMap<FlowSim, Dropbox>()

// Requests travel left to right. A queue that stands level with or right of the notifiers it
// feeds has nothing to work with.
function outOfOrder(raw: Placement) {
  const apps = Object.entries(raw).filter(([, k]) => k === 'app').map(([id]) => id)
  const notifiers = apps.filter((id) => POS[id].z > 0)
  const bad = Object.entries(raw).flatMap(([id, kind]) => {
    if (kind === 'queue' && notifiers.some((n) => POS[n].x <= POS[id].x)) return [{ id, why: 'The change queue has to stand in front of the notifiers, to hold notices for them. Here it does not.' }]
    return []
  })
  return bad.length ? { ids: bad.map((b) => b.id), why: bad[0].why } : null
}

// Which parts are on the floor, and where. A piece can go on any spot, so what it does comes from its kind.
function layout(saved: Placement) {
  const raw: Placement = Object.fromEntries(Object.entries(saved).filter(([id]) => id in POS))
  const on = (kind: string) => Object.entries(raw).find(([, k]) => k === kind)?.[0]
  const all = (kind: string) => Object.entries(raw).filter(([, k]) => k === kind).map(([id]) => id).sort()
  return {
    queue: on('queue'),
    // An app on the laptops' side keeps the file lists. One on the devices' side tells the devices.
    metas: all('app').filter((id) => POS[id].z <= 0),
    notifiers: all('app').filter((id) => POS[id].z > 0),
    shards: all('database'),
    // A rate limiter guards the lane it stands in: laptops' above the middle line, devices' below it.
    limits: Object.entries(raw)
      .filter(([, k]) => k === 'limiter')
      .map(([id]): Limit => (POS[id].z > 0 ? { key: id, lane: 'notify', rate: NOTICE_CAP } : { key: id, lane: 'save', rate: UPLOAD_CAP })),
    extras: Object.values(raw).filter((k) => k === 'breaker' || k === 'ring').length,
    jam: outOfOrder(raw),
  }
}

// What a bare board is missing before anything can be served at all.
function missing(l: ReturnType<typeof layout>): Diagnosis | null {
  const look = 'Every lane of the system needs a machine. Which lane has none?'
  if (!l.metas.length) return { because: 'Nothing keeps the list of chunks of each file. The laptops’ side has no machine.', look }
  if (!l.notifiers.length) return { because: 'Nothing tells the other devices that a file changed. The devices’ side has no machine.', look }
  if (!l.shards.length) return { because: 'The chunks are kept nowhere. The block store has no shard.', look }
  return null
}

export function chosen(settings: Settings) {
  return {
    chunk: settings.chunk ?? 128,
    content: settings.content === 1,
    dedupe: settings.dedupe === 1,
    copies: settings.copies ?? 1,
    batch: settings.batch === 1,
  }
}

interface Mode {
  phases: Phase[]
  bigs: number[]
  storms: number[]
  crash?: { at: number; down: number; shards: number }
  hard: boolean // the real day, with its settings
}

function assemble(raw: Placement, settings: Settings, mode: Mode, rng?: () => number) {
  const l = layout(raw)
  // The first design has no such choices: it only asks whether the work gets done.
  const s = mode.hard ? chosen(settings) : { chunk: REF_CHUNK, content: true, dedupe: true, copies: REF_COPIES, batch: true }
  const site = new Dropbox(rng ?? seeded(7), {
    metas: l.metas,
    notifiers: l.notifiers,
    shards: l.shards,
    queue: l.queue,
    limits: l.limits,
    ...s,
    phases: mode.phases,
    bigs: mode.bigs,
    storms: mode.storms,
    stormMembers: mode.hard ? STORM_MEMBERS : TEAM_MEMBERS,
    crash: mode.crash,
    jam: l.jam?.ids,
  })
  dropboxOf.set(site.flow, site)
  return site.flow
}

// The checks a finished design must pass. Shown live; the win needs all green.
const saving = (deadline: number): Requirement => ({
  label: 'Saving',
  says: `Every save must be safe in the store within ${SAVE_LIMIT} seconds, a big file too.`,
  read: (flow) => {
    const d = dropboxOf.get(flow)
    if (!d) return { text: '', ok: true }
    const slow = d.slowestSave()
    return { text: `${slow.toFixed(1)} s`, ok: slow <= SAVE_LIMIT && (flow.tick < deadline || d.tally.committed > 0) }
  },
})
const syncing: Requirement = {
  label: 'Syncing',
  says: `Every other device must hold a change within ${SYNC_LIMIT} seconds, even when a folder has hundreds of members.`,
  read: (flow) => {
    const d = dropboxOf.get(flow)
    if (!d) return { text: '', ok: true }
    const slow = d.slowestSync()
    return { text: `${slow.toFixed(1)} s`, ok: slow <= SYNC_LIMIT }
  },
}
const safe: Requirement = {
  label: 'Safe',
  says: 'No change may be lost, no device left without the news, and no file unreadable, even when machines fail.',
  read: (flow) => {
    const t = dropboxOf.get(flow)?.tally
    if (!t) return { text: '', ok: true }
    const text = t.lost > 0 ? `${t.lost} lost` : t.stale > 0 ? `${t.stale} not told` : 'none lost'
    return { text, ok: t.lost <= LOSS_LIMIT && t.stale <= LOSS_LIMIT }
  },
}
const space: Requirement = {
  label: 'Space',
  says: 'The store has room for the whole day.',
  read: (flow) => {
    const d = dropboxOf.get(flow)
    if (!d) return { text: '', ok: true }
    return { text: `${Math.round(d.full() * 100)}% full`, ok: d.full() <= 1 }
  },
}

const BRIEF = {
  title: 'The brief',
  lines: [
    'Dropbox keeps a folder the same on every device a person owns, and on every device of the people they share it with.',
    'Build it. A save on one laptop must reach the store and then every other device, sending as little as possible.',
    'Plan for hundreds of millions of people and a billion changes a day. Files can be huge, many people upload the very same file, and a shared folder can have hundreds of devices.',
    'Nothing may be lost when a machine dies, a save must be quick, other devices must catch up soon, and disks cost money.',
  ],
}

// Stage 3 adds the numbers on the board itself: what the day asks of the machines, in the units they are rated in.
const SCALE_BRIEF = {
  title: BRIEF.title,
  lines: [
    ...BRIEF.lines,
    `On this board, at the busiest: about ${PEAK.saves} edits a second of ${FILE_MB} MB files, each changing about ${EDIT_MB} MB. Big files are ${BIG_MB} MB. A popular file of ${COPY_MB} MB is uploaded again by several people a second. Some days a line is added at the top of ${SHIFT_MB} MB files, and a shared folder has ${STORM_MEMBERS} devices. The board runs all of this scaled down, so the loads and machine counts below are board numbers. Some days are busier.`,
  ],
}

const FIXED = [
  { id: 'laptops', kind: 'users' as const, ...LAPTOPS_AT },
  { id: 'devices', kind: 'users' as const, ...DEVICES_AT },
]
const LABELS = [
  { at: [LAPTOPS_AT.x, 1.6, LAPTOPS_AT.z] as [number, number, number], text: 'Laptops' },
  { at: [DEVICES_AT.x, 1.6, DEVICES_AT.z] as [number, number, number], text: 'Other devices' },
]
const NAMES: BuildTask['names'] = { queue: 'Change queue', database: 'Block shard' }
const PIECE_HINTS: BuildTask['hints'] = {
  queue: 'holds up to 400 change notices until a notifier is free',
  app: `laptops’ side: a metadata server, checks about ${META_CHUNKS_A_SECOND} chunks of file lists a second · devices’ side: a notifier, tells about ${NOTIFIER_A_SECOND} devices a second, or ${NOTIFIER_A_SECOND * BATCH} when notices go in batches`,
  database: `one piece of the block store · writes about ${SHARD_MB_A_SECOND} MB a second, reads twice as fast`,
  limiter: 'lets only so many requests a second through',
  breaker: 'stops calling a service that keeps failing',
  ring: 'gives each key to one machine',
}

const SETTINGS = [
  { id: 'chunk', label: 'A chunk is', when: 'app' as const, min: 1, max: 128, step: 1, initial: 128, slider: { unit: 'MB' } },
  { id: 'content', label: 'Chunks are cut', when: 'app' as const, min: 0, max: 1, step: 1, initial: 0, options: ['Every so many bytes', 'Where the content says'],
    tradeoffs: [
      { gain: 'Simple and fast to cut.', cost: 'One byte added near the start shifts every chunk after it.' },
      { gain: 'An edit changes only the chunks around it.', cost: 'More work to find where to cut.' },
    ],
  },
  { id: 'dedupe', label: 'A chunk the store already has', when: 'database' as const, min: 0, max: 1, step: 1, initial: 0, options: ['Is sent again', 'Is not sent again'],
    tradeoffs: [
      { gain: 'Nothing to check before an upload.', cost: 'The same bytes cross the network and fill the store again.' },
      { gain: 'Known chunks skip the upload.', cost: 'Every chunk is looked up first.' },
    ],
  },
  { id: 'copies', label: 'Every chunk is kept in', when: 'database' as const, min: 1, max: 4, step: 1, initial: 1, slider: { unit: 'copies' } },
  { id: 'batch', label: 'Devices are told', when: 'queue' as const, min: 0, max: 1, step: 1, initial: 0, options: ['One by one', 'In batches'],
    tradeoffs: [
      { gain: 'Each device hears at once.', cost: 'One message per device for every change.' },
      { gain: 'Far fewer messages.', cost: 'A device hears a little later.' },
    ],
  },
]

const WATCH = {
  kind: 'note' as const,
  label: 'Store full',
  read: (flow: FlowSim) => {
    const full = dropboxOf.get(flow)?.full() ?? 0
    return { text: `${Math.round(full * 100)}%`, bad: full > 0.85 }
  },
}

function decorate(flow: FlowSim, raw: Placement) {
  const d = dropboxOf.get(flow)
  if (!d) return null
  const l = layout(raw)
  const hard = d.cfg.crash !== undefined
  const out = [createElement(Tag, { key: 'phase', at: [LAPTOPS_AT.x, 2.4, LAPTOPS_AT.z], label: hard ? (TIMELINE.phases.filter((p) => p.from <= flow.tick).pop()?.name ?? '') : 'A busy hour' })]
  for (const id of l.jam?.ids ?? []) out.push(createElement(Tag, { key: `jam-${id}`, at: [POS[id].x, 1.8, POS[id].z], label: 'Stops here', danger: true }))
  if (l.metas.length) {
    const load = d.metaLoad()
    out.push(createElement(Tag, { key: 'meta', at: [LAPTOPS_AT.x, 3.2, LAPTOPS_AT.z], label: `File lists ${Math.round(load * 100)}% busy`, danger: load > 0.75 }))
  }
  const backlog = d.backlog()
  if (backlog > 0) out.push(createElement(Tag, { key: 'backlog', at: [DEVICES_AT.x, 2.4, DEVICES_AT.z], label: `${backlog} notices waiting`, danger: backlog > 40 }))
  if (l.shards.length) {
    const load = d.storeLoad()
    const down = d.shards.filter((s) => !s.alive).length
    out.push(createElement(Tag, { key: 'store', at: [STORE_AT.x, 3.0, STORE_AT.z], label: down ? `${down} shard${down === 1 ? '' : 's'} down` : `Store ${Math.round(load * 100)}% busy`, danger: down > 0 || load > 0.75 }))
  }
  return out
}

function common(): Pick<BuildTask, 'pinned' | 'manualStart' | 'rps' | 'shot' | 'fixed' | 'labels' | 'decorate' | 'hints' | 'names' | 'failFast' | 'anywhere' | 'replies'> {
  return {
    pinned: BRIEF,
    manualStart: true,
    replies: (job) => job.from === 'pull',
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
function symptom(d: Dropbox): Diagnosis | null {
  const t = d.tally
  const limited = t.limited ? ' Some were turned away by a rate limiter.' : ''
  if (t.lost > 0) return { because: `Some changes were lost, or could not be read back.${limited}`, look: 'How many machines hold a file after a save, and what if two of them lose power together?' }
  if (t.stale > 0) return { because: `Some devices were never told about a change.${limited}`, look: 'Where does a notice wait when every notifier is busy?' }
  if (d.full() > 1) return { because: 'The store ran out of room.', look: 'When the same file is uploaded again and again, how many times are its bytes kept?' }
  if (d.slowestSave() > SAVE_LIMIT) return { because: 'A save has taken too long to be safe.', look: 'How much does a save send when one line of a big file changed, and how many chunk lists does it need?' }
  if (d.slowestSync() > SYNC_LIMIT) return { because: 'Some devices have taken too long to catch up.', look: 'How much work does one change cause when the folder has hundreds of devices?' }
  return null
}

// Stage 2: an ordinary hour, and the new idea: cut files into chunks and send only the ones that changed.
export const FIRST_DESIGN: BuildTask = {
  ...common(),
  title: 'First design: chunks.',
  sub: 'Place a metadata server, a notifier and a shard, then add what helps. Changing anything restarts the run.',
  goal: 'Keep every save safe and let every device catch up, even when a team saves at once.',
  goalShort: 'Saves safe · devices in sync',
  win: 'Put a metadata server on the laptops’ side, a notifier on the devices’ side and a shard of the block store. A queue in front of the notifier holds the notices when a whole team saves at once. Files are cut into chunks, so a small edit sends one chunk, not the file.',
  lesson: {
    without: 'Without a queue, a notifier that is busy turns the next notice away, and a device never hears of the change.',
    choice: 'Cut files into chunks, send only what changed, and queue the notices.',
    cost: 'The price: the metadata servers must keep a list of chunks for every file, and a queue makes the news a little later, not lost.',
  },
  holdSeconds: 4,
  testSeconds: 36,
  pads: FIRST_SPOTS.map(spot),
  toolbox: [
    { kind: 'queue', count: 1 },
    { kind: 'app', count: 2 },
    { kind: 'database', count: 1 },
  ],
  watch: [WATCH],
  result: (_m, _raw, _settings, flow) => {
    const d = dropboxOf.get(flow)
    if (!d) return null
    const t = d.tally
    return `${t.committed.toLocaleString()} saves safe, ${t.synced.toLocaleString()} devices in sync (slowest ${d.slowestSync().toFixed(1)} s), none lost.`
  },
  requirements: [saving(FIRST_SETTLED), syncing, safe],
  assemble: (placed, settings, rng) => assemble(placed, settings, { phases: FIRST_PHASES, bigs: FIRST_BIGS, storms: FIRST_STORMS, hard: false }, rng),
  diagnose(_m, raw, _settings, flow) {
    const d = dropboxOf.get(flow)
    if (!d) return null
    const l = layout(raw)
    return missing(l) ?? (l.jam ? { because: l.jam.why, look: ORDER_LOOK } : null) ?? symptom(d)
  },
  problem: (m, raw, settings, flow) => FIRST_DESIGN.diagnose!(m, raw, settings, flow)?.because ?? null,
  hint: (_m, raw, settings) => hintFromReview(review(raw, settings).lines, ['Change queue'], false),
  check(_m, _raw, _settings, flow) {
    const d = flow && dropboxOf.get(flow)
    if (!d || flow.tick < FIRST_SETTLED) return false
    return d.tally.lost === 0 && d.tally.stale === 0 && d.slowestSave() <= SAVE_LIMIT && d.slowestSync() <= SYNC_LIMIT && d.tally.synced > 0
  },
}

// After a few failed runs: the cause, with the numbers to check it against. It names the weakest link first.
function whyHint(raw: Placement, settings: Settings): string | null {
  const l = layout(raw)
  const s = chosen(settings)
  if (s.chunk < CHUNK_FROM) return `A ${s.chunk} MB chunk means a ${COPY_MB} MB file has ${COPY_MB / s.chunk} chunks, and the metadata servers check about ${META_CHUNKS_A_SECOND} chunks a second each. The file lists drown.`
  if (s.chunk > CHUNK_TO) return `A one-line edit still sends a whole chunk. At ${s.chunk} MB, every edit and every file changed sends ${s.chunk} MB, and the shards write about ${SHARD_MB_A_SECOND} MB a second each.`
  if (!s.content) return `Add a line at the top of a file and every fixed-size chunk after it moves, so none matches the old one. The whole ${SHIFT_MB} MB file is sent again, ${PEAK.shifts} times a second.`
  if (!s.dedupe) return `A file many people upload is ${COPY_MB} MB. Sent again each time, it fills the store and the shards, when the store already has every chunk of it.`
  if (s.copies < REF_COPIES) return 'A rack can lose power and take two shards with it. With fewer than three copies, some chunks live only on those two.'
  if (!l.queue) return 'A shared folder change is one notice per device. With nothing to hold them, a busy notifier turns the next notice away.'
  if (!s.batch) return `A shared folder with ${STORM_MEMBERS} devices needs ${STORM_MEMBERS} notices. A notifier tells about ${NOTIFIER_A_SECOND} devices a second, one by one.`
  if (l.metas.length < NEED_METAS) return `Every save is checked by a metadata server, and each checks about ${META_CHUNKS_A_SECOND} chunks of file lists a second.`
  if (l.notifiers.length < NEED_NOTIFIERS) return `Between the big days the notices still need about ${NEED_NOTIFIERS} notifiers, and each tells about ${NOTIFIER_A_SECOND} devices a second.`
  if (l.shards.length < NEED_SHARDS) return `Three copies of every chunk need three shards, and each writes about ${SHARD_MB_A_SECOND} MB a second.`
  if (l.limits.length) return 'A rate limiter turns away real saves and real notices. Nothing here is an attack to stop.'
  return null
}

// Stage 3: the real day. Each phase brings a new way to fail.
export const SCALE_UP: BuildTask = {
  ...common(),
  pinned: SCALE_BRIEF,
  title: 'Where it breaks: a big day.',
  sub: 'Big files, a file everyone uploads, a line added at the top, a rack that loses power, then a shared folder with hundreds of devices. Every run is a slightly different day. Work out what each lane needs, then build it.',
  goal: 'Get through the whole day: every save safe, every device in sync, nothing lost, the store not full.',
  goalShort: 'Survive the whole day',
  win: `Fill the ${ALL_SPOTS.length} pads with a queue, ${NEED_METAS} metadata servers, ${NEED_NOTIFIERS} notifiers and ${NEED_SHARDS} shards. Cut chunks of ${CHUNK_FROM} to ${CHUNK_TO} MB where the content says, skip chunks the store has, keep ${REF_COPIES} copies of every chunk, and tell devices in batches.`,
  lesson: {
    without: 'Without chunks cut by content, a line added at the top resends the whole file. Without dedupe, a popular file is stored again for everyone. With fewer than three copies, a rack failure loses files.',
    choice: 'Content-defined chunks of a few megabytes, dedupe by hash, three copies, and notices in batches.',
    cost: 'The price: file lists grow with the number of chunks, every copy is more disk, and a batch tells devices a moment later.',
  },
  holdSeconds: 4,
  testSeconds: 70,
  pads: ALL_SPOTS.map(spot),
  toolbox: [
    { kind: 'queue', count: 1 },
    { kind: 'app', count: 6 },
    { kind: 'database', count: 5 },
    { kind: 'limiter', count: 1 },
    { kind: 'breaker', count: 1 },
    { kind: 'ring', count: 1 },
  ],
  timeline: TIMELINE,
  settings: SETTINGS,
  watch: [WATCH],
  freshDay: true,
  requirements: [saving(SCALE_SETTLED), syncing, safe, space],
  assemble: (placed, settings, rng) => {
    const r = rng ?? seeded(7)
    return assemble(placed, settings, { ...scaleDay(r), hard: true }, r)
  },
  diagnose(_m, raw, _settings, flow) {
    const d = dropboxOf.get(flow)
    if (!d) return null
    const l = layout(raw)
    return missing(l) ?? (l.jam ? { because: l.jam.why, look: ORDER_LOOK } : null) ?? symptom(d)
  },
  problem: (m, raw, settings, flow) => SCALE_UP.diagnose!(m, raw, settings, flow)?.because ?? null,
  hint: (_m, raw, settings) => whyHint(raw, settings),
  result: (_m, _raw, _settings, flow) => {
    const d = dropboxOf.get(flow)
    if (!d) return null
    const t = d.tally
    return `${t.committed.toLocaleString()} saves safe, ${t.synced.toLocaleString()} devices in sync, none lost, even when a rack lost power. The store ended ${Math.round(d.full() * 100)}% full.`
  },
  check(_m, _raw, _settings, flow) {
    const d = flow && dropboxOf.get(flow)
    if (!d || flow.tick < SCALE_SETTLED) return false
    return d.tally.lost === 0 && d.tally.stale === 0 && d.slowestSave() <= SAVE_LIMIT && d.slowestSync() <= SYNC_LIMIT && d.full() <= 1 && d.tally.synced > 0
  },
}

function review(raw: Placement, settings: Settings): Review {
  const l = layout(raw)
  const s = chosen(settings)
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`
  return {
    lines: [
      { label: 'Chunk size', yours: `${s.chunk} MB`, reference: `${CHUNK_FROM} to ${CHUNK_TO} MB`, why: 'A one-line edit sends the chunk it touches, so big chunks send too much. But every chunk is an entry in a file list, so very small ones drown the metadata servers.', ok: s.chunk >= CHUNK_FROM && s.chunk <= CHUNK_TO },
      { label: 'Where chunks are cut', yours: s.content ? 'Where the content says' : 'Every so many bytes', reference: 'Where the content says', why: 'Add a line at the top of a file and every fixed-size chunk after it moves, so none matches. If the cuts follow the content, only the chunk around the edit is new.', ok: s.content },
      { label: 'Chunks the store has', yours: s.dedupe ? 'Not sent again' : 'Sent again', reference: 'Not sent again', why: 'Every chunk has a hash. If the store already has it, from this user or another, nothing needs to travel or be stored again. A file everyone uploads costs almost nothing.', ok: s.dedupe },
      { label: 'Copies', yours: `${s.copies} ${s.copies === 1 ? 'copy' : 'copies'}`, reference: `${REF_COPIES} copies`, why: 'A rack can lose power and take two shards with it. With three copies on different shards, a chunk always has one left.', ok: s.copies >= REF_COPIES },
      { label: 'Change queue', yours: l.queue ? 'A queue in front of the notifiers' : 'None', reference: 'A queue in front of the notifiers', why: 'A team saving at once, or a shared folder, makes many notices in a moment. A queue holds them until a notifier is free, and nothing is turned away.', ok: !!l.queue },
      { label: 'Notices', yours: s.batch ? 'In batches' : 'One by one', reference: 'In batches', why: `A shared folder with ${STORM_MEMBERS} devices needs ${STORM_MEMBERS} notices. One by one that is ${Math.round(STORM_MEMBERS * NOTIFY_PER)} ticks of work for a single change. In batches it is ${BATCH} times less.`, ok: s.batch },
      { label: 'Metadata servers', yours: n(l.metas.length, 'server'), reference: `${NEED_METAS} servers`, why: `Every save needs its file list checked and updated, about ${META_CHUNKS_A_SECOND} chunks a second per server. One may be down.`, ok: l.metas.length >= NEED_METAS },
      { label: 'Notifiers', yours: n(l.notifiers.length, 'notifier'), reference: `${NEED_NOTIFIERS} notifiers`, why: `Each tells about ${NOTIFIER_A_SECOND} devices a second one by one, and ${NOTIFIER_A_SECOND * BATCH} in batches. A busy day sends many notices at once.`, ok: l.notifiers.length >= NEED_NOTIFIERS },
      { label: 'Block store', yours: n(l.shards.length, 'shard'), reference: `${NEED_SHARDS} shards`, why: `Each shard writes about ${SHARD_MB_A_SECOND} MB a second. Three copies of a chunk need three different shards.`, ok: l.shards.length >= NEED_SHARDS },
      { label: 'Extras', yours: l.limits.length + l.extras ? 'Pieces this system does not need' : 'Only what is needed', reference: 'No limiter, breaker or hash ring', why: 'A rate limiter turns real saves and notices away. A breaker guards calls to a failing service, and nothing here calls one. A hash ring has nothing to place when chunks already spread by hash.', ok: l.limits.length + l.extras === 0 },
    ],
    tradeoffs: [
      'Small chunks save bandwidth and match more often, but every chunk is a row in the file list. Big chunks are cheap to track and send too much for a small edit. Most systems pick a few megabytes.',
      'Dedupe saves a lot of disk, and it has a privacy side: a client that learns the store already has a hash learns that somebody has the file. Many systems only dedupe inside an account, or check the client really has the bytes.',
      'Three copies cost three times the disk. Erasure coding keeps the same safety for about half the cost, and rebuilding a lost piece is more work.',
      'Batching notices cuts the work, and the last device in a batch hears a moment later than the first.',
    ],
    interview: [
      'Clarify: file sizes, number of devices per user, sharing, how soon devices must be in sync, offline editing, versioning, and what happens when two devices edit the same file.',
      'Estimate: 100 million active users with 10 changes each is a billion changes a day, about 12,000 a second. At one 4 MB chunk each that is about 4 PB a day, and with a third of the chunks already stored and three copies, about 8 PB of disk a day.',
      'Shape: the client cuts a file into chunks and hashes them. A metadata service keeps each file as a list of chunk hashes and says which the block store lacks. Only those are uploaded. A queue carries change notices to a notification service that tells the other devices, which fetch what they lack.',
      'Scale: shard the metadata by user or folder, shard blocks by hash, keep three copies on different racks, and batch notices for large shared folders.',
      'Failures: a crashed shard leaves other copies of every chunk. A lost notice is repaired by a device asking for changes since its last version when it reconnects. Conflicting edits make a conflicted copy.',
    ],
  }
}

// The opening: a tiny site, from a save to the other device.
const INTRO_FIXED = [
  { id: 'laptops', kind: 'users' as const, x: -8, z: -3 },
  { id: 'devices', kind: 'users' as const, x: -8, z: 3 },
  { id: 'meta', kind: 'app' as const, x: -3.4, z: -3 },
  { id: 'notifier', kind: 'app' as const, x: -3.4, z: 3 },
  { id: 's0', kind: 'database' as const, x: 2.4, z: 0 },
]
export const INTRO: Intro = {
  task: {
    title: 'How Dropbox works',
    sub: '',
    goal: '',
    win: '',
    holdSeconds: 1,
    rps: 1,
    shot: { target: [-2.4, 0.8, 0], zoom: 0.85 },
    fixed: INTRO_FIXED,
    labels: [
      { at: [-8, 1.6, -3], text: 'Laptops' },
      { at: [-8, 1.6, 3], text: 'Other devices' },
    ],
    pads: [],
    toolbox: [],
    assemble: (_placed, _settings, rng) => {
      const site = new Dropbox(rng ?? seeded(3), {
        metas: ['meta'],
        notifiers: ['notifier'],
        shards: ['s0'],
        limits: [],
        chunk: REF_CHUNK,
        content: true,
        dedupe: true,
        copies: 1,
        batch: false,
        phases: [{ from: 0, saves: 0.3 }],
        bigs: [],
        storms: [],
        stormMembers: 0,
      })
      dropboxOf.set(site.flow, site)
      return site.flow
    },
    check: () => false,
  },
  steps: [
    { say: 'Joe edits one line of a big file on a laptop (top block). Joe’s phone and other devices (bottom block) must get the change. Sending the whole file again would take minutes.', at: 'laptops', label: 'Joe' },
    { say: 'The laptop cuts the file into chunks and sends the file list to the metadata server. It says which chunks the store lacks.', at: 'meta', label: 'File lists' },
    { say: 'Only the chunk that changed travels. The block store keeps every chunk, copied so one machine dying loses nothing.', at: 's0', label: 'Block store' },
    { say: 'A notifier tells Joe’s other devices that the file changed.', at: 'notifier', label: 'Notifier' },
    { say: 'Each device asks the store for that one chunk and the folder is the same everywhere. Now picture a billion changes a day, a file everybody uploads, and a shared folder with hundreds of devices.' },
  ],
  start: 'Take the challenge →',
}

export const DROPBOX: Capstone = {
  id: 'dropbox',
  title: 'Dropbox',
  stages: ['Requirements', 'First design', 'Where it breaks', 'Final review'],
  intro: INTRO,
  goals: ['Send only what changed', 'Never lose a file', 'Devices in sync', 'Survive a rack failure'],
  brief: BRIEF,
  estimate: {
    intro: 'Before drawing anything, work out how big this is. A few quick numbers decide the design.',
    summary: { title: 'About 12,000 changes a second, and about 8 PB of disk a day.', body: 'Files are cut into chunks so a small edit sends a small chunk. Hashes find chunks the store already has, so the same file is never stored twice. Copies on different machines keep files safe, and a queue with batched notices tells the other devices without drowning the notifiers.' },
    questions: [
      { question: '100 million people each save 10 changes a day. About how many changes a second?', options: ['About 1,200', 'About 12,000', 'About 120,000'], answer: 1, at: 'laptops', show: '12,000 / second', why: '100 million × 10 is a billion changes a day. A day has about 86,000 seconds, so about 12,000 changes a second.' },
      { question: 'Each change sends one 4 MB chunk. About how much data a day?', options: ['About 400 TB', 'About 4 PB', 'About 40 PB'], answer: 1, at: 'meta', show: '4 PB / day', why: 'A billion changes × 4 MB is 4 million GB, or 4 PB, a day.' },
      { question: 'Sending the whole 100 MB file for each change instead, how many times more data is that?', options: ['About 4 times', 'About 25 times', 'About 100 times'], answer: 1, at: 'laptops', show: '25× more', why: '100 MB divided by 4 MB is 25. That is 100 PB a day for the whole-file way, and the reason files are cut into chunks.' },
      { question: 'A third of all chunks are ones the store already has. About how much of the 4 PB a day does the store skip?', options: ['About 130 TB', 'About 1.3 PB', 'About 13 PB'], answer: 1, at: 's0', show: '1.3 PB skipped', why: 'A third of 4 PB is about 1.3 PB that never needs to be sent or stored. Each chunk is found by its hash.' },
      { question: 'The other 2.7 PB are kept in 3 copies. About how much new disk a day?', options: ['About 2.7 PB', 'About 8 PB', 'About 80 PB'], answer: 1, at: 's0', show: '8 PB / day', why: '2.7 PB × 3 copies is about 8 PB of disk a day. Disks are the biggest bill, so dedupe matters, and so does the price of each copy.' },
    ],
  },
  first: FIRST_DESIGN,
  scale: SCALE_UP,
  review,
}

