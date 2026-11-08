import { createElement } from 'react'
import { ORDER_LOOK, hintFromReview } from '../../core/build/hint'
import { Tag } from '../../core/iso/primitives'
import type { BuildTask, Diagnosis, Placement, Requirement, Settings } from '../../core/build/types'
import type { FlowSim } from '../../core/flow/engine'
import type { Capstone, Intro, Review } from '../../core/capstone/types'
import { jitter, seeded } from '../../core/build/day'
import { AWAY_DAYS, BACKLOG, BEATS, DAY_MB, DOT_FAN, GATE_SLOTS, GATE_WORK, GROUP_MEMBERS, HELLOS, JITTER_SECONDS, MEDIA_MB, PUSH_PER, RECEIPT_BATCH, SECOND, SHARD_SLOTS, WhatsApp, type Limit, type Phase } from './whatsapp'

// The design board: phones and the other devices on the left. The learner places every machine:
// gateways on the phones' side (above the middle line), delivery workers on the devices' side
// (below it), the delivery queue between them, the message shards on the right, and a presence
// cache for the online dots.
const PHONES_AT = { x: -8.8, z: -4.4 }
const DEVICES_AT = { x: -8.8, z: 4.4 }
const STORE_AT = { x: 4.4, z: 0 }
// Stage 3 has exactly as many pads as the reference design has pieces (two gateways, a queue,
// three delivery workers, three shards and a cache), and more pieces in the toolbox than that.
const POS: Record<string, { x: number; z: number }> = {
  m1: { x: -5.2, z: -4.4 },
  m2: { x: -5.2, z: -2.2 },
  c1: { x: -1.6, z: -4.4 },
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

// The first design: an ordinary hour, a team group that gets busy, and a phone that comes back.
const FIRST_PHASES: Phase[] = [
  { from: 0, chats: 8 },
  { from: T(8), chats: 12 },
]
const TEAM_MEMBERS = 80
const FIRST_GROUPS = [T(14), T(14), T(14), T(14)]
const FIRST_BACKLOG = { at: T(20), n: 60, days: 2 }
export const FIRST_SETTLED = T(30)

// The real day: a quiet morning, everyone opens the app, a gateway falls, a phone comes back after
// three weeks, and a group goes viral.
const SCALE_PHASES: Phase[] = [
  { from: 0, chats: 20 },
  { from: T(10), chats: 46, dots: 12 },
  { from: T(24), chats: 20 },
]
const CRASH_AT = T(30)
const CRASH_DOWN = T(6)
const BACKLOG_AT = T(40)
const GROUPS_AT = [T(50), T(51), T(52), T(53), T(54), T(55)]
export const SCALE_SETTLED = T(66)

// Every run is a slightly different day: busier by up to a fifth, and the crash a few seconds
// later. Each stays inside its own part of the day, so the strip above the board still reads true.
function scaleDay(rng: () => number): Omit<Mode, 'hard'> {
  const load = jitter(rng, 1, 0.2)
  const crash = Math.floor(jitter(rng, 0, 3) * SECOND)
  return {
    phases: SCALE_PHASES.map((p, i) => (i === 0 ? p : { ...p, chats: p.chats * load })),
    groups: GROUPS_AT,
    crash: { at: CRASH_AT + crash, down: CRASH_DOWN },
    backlogs: [{ at: BACKLOG_AT, n: BACKLOG, days: AWAY_DAYS }],
  }
}

const KEEP_FROM = AWAY_DAYS // a phone can be away this long and still get its messages
const KEEP_TO = 40 // longer, and the shards fill up with messages nobody has fetched
const BEAT_FROM = 5 // faster, and the presence cache cannot take the pings
const BEAT_TO = 10 // slower, and a dead phone looks online for too long
const NEED_GATEWAYS = 2
const NEED_WORKERS = 3
const NEED_SHARDS = 3
const SEND_LIMIT = 3 // seconds a message may take to be stored
const DELIVER_LIMIT = 6 // seconds a message may take to reach the devices
const DEAD_LIMIT = 30 // seconds a dead phone may look online
const LOSS_LIMIT = 0
const SEND_CAP = 40 // messages a second a rate limiter on the phones' side lets through
const NOTICE_CAP = 20 // notices a second one on the devices' side lets through

const PEAK = SCALE_PHASES[1]
const SHARD_A_SECOND = SHARD_SLOTS * SECOND
const GATEWAY_A_SECOND = Math.round((GATE_SLOTS * SECOND) / GATE_WORK)
const WORKER_A_SECOND = SECOND

const TIMELINE: NonNullable<BuildTask['timeline']> = {
  phases: [
    { name: 'A quiet morning', from: 0 },
    { name: 'Everyone opens the app', from: T(10) },
    { name: 'Quiet again', from: T(24) },
    { name: 'A gateway falls', from: T(30) },
    { name: 'Calm', from: T(37) },
    { name: 'A phone comes back after three weeks', from: T(40) },
    { name: 'Calm again', from: T(46) },
    { name: 'A group goes viral', from: T(50) },
    { name: 'Calm', from: T(60) },
  ],
  end: SCALE_SETTLED,
}

export const whatsappOf = new WeakMap<FlowSim, WhatsApp>()

// Requests travel left to right. A queue that stands level with or right of the workers it
// feeds has nothing to work with.
function outOfOrder(raw: Placement) {
  const apps = Object.entries(raw).filter(([, k]) => k === 'app').map(([id]) => id)
  const workers = apps.filter((id) => POS[id].z > 0)
  const bad = Object.entries(raw).flatMap(([id, kind]) => {
    if (kind === 'queue' && workers.some((n) => POS[n].x <= POS[id].x)) return [{ id, why: 'The delivery queue has to stand in front of the delivery workers, to hold notices for them. Here it does not.' }]
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
    cache: on('cache'),
    // An app on the phones' side is a gateway. One on the devices' side pushes messages to the devices.
    gateways: all('app').filter((id) => POS[id].z <= 0),
    workers: all('app').filter((id) => POS[id].z > 0),
    shards: all('database'),
    // A rate limiter guards the lane it stands in: the phones' above the middle line, the devices' below it.
    limits: Object.entries(raw)
      .filter(([, k]) => k === 'limiter')
      .map(([id]): Limit => (POS[id].z > 0 ? { key: id, lane: 'notify', rate: NOTICE_CAP } : { key: id, lane: 'send', rate: SEND_CAP })),
    extras: Object.values(raw).filter((k) => k === 'breaker' || k === 'ring').length,
    jam: outOfOrder(raw),
  }
}

// What a bare board is missing before anything can be served at all.
function missing(l: ReturnType<typeof layout>): Diagnosis | null {
  const look = 'Every lane of the system needs a machine. Which lane has none?'
  if (!l.gateways.length) return { because: 'Nothing takes the messages from the phones. The phones’ side has no machine.', look }
  if (!l.workers.length) return { because: 'Nothing pushes messages to the other devices. The devices’ side has no machine.', look }
  if (!l.shards.length) return { because: 'Messages are kept nowhere. There is no message shard.', look }
  return null
}

export function chosen(settings: Settings) {
  return {
    keep: settings.keep ?? 1,
    groupOnce: settings.group === 1,
    linkMedia: settings.media === 1,
    batch: settings.receipts === 1,
    audience: settings.dots === 1 ? ('open' as const) : ('all' as const),
    beat: settings.beat ?? 1,
    jitter: settings.jitter === 1,
  }
}

interface Mode {
  phases: Phase[]
  groups: number[]
  crash?: { at: number; down: number }
  backlogs: { at: number; n: number; days: number }[]
  hard: boolean // the real day, with its settings
}

function assemble(raw: Placement, settings: Settings, mode: Mode, rng?: () => number) {
  const l = layout(raw)
  // The first design has no such choices: it only asks whether the work gets done.
  const s = mode.hard ? chosen(settings) : { keep: 30, groupOnce: true, linkMedia: true, batch: true, audience: 'open' as const, beat: 1e9, jitter: true }
  const site = new WhatsApp(rng ?? seeded(7), {
    gateways: l.gateways,
    workers: l.workers,
    shards: l.shards,
    cache: l.cache,
    queue: l.queue,
    limits: l.limits,
    ...s,
    phases: mode.phases,
    groups: mode.groups,
    groupMembers: mode.hard ? GROUP_MEMBERS : TEAM_MEMBERS,
    crash: mode.crash,
    backlogs: mode.backlogs,
    jam: l.jam?.ids,
  })
  whatsappOf.set(site.flow, site)
  return site.flow
}

// The checks a finished design must pass. Shown live; the win needs all green.
const sending = (deadline: number): Requirement => ({
  label: 'Sending',
  says: `Every message must be safe on a shard within ${SEND_LIMIT} seconds, so the sender sees the first tick.`,
  read: (flow) => {
    const w = whatsappOf.get(flow)
    if (!w) return { text: '', ok: true }
    const slow = w.slowestStore()
    return { text: `${slow.toFixed(1)} s`, ok: slow <= SEND_LIMIT && (flow.tick < deadline || w.tally.stored > 0) }
  },
})
const delivering: Requirement = {
  label: 'Delivering',
  says: `Every message must reach the other devices within ${DELIVER_LIMIT} seconds, a group message and a long-waiting phone too.`,
  read: (flow) => {
    const w = whatsappOf.get(flow)
    if (!w) return { text: '', ok: true }
    const slow = w.slowestDelivery()
    return { text: `${slow.toFixed(1)} s`, ok: slow <= DELIVER_LIMIT }
  },
}
const safe: Requirement = {
  label: 'Safe',
  says: 'No message may be lost, no receipt left unsent, and no phone left without a connection, even when a machine fails.',
  read: (flow) => {
    const t = whatsappOf.get(flow)?.tally
    if (!t) return { text: '', ok: true }
    const text = t.lost > 0 ? `${t.lost} lost` : t.stale > 0 ? `${t.stale} not told` : 'none lost'
    return { text, ok: t.lost <= LOSS_LIMIT && t.stale <= LOSS_LIMIT }
  },
}
const dots: Requirement = {
  label: 'Online dots',
  says: `A dead phone must stop looking online within ${DEAD_LIMIT} seconds, and no pings may be lost.`,
  read: (flow) => {
    const w = whatsappOf.get(flow)
    if (!w) return { text: '', ok: true }
    const late = w.deadLate()
    return { text: w.tally.beatsLost > 0 ? `${w.tally.beatsLost} pings lost` : `${late} s to notice`, ok: late <= DEAD_LIMIT && w.tally.beatsLost === 0 }
  },
}
const space: Requirement = {
  label: 'Space',
  says: 'The shards have room for the whole day.',
  read: (flow) => {
    const w = whatsappOf.get(flow)
    if (!w) return { text: '', ok: true }
    return { text: `${Math.round(w.full() * 100)}% full`, ok: w.full() <= 1 }
  },
}

const BRIEF = {
  title: 'The brief',
  lines: [
    'WhatsApp carries messages between people. A message must be kept until the other phone has it, even when that phone is off for weeks.',
    'Build it. A message from one phone must be stored, pushed to every device of the person, and answered with receipts.',
    'Plan for two billion people and about a hundred billion messages a day. Groups can have hundreds of members, people have several devices, and a phone can come back after weeks.',
    'Nothing may be lost when a machine dies, a message must be quick, and disks cost money.',
  ],
}

// Stage 3 adds the numbers on the board itself: what the day asks of the machines, in the units they are rated in.
const SCALE_BRIEF = {
  title: BRIEF.title,
  lines: [
    ...BRIEF.lines,
    `On this board, at the busiest: about ${PEAK.chats} messages a second, one in three with a ${MEDIA_MB} MB photo, and about ${PEAK.dots} status changes a second as people open the app. Pings from all phones come in at about ${BEATS} a second if they ping once a second. A gateway falls, and ${HELLOS} phones reconnect. A phone comes back after ${AWAY_DAYS} days with ${BACKLOG} messages waiting. A group of ${GROUP_MEMBERS} members goes viral. The board runs all of this scaled down, so the loads and machine counts below are board numbers. Some days are busier.`,
  ],
}

const FIXED = [
  { id: 'phones', kind: 'users' as const, ...PHONES_AT },
  { id: 'devices', kind: 'users' as const, ...DEVICES_AT },
]
const LABELS = [
  { at: [PHONES_AT.x, 1.6, PHONES_AT.z] as [number, number, number], text: 'Phones' },
  { at: [DEVICES_AT.x, 1.6, DEVICES_AT.z] as [number, number, number], text: 'Other devices' },
]
const NAMES: BuildTask['names'] = { queue: 'Delivery queue', database: 'Message shard', cache: 'Presence cache' }
const PIECE_HINTS: BuildTask['hints'] = {
  queue: 'holds up to 400 notices until a delivery worker is free',
  app: `phones’ side: a gateway, takes about ${GATEWAY_A_SECOND} messages or receipts a second · devices’ side: a delivery worker, pushes to about ${Math.round(1 / PUSH_PER) * 1} devices a tick, ${WORKER_A_SECOND} ticks of work a second`,
  database: `a message shard, keeps messages until every device has them · takes about ${SHARD_A_SECOND} ticks of writing a second`,
  cache: 'keeps who is online, in memory, and takes pings lightly',
  limiter: 'lets only so many requests a second through',
  breaker: 'stops calling a service that keeps failing',
  ring: 'gives each key to one machine',
}

const SETTINGS = [
  { id: 'keep', label: 'A message nobody has fetched is kept', when: 'database' as const, min: 1, max: 60, step: 1, initial: 1, slider: { unit: 'days' } },
  { id: 'group', label: 'A group message is stored', when: 'database' as const, min: 0, max: 1, step: 1, initial: 0, options: ['Once for every member', 'Once for the group'],
    tradeoffs: [
      { gain: 'Each member’s inbox is ready to read.', cost: 'A big group turns every message into many writes.' },
      { gain: 'One write per message, however big the group.', cost: 'Each read must also look up the group’s messages.' },
    ],
  },
  { id: 'media', label: 'A photo travels', when: 'app' as const, min: 0, max: 1, step: 1, initial: 0, options: ['Inside the message', 'As a link to a file store'],
    tradeoffs: [
      { gain: 'One send, nothing else to store.', cost: 'Big messages slow the path every message shares.' },
      { gain: 'Messages stay small and fast.', cost: 'A second fetch to see the photo.' },
    ],
  },
  { id: 'receipts', label: 'Receipts go back', when: 'app' as const, min: 0, max: 1, step: 1, initial: 0, options: ['One by one', 'In batches'],
    tradeoffs: [
      { gain: 'Each tick shows the moment it happens.', cost: 'One message for every receipt.' },
      { gain: 'Far fewer messages.', cost: 'Ticks show a little later.' },
    ],
  },
  { id: 'jitter', label: 'Phones reconnect', when: 'app' as const, min: 0, max: 1, step: 1, initial: 0, options: ['All at once', 'Spread over a few seconds'],
    tradeoffs: [
      { gain: 'Everyone is back as soon as possible.', cost: 'The servers take every reconnect in the same moment.' },
      { gain: 'Reconnects arrive at a steady pace.', cost: 'Some phones wait a few seconds longer.' },
    ],
  },
  { id: 'dots', label: 'A status change is sent to', when: 'cache' as const, min: 0, max: 1, step: 1, initial: 0, options: ['Every contact', 'Chats on screen'],
    tradeoffs: [
      { gain: 'Everyone sees every change.', cost: 'One change fans out to hundreds of contacts.' },
      { gain: 'Only people looking get the update.', cost: 'Others see it only when they open the chat.' },
    ],
  },
  { id: 'beat', label: 'Phones ping every', when: 'cache' as const, min: 1, max: 40, step: 1, initial: 1, slider: { unit: 's' } },
]

const WATCH = {
  kind: 'note' as const,
  label: 'Shards full',
  read: (flow: FlowSim) => {
    const full = whatsappOf.get(flow)?.full() ?? 0
    return { text: `${Math.round(full * 100)}%`, bad: full > 0.85 }
  },
}

function decorate(flow: FlowSim, raw: Placement) {
  const w = whatsappOf.get(flow)
  if (!w) return null
  const l = layout(raw)
  const hard = w.cfg.crash !== undefined
  const out = [createElement(Tag, { key: 'phase', at: [PHONES_AT.x, 2.4, PHONES_AT.z], label: hard ? (TIMELINE.phases.filter((p) => p.from <= flow.tick).pop()?.name ?? '') : 'A busy hour' })]
  for (const id of l.jam?.ids ?? []) out.push(createElement(Tag, { key: `jam-${id}`, at: [POS[id].x, 1.8, POS[id].z], label: 'Stops here', danger: true }))
  if (l.gateways.length) {
    const load = w.gatewayLoad()
    const down = w.gateways.filter((g) => !g.alive).length
    out.push(createElement(Tag, { key: 'gateways', at: [PHONES_AT.x, 3.2, PHONES_AT.z], label: down ? 'A gateway is down' : `Gateways ${Math.round(load * 100)}% busy`, danger: down > 0 || load > 0.75 }))
  }
  const backlog = w.backlog()
  if (backlog > 0) out.push(createElement(Tag, { key: 'backlog', at: [DEVICES_AT.x, 2.4, DEVICES_AT.z], label: `${backlog} notices waiting`, danger: backlog > 40 }))
  if (l.shards.length) {
    const load = w.storeLoad()
    out.push(createElement(Tag, { key: 'store', at: [STORE_AT.x, 3.0, STORE_AT.z], label: `Shards ${Math.round(load * 100)}% busy`, danger: load > 0.75 }))
  }
  return out
}

function common(): Pick<BuildTask, 'pinned' | 'manualStart' | 'rps' | 'shot' | 'fixed' | 'labels' | 'decorate' | 'hints' | 'names' | 'failFast' | 'anywhere' | 'replies'> {
  return {
    pinned: BRIEF,
    manualStart: true,
    replies: (job) => job.from === 'notice',
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
function symptom(w: WhatsApp): Diagnosis | null {
  const t = w.tally
  const limited = t.limited ? ' Some were turned away by a rate limiter.' : ''
  if (t.lost > 0) return { because: `Some messages were lost.${limited}`, look: 'How long does a message wait for a phone that is off, and what if that phone is away longer?' }
  if (t.stale > 0) return { because: `Some receipts, phones or notices never got through.${limited}`, look: 'What arrives all at once, and where does it wait when every machine is busy?' }
  if (w.full() > 1) return { because: 'The shards ran out of room.', look: 'How long are undelivered messages kept, and what does each photo cost?' }
  if (w.tally.beatsLost > 0) return { because: 'Some pings from phones were lost.', look: 'Where do the pings go, and how many does a million phones send every second?' }
  if (w.slowestStore() > SEND_LIMIT) return { because: 'A message has taken too long to be stored.', look: 'How much work does one message cause on a gateway and a shard, and what else do they have to carry?' }
  if (w.slowestDelivery() > DELIVER_LIMIT) return { because: 'Some messages have taken too long to reach the devices.', look: 'What else is waiting for the delivery workers besides messages?' }
  if (w.deadLate() > DEAD_LIMIT) return { because: 'A dead phone looks online for too long.', look: 'How many missed pings does it take before a phone is called offline?' }
  return null
}

// Stage 2: an ordinary hour, and the new idea: the shard is the offline queue, and a queue holds the notices.
export const FIRST_DESIGN: BuildTask = {
  ...common(),
  title: 'First design: keep it until it is delivered.',
  sub: 'Place a gateway, a delivery worker and a shard, then add what helps. Changing anything restarts the run.',
  goal: 'Keep every message safe and deliver it to every device, even when a team writes at once and a phone comes back.',
  goalShort: 'Messages stored · delivered',
  win: 'Put a gateway on the phones’ side, a delivery worker on the devices’ side and a message shard. The shard keeps a message until the devices have it, so a phone that was off gets it later. A queue in front of the worker holds the notices when a team group writes at once or a phone comes back.',
  lesson: {
    without: 'Without a queue, a busy delivery worker turns the next notice away, and a device never hears of the message.',
    choice: 'Store every message on a shard first, then push it, and queue the notices.',
    cost: 'The price: every message is written to disk before anyone sees it, and a queue makes delivery a little later, not lost.',
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
    const w = whatsappOf.get(flow)
    if (!w) return null
    const t = w.tally
    return `${t.stored.toLocaleString()} messages stored, ${t.delivered.toLocaleString()} delivered (slowest ${w.slowestDelivery().toFixed(1)} s), none lost.`
  },
  requirements: [sending(FIRST_SETTLED), delivering, safe],
  assemble: (placed, settings, rng) => assemble(placed, settings, { phases: FIRST_PHASES, groups: FIRST_GROUPS, backlogs: [FIRST_BACKLOG], hard: false }, rng),
  diagnose(_m, raw, _settings, flow) {
    const w = whatsappOf.get(flow)
    if (!w) return null
    const l = layout(raw)
    return missing(l) ?? (l.jam ? { because: l.jam.why, look: ORDER_LOOK } : null) ?? symptom(w)
  },
  problem: (m, raw, settings, flow) => FIRST_DESIGN.diagnose!(m, raw, settings, flow)?.because ?? null,
  hint: (_m, raw, settings) => hintFromReview(review(raw, settings).lines, ['Delivery queue'], false),
  check(_m, _raw, _settings, flow) {
    const w = flow && whatsappOf.get(flow)
    if (!w || flow.tick < FIRST_SETTLED) return false
    return w.tally.lost === 0 && w.tally.stale === 0 && w.slowestStore() <= SEND_LIMIT && w.slowestDelivery() <= DELIVER_LIMIT && w.tally.delivered > 0
  },
}

// After a few failed runs: the cause, with the numbers to check it against. It names the weakest link first.
function whyHint(raw: Placement, settings: Settings): string | null {
  const l = layout(raw)
  const s = chosen(settings)
  if (s.keep < KEEP_FROM) return `A phone can be away for ${AWAY_DAYS} days. Kept for ${s.keep}, the messages waiting for it are gone when it comes back.`
  if (s.keep > KEEP_TO) return `Every day a message is kept holds about ${DAY_MB} MB of messages nobody fetched. At ${s.keep} days the shards run out of room.`
  if (!s.groupOnce) return `A group has ${GROUP_MEMBERS} members. Stored once for every member, one message is ${GROUP_MEMBERS} writes, and six of them in a few seconds drown a shard.`
  if (!s.linkMedia) return `A photo is ${MEDIA_MB} MB and one message in three has one. Inside the message, every shard write is several times bigger, and the shards store them all.`
  if (!s.batch) return `Every message gets two receipts back, and a gateway takes about ${GATEWAY_A_SECOND} requests a second. One by one, receipts take as much as the messages do. In batches of ${RECEIPT_BATCH} they take a tenth.`
  if (s.audience === 'all') return `A status change goes to ${DOT_FAN} contacts here, and the delivery workers push every one. When everyone opens the app, they are busy with dots and messages wait.`
  if (s.beat < BEAT_FROM) return `Pinging every ${s.beat} s means about ${Math.round(BEATS / s.beat)} pings a second, more than the presence cache takes.`
  if (s.beat > BEAT_TO) return `After three missed pings a phone is called offline. At ${s.beat} s that is ${3 * s.beat} seconds of a dead phone looking online.`
  if (!s.jitter) return `When a gateway falls, ${HELLOS} phones reconnect in the same moment to the one that is left. Spread over ${JITTER_SECONDS} seconds they fit.`
  if (!l.queue) return 'A phone that comes back, or a viral group, makes many notices in a moment. With nothing to hold them, a busy worker turns the next one away.'
  if (!l.cache) return `Pings are small writes, but ${BEATS} a second to a disk shard take several times the work of a message. The presence belongs in a cache.`
  if (l.gateways.length < NEED_GATEWAYS) return 'When one gateway falls, the phones need another one to reconnect to.'
  if (l.workers.length < NEED_WORKERS) return `A busy hour of messages, dots and notices needs about ${NEED_WORKERS} delivery workers, and each does ${WORKER_A_SECOND} ticks of work a second.`
  if (l.shards.length < NEED_SHARDS) return `Messages, photos and group writes need about ${NEED_SHARDS} shards, and each takes ${SHARD_A_SECOND} ticks of writing a second.`
  if (l.limits.length) return 'A rate limiter turns away real messages and real notices. Nothing here is an attack to stop.'
  return null
}

// Stage 3: the real day. Each phase brings a new way to fail.
export const SCALE_UP: BuildTask = {
  ...common(),
  pinned: SCALE_BRIEF,
  title: 'Where it breaks: a big day.',
  sub: 'Everyone opens the app, a gateway falls, a phone comes back after three weeks, then a group goes viral. Every run is a slightly different day. Work out what each lane needs, then build it.',
  goal: 'Get through the whole day: every message stored and delivered, nothing lost, the dots right, the shards not full.',
  goalShort: 'Survive the whole day',
  win: `Fill the ${ALL_SPOTS.length} pads with ${NEED_GATEWAYS} gateways, a queue, ${NEED_WORKERS} delivery workers, ${NEED_SHARDS} shards and a presence cache. Keep messages ${KEEP_FROM} to ${KEEP_TO} days, store a group message once, send photos as links, batch receipts, send status changes only to chats on screen, ping every ${BEAT_FROM} to ${BEAT_TO} seconds, and spread reconnects out.`,
  lesson: {
    without: 'Without a retention that outlasts a long trip, a phone that comes back finds nothing. Without batching and a cache, receipts and pings crowd out messages. Without spread-out reconnects, a fallen gateway takes its survivor down too.',
    choice: 'Keep messages for weeks, store a group message once, send media as links, batch receipts, tell only the chats on screen, keep presence in a cache, and spread reconnects out.',
    cost: 'The price: shards hold weeks of messages for phones that may never come back, a batch tells the sender a moment later, and a link means one more request to fetch the photo.',
  },
  holdSeconds: 4,
  testSeconds: 84,
  pads: ALL_SPOTS.map(spot),
  toolbox: [
    { kind: 'queue', count: 1 },
    { kind: 'app', count: 6 },
    { kind: 'database', count: 5 },
    { kind: 'cache', count: 2 },
    { kind: 'limiter', count: 1 },
    { kind: 'breaker', count: 1 },
    { kind: 'ring', count: 1 },
  ],
  timeline: TIMELINE,
  settings: SETTINGS,
  watch: [WATCH],
  freshDay: true,
  requirements: [sending(SCALE_SETTLED), delivering, safe, dots, space],
  assemble: (placed, settings, rng) => {
    const r = rng ?? seeded(7)
    return assemble(placed, settings, { ...scaleDay(r), hard: true }, r)
  },
  diagnose(_m, raw, _settings, flow) {
    const w = whatsappOf.get(flow)
    if (!w) return null
    const l = layout(raw)
    return missing(l) ?? (l.jam ? { because: l.jam.why, look: ORDER_LOOK } : null) ?? symptom(w)
  },
  problem: (m, raw, settings, flow) => SCALE_UP.diagnose!(m, raw, settings, flow)?.because ?? null,
  hint: (_m, raw, settings) => whyHint(raw, settings),
  result: (_m, _raw, _settings, flow) => {
    const w = whatsappOf.get(flow)
    if (!w) return null
    const t = w.tally
    return `${t.stored.toLocaleString()} messages stored, ${t.delivered.toLocaleString()} delivered, none lost, even when a gateway fell. The shards ended ${Math.round(w.full() * 100)}% full.`
  },
  check(_m, _raw, _settings, flow) {
    const w = flow && whatsappOf.get(flow)
    if (!w || flow.tick < SCALE_SETTLED) return false
    return w.tally.lost === 0 && w.tally.stale === 0 && w.slowestStore() <= SEND_LIMIT && w.slowestDelivery() <= DELIVER_LIMIT && w.full() <= 1 && w.tally.beatsLost === 0 && w.deadLate() <= DEAD_LIMIT && w.tally.delivered > 0
  },
}

function review(raw: Placement, settings: Settings): Review {
  const l = layout(raw)
  const s = chosen(settings)
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`
  return {
    lines: [
      { label: 'Keeping messages', yours: `${s.keep} days`, reference: `${KEEP_FROM} to ${KEEP_TO} days`, why: 'A phone can be off for weeks. The messages for it wait on the shards until it fetches them. Kept too briefly, they are gone. Kept for months, the shards fill with messages nobody collects.', ok: s.keep >= KEEP_FROM && s.keep <= KEEP_TO },
      { label: 'Group messages', yours: s.groupOnce ? 'Once for the group' : 'Once for every member', reference: 'Once for the group', why: `A group message has the same content for every member. Stored once with a list of members, it is one write. Stored for every member, a group of ${GROUP_MEMBERS} is ${GROUP_MEMBERS} writes.`, ok: s.groupOnce },
      { label: 'Photos', yours: s.linkMedia ? 'As a link to a file store' : 'Inside the message', reference: 'As a link to a file store', why: 'A photo is thousands of times bigger than a text. Kept in a file store, the message carries only a link, and the message path stays small and fast.', ok: s.linkMedia },
      { label: 'Receipts', yours: s.batch ? 'In batches' : 'One by one', reference: 'In batches', why: `Every message makes two receipts, delivered and read. One by one that doubles the requests on the gateways. In batches of ${RECEIPT_BATCH} they take a tenth.`, ok: s.batch },
      { label: 'Status changes', yours: s.audience === 'open' ? 'Chats on screen' : 'Every contact', reference: 'Chats on screen', why: 'A status change sent to every contact is hundreds of messages for dots nobody is looking at. Send it to the people who have the chat open, and let the rest ask when they open it.', ok: s.audience === 'open' },
      { label: 'Ping interval', yours: `${s.beat} s`, reference: `${BEAT_FROM} to ${BEAT_TO} s`, why: 'Short, and the pings of a million phones are too many to take. Long, and a dead phone looks online for minutes. Three missed pings make a phone offline.', ok: s.beat >= BEAT_FROM && s.beat <= BEAT_TO },
      { label: 'Reconnecting', yours: s.jitter ? 'Spread over a few seconds' : 'All at once', reference: 'Spread over a few seconds', why: 'When a gateway falls, all its phones reconnect together to the others. Each waits a random moment first, so the survivors see a stream, not a wall.', ok: s.jitter },
      { label: 'Delivery queue', yours: l.queue ? 'A queue in front of the workers' : 'None', reference: 'A queue in front of the workers', why: 'A viral group or a phone coming back makes many notices in a moment. A queue holds them until a worker is free, and nothing is turned away.', ok: !!l.queue },
      { label: 'Presence', yours: l.cache ? 'A presence cache' : 'On the message shards', reference: 'A presence cache', why: 'Pings are short-lived and many. In memory with an expiry, they cost little, and a restart rebuilds them within one interval. On the shards they compete with messages.', ok: !!l.cache },
      { label: 'Gateways', yours: n(l.gateways.length, 'gateway'), reference: `${NEED_GATEWAYS} gateways`, why: `Each takes about ${GATEWAY_A_SECOND} requests a second. When one falls, its phones need another to reconnect to.`, ok: l.gateways.length >= NEED_GATEWAYS },
      { label: 'Delivery workers', yours: n(l.workers.length, 'worker'), reference: `${NEED_WORKERS} workers`, why: `Each does ${WORKER_A_SECOND} ticks of pushing a second. Messages, status changes and a long-waiting phone all go through them.`, ok: l.workers.length >= NEED_WORKERS },
      { label: 'Message shards', yours: n(l.shards.length, 'shard'), reference: `${NEED_SHARDS} shards`, why: `Each takes about ${SHARD_A_SECOND} ticks of writing a second. Every message is written once before anyone sees it.`, ok: l.shards.length >= NEED_SHARDS },
      { label: 'Extras', yours: l.limits.length + l.extras ? 'Pieces this system does not need' : 'Only what is needed', reference: 'No limiter, breaker or hash ring', why: 'A rate limiter turns real messages and notices away. A breaker guards calls to a failing service, and nothing here calls one. A hash ring has nothing to place when messages already spread by id.', ok: l.limits.length + l.extras === 0 },
    ],
    tradeoffs: [
      'Keeping messages on the server until delivered makes the server the offline queue, and a long retention costs disk. WhatsApp keeps them for about a month, then drops them.',
      'Storing a group message once saves writes, and every read now needs the member list. Fan-out on read trades cheap writes for more reads.',
      'Batching receipts cuts the load, and the sender sees the blue ticks a moment later.',
      'Sending status only to open chats cuts the fan-out, and a chat opened later needs one extra request to learn the status.',
      'End-to-end encryption means the server never sees the text, so it cannot search, index or repair a message. It stores and forwards sealed envelopes, one per device.',
    ],
    interview: [
      'Clarify: one-to-one and group chats, group size, media, delivery and read receipts, online status, several devices, how long a message is kept for an offline phone, and end-to-end encryption.',
      'Estimate: 2 billion people sending 50 messages a day is 100 billion messages, about 1.2 million a second. A quarter connected at once is 500 million connections, and a gateway holds about a million, so about 500 gateways. Photos of 200 KB in one message in ten add about 2 PB a day.',
      'Shape: phones hold a persistent connection to a gateway. A message is written to a store keyed by recipient, then pushed to every device of the recipient that is online. A device that is off collects its messages when it reconnects. Receipts travel back as small messages. Media goes to a file store, and the message carries a link.',
      'Scale: shard the message store by recipient, route a user to a gateway through a lookup, keep presence in memory with an expiry, and fan a group message out from one stored copy.',
      'Failures: a gateway that falls makes its phones reconnect, so use jitter and backoff. A message is acknowledged only after it is stored, and the sender retries until then, with ids to drop duplicates. Messages for a phone away longer than the retention are dropped.',
    ],
  }
}

// The opening: a tiny site, from a message to the other device.
const INTRO_FIXED = [
  { id: 'phones', kind: 'users' as const, x: -8, z: -3 },
  { id: 'devices', kind: 'users' as const, x: -8, z: 3 },
  { id: 'gateway', kind: 'app' as const, x: -3.4, z: -3 },
  { id: 'worker', kind: 'app' as const, x: -3.4, z: 3 },
  { id: 's0', kind: 'database' as const, x: 2.4, z: 0 },
]
export const INTRO: Intro = {
  task: {
    title: 'How WhatsApp works',
    sub: '',
    goal: '',
    win: '',
    holdSeconds: 1,
    rps: 1,
    shot: { target: [-2.4, 0.8, 0], zoom: 0.85 },
    fixed: INTRO_FIXED,
    labels: [
      { at: [-8, 1.6, -3], text: 'Joe’s phone' },
      { at: [-8, 1.6, 3], text: 'Friend’s devices' },
    ],
    pads: [],
    toolbox: [],
    assemble: (_placed, _settings, rng) => {
      const site = new WhatsApp(rng ?? seeded(3), {
        gateways: ['gateway'],
        workers: ['worker'],
        shards: ['s0'],
        limits: [],
        keep: 30,
        groupOnce: true,
        linkMedia: true,
        batch: false,
        audience: 'open',
        beat: 1e9,
        jitter: true,
        phases: [{ from: 0, chats: 0.3 }],
        groups: [],
        groupMembers: 0,
        backlogs: [],
      })
      whatsappOf.set(site.flow, site)
      return site.flow
    },
    check: () => false,
  },
  steps: [
    { say: 'Joe writes “running late” on his phone (top block). His friend’s phone and laptop (bottom block) must get it, and the friend’s phone may be off.', at: 'phones', label: 'Joe' },
    { say: 'The message goes to a gateway, the machine Joe’s phone stays connected to.', at: 'gateway', label: 'Gateway' },
    { say: 'The gateway writes the message to a shard first. Joe sees one tick: it is safe. If the friend’s phone is off, it waits here.', at: 's0', label: 'Message shard' },
    { say: 'A delivery worker pushes it to every device the friend has that is on.', at: 'worker', label: 'Delivery worker' },
    { say: 'A receipt travels back to Joe: two ticks. Now picture a hundred billion messages a day, a group of hundreds, a phone back after weeks, and a gateway that falls.' },
  ],
  start: 'Take the challenge →',
}

export const WHATSAPP: Capstone = {
  id: 'whatsapp',
  title: 'WhatsApp',
  stages: ['Requirements', 'First design', 'Where it breaks', 'Final review'],
  intro: INTRO,
  goals: ['Never lose a message', 'Deliver to every device', 'Right online dots', 'Survive a gateway failure'],
  brief: BRIEF,
  estimate: {
    intro: 'Before drawing anything, work out how big this is. A few quick numbers decide the design.',
    summary: { title: 'About 1.2 million messages a second, and 500 million open connections.', body: 'Every message is stored before it is acknowledged, and the store doubles as the offline queue. Gateways hold the connections. Presence is a huge stream of small pings, so it lives in memory. Photos travel as links, group messages are stored once, and receipts and status changes are kept small, or they crowd out the messages.' },
    questions: [
      { question: '2 billion people each send 50 messages a day. About how many messages a second?', options: ['About 120,000', 'About 1.2 million', 'About 12 million'], answer: 1, at: 'phones', show: '1.2 million / second', why: '2 billion × 50 is 100 billion messages a day. A day has about 86,000 seconds, so about 1.2 million a second.' },
      { question: 'A quarter of them are connected at any moment, and a gateway holds about 1 million connections. About how many gateways?', options: ['About 50', 'About 500', 'About 5,000'], answer: 1, at: 'gateway', show: '500 gateways', why: 'A quarter of 2 billion is 500 million connections. At a million each, that is about 500 gateways, plus spares.' },
      { question: 'Each of those 500 million phones pings every 10 seconds. About how many pings a second?', options: ['About 5 million', 'About 50 million', 'About 500 million'], answer: 1, at: 'phones', show: '50 million pings / second', why: '500 million divided by 10 is 50 million pings a second, far more than messages. This is why presence is kept in memory and not on the message shards.' },
      { question: 'One message in ten is a 200 KB photo. About how much data do photos add each day?', options: ['About 200 TB', 'About 2 PB', 'About 20 PB'], answer: 1, at: 's0', show: '2 PB / day', why: '10 billion photos × 200 KB is 2 PB a day. Text is only about 100 TB, so photos go to a file store and the message carries a link.' },
      { question: 'One message in twenty goes to a group of 256 members, the rest to one person. About how many deliveries is an average message?', options: ['About 1.5', 'About 14', 'About 140'], answer: 1, at: 'worker', show: '14 deliveries each', why: '95% send 1 and 5% send 256: 0.95 + 12.8 is about 14. A few big groups are most of the delivery work, so group messages are stored once and pushed from the one copy.' },
    ],
  },
  first: FIRST_DESIGN,
  scale: SCALE_UP,
  review,
}
