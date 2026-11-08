import { createElement } from 'react'
import { hintFromReview } from '../../core/build/hint'
import { Tag } from '../../core/iso/primitives'
import type { BuildTask, Diagnosis, Placement, Requirement, Settings } from '../../core/build/types'
import type { FlowSim } from '../../core/flow/engine'
import type { Capstone, Intro, Review } from '../../core/capstone/types'
import { CONN_CAP, Chat, SECOND, type Phase } from './chat'

// The design board: senders and recipients on the left, a column of gateways, the
// chat service in the middle, and the message store on the right.
const SENDERS_AT = { x: -8.8, z: -4.4 }
const RECEIVERS_AT = { x: -8.8, z: 4.4 }
const GATE_AT = { x: -5.2, z: 0 }
const CHAT_AT = { x: -1.6, z: 0 }
const STORE_AT = { x: 4.4, z: 0 }
const POS: Record<string, { x: number; z: number }> = {
  g1: { x: -5.2, z: -3.8 },
  g2: { x: -5.2, z: 3.8 },
  d1: { x: -1.6, z: -3.8 },
  t1: { x: -1.6, z: 3.8 },
  x1: { x: 1.4, z: -3.8 },
  q1: { x: 1.4, z: 3.8 },
  x2: { x: 4.4, z: -4.4 },
  x3: { x: 4.4, z: 4.4 },
}
const FIRST_SPOTS = ['g1', 'g2', 't1', 'd1']
const ALL_SPOTS = ['g1', 'g2', 'd1', 't1', 'x1', 'q1', 'x2', 'x3']
const spot = (id: string) => ({ id, ...POS[id], accepts: [] })

// The first design: an ordinary busy hour. Then the real day: a rush, a crashed
// gateway, and two messages to a huge group.
const T = (s: number) => s * SECOND
const FIRST_PHASES: Phase[] = [{ from: 0, phones: 1200, dms: 14 }]
export const FIRST_SETTLED = T(30)
const SCALE_PHASES: Phase[] = [
  { from: 0, phones: 600, dms: 6, groups: 1 },
  { from: T(8), phones: 1800, dms: 24, groups: 4 },
]
const CRASH = { at: T(20), down: T(8) }
const BIGS = [T(32), T(46)]
export const SCALE_SETTLED = T(62)
const WAIT_LIMIT = 3 // seconds a phone may wait for a connection
const FRESH_LIMIT = 3 // seconds a message may take to arrive

const TIMELINE: NonNullable<BuildTask['timeline']> = {
  phases: [
    { name: 'A quiet morning', from: 0 },
    { name: 'The rush', from: T(8) },
    { name: 'A gateway crashes', from: T(20) },
    { name: 'A huge group', from: T(32) },
    { name: 'Another one', from: T(46) },
  ],
  end: SCALE_SETTLED,
}

export const chatOf = new WeakMap<FlowSim, Chat>()

const seeded = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// Which parts are on the floor. A piece can go on any spot, so what it does comes from its kind.
function layout(raw: Placement) {
  const all = (kind: string) => Object.entries(raw).filter(([, k]) => k === kind).map(([id]) => id)
  return {
    gateways: ['gw-0', ...all('app')],
    topic: all('topic')[0],
    inbox: all('queue')[0],
    dedupe: all('dedupe')[0],
    limits: all('limiter'),
    extras: Object.values(raw).filter((k) => k === 'breaker' || k === 'ring').length,
  }
}

export function chosen(settings: Settings) {
  return { numbered: settings.order === 1, shared: settings.group === 1, backoff: settings.retry === 1 }
}

interface Mode {
  phases: Phase[]
  bigs: number[]
  hard: boolean // away recipients, lost acks, a crash
}

function assemble(raw: Placement, settings: Settings, mode: Mode, rng?: () => number) {
  const l = layout(raw)
  // The first design has no such choices: it only asks whether the message finds the recipient.
  const s = mode.hard ? chosen(settings) : { numbered: true, shared: true, backoff: true }
  const chat = new Chat(rng ?? seeded(7), {
    gateways: l.gateways,
    topic: l.topic,
    inbox: l.inbox,
    dedupe: l.dedupe,
    limits: l.limits,
    numbered: s.numbered,
    shared: s.shared,
    backoff: s.backoff,
    away: mode.hard,
    flaky: mode.hard,
    phases: mode.phases,
    bigs: mode.bigs,
    crash: mode.hard ? CRASH : undefined,
  })
  chatOf.set(chat.flow, chat)
  return chat.flow
}

// The checks a finished design must pass. Shown live; the win needs all green.
const online = (): Requirement => ({
  label: 'Online',
  says: `Every phone gets a connection within ${WAIT_LIMIT} seconds. A gateway holds ${CONN_CAP} phones.`,
  read: (flow) => {
    const c = chatOf.get(flow)
    if (!c) return { text: '', ok: true }
    const n = Math.round(c.waiting)
    return { text: n === 0 ? 'all connected' : `${n} waiting`, ok: c.longestWait <= WAIT_LIMIT }
  },
})
const messages: Requirement = {
  label: 'Messages',
  says: 'No message may be lost on its way, or miss someone it was sent to.',
  read: (flow) => {
    const t = chatOf.get(flow)?.tally
    if (!t) return { text: '', ok: true }
    const n = t.lost + t.missed
    return { text: n === 0 ? 'none lost' : `${n} lost`, ok: n === 0 }
  },
}
const fast: Requirement = {
  label: 'Fast',
  says: `A message must reach its recipients within ${FRESH_LIMIT} seconds.`,
  read: (flow) => {
    const c = chatOf.get(flow)
    if (!c) return { text: '', ok: true }
    return { text: `${c.slowest().toFixed(1)} s`, ok: c.slowest() <= FRESH_LIMIT }
  },
}
const once: Requirement = {
  label: 'Once',
  says: 'A message must show up once, even when the network makes the sender send it again.',
  read: (flow) => {
    const n = chatOf.get(flow)?.tally.duplicates ?? 0
    return { text: n === 0 ? 'no repeats' : `${n} twice`, ok: n === 0 }
  },
}
const inOrder: Requirement = {
  label: 'Order',
  says: 'Messages in a chat must show in the order they were sent.',
  read: (flow) => {
    const n = chatOf.get(flow)?.tally.misordered ?? 0
    return { text: n === 0 ? 'in order' : `${n} swapped`, ok: n === 0 }
  },
}

const BRIEF = {
  title: 'The brief',
  lines: [
    'A chat app delivers a message the moment it is sent, to a friend who may be across the world, or away from their phone.',
    'Build one. People write to one person or to a group. Every phone keeps a connection open, so messages arrive without being asked for.',
    'Plan for 100 million people a day sending 40 messages each. Groups run from a handful of people to many thousands. At any moment, millions of phones hold a connection open.',
    'A message must arrive fast, once and in order, and never be lost, even when its recipient is away or a machine crashes.',
  ],
}

const FIXED = [
  { id: 'senders', kind: 'users' as const, ...SENDERS_AT },
  { id: 'receivers', kind: 'users' as const, ...RECEIVERS_AT },
  { id: 'gw-0', kind: 'app' as const, ...GATE_AT },
  { id: 'chat', kind: 'app' as const, ...CHAT_AT },
  { id: 's0', kind: 'database' as const, ...STORE_AT },
]
const LABELS = [
  { at: [SENDERS_AT.x, 1.6, SENDERS_AT.z] as [number, number, number], text: 'Senders' },
  { at: [RECEIVERS_AT.x, 1.6, RECEIVERS_AT.z] as [number, number, number], text: 'Recipients' },
  { at: [GATE_AT.x, 1.6, GATE_AT.z] as [number, number, number], text: 'Gateway' },
  { at: [CHAT_AT.x, 1.6, CHAT_AT.z] as [number, number, number], text: 'Chat service' },
  { at: [STORE_AT.x, 2.2, STORE_AT.z] as [number, number, number], text: 'Message store' },
]
const NAMES: BuildTask['names'] = { app: 'Gateway', topic: 'Pub/sub topic', queue: 'Inbox queue', dedupe: 'Dedupe store' }
const PIECE_HINTS: BuildTask['hints'] = {
  app: `holds ${CONN_CAP} open phone connections`,
  topic: 'tells the right gateway a message has come',
  queue: 'keeps messages for people who are away',
  dedupe: 'remembers message ids, so a repeat is ignored',
  limiter: 'lets only so many messages a second through',
  breaker: 'stops calling a service that keeps failing',
  ring: 'gives each key to one machine',
}

const SETTINGS = [
  { id: 'order', label: 'messages are put in order by', when: 'app' as const, min: 0, max: 1, step: 1, initial: 0, options: ['The time they arrive', 'A number for each chat'],
    tradeoffs: [
      { gain: 'Nothing extra to track.', cost: 'Messages that travel at different speeds can show out of order.' },
      { gain: 'Every message has one fixed place in its chat.', cost: 'Each chat must hand out its numbers one at a time.' },
    ],
  },
  { id: 'group', label: 'a message to a group is stored', when: 'app' as const, min: 0, max: 1, step: 1, initial: 0, options: ['Once for every member', 'Once for the group'],
    tradeoffs: [
      { gain: 'Each member’s inbox is ready to read.', cost: 'A big group turns every message into many writes.' },
      { gain: 'One write per message, however big the group.', cost: 'Each read must also look up the group’s messages.' },
    ],
  },
  { id: 'retry', label: 'a phone that lost its gateway tries again', when: 'app' as const, min: 0, max: 1, step: 1, initial: 0, options: ['Right away', 'After a growing wait'],
    tradeoffs: [
      { gain: 'A phone is back as soon as a gateway answers.', cost: 'When a gateway falls, all its phones retry in the same instant.' },
      { gain: 'Retries spread out over time.', cost: 'Some phones stay offline a little longer.' },
    ],
  },
]

function decorate(flow: FlowSim, raw: Placement) {
  const c = chatOf.get(flow)
  if (!c) return null
  const l = layout(raw)
  const alive = c.alive().length
  const out = [createElement(Tag, { key: 'phase', at: [SENDERS_AT.x, 2.4, SENDERS_AT.z], label: c.cfg.crash ? (TIMELINE.phases.filter((p) => p.from <= flow.tick).pop()?.name ?? '') : 'A busy hour' })]
  for (const g of c.gates) {
    const at = g.key === 'gw-0' ? GATE_AT : POS[g.key]
    const label = g.alive ? `${Math.round(c.connected / Math.max(1, alive))} / ${CONN_CAP} phones` : 'Crashed'
    out.push(createElement(Tag, { key: `gw-${g.key}`, at: [at.x, 2.7, at.z], label, danger: !g.alive || c.connected / Math.max(1, alive) >= CONN_CAP }))
  }
  if (c.storming()) out.push(createElement(Tag, { key: 'storm', at: [GATE_AT.x, 3.5, GATE_AT.z], label: 'Phones all retry at once', danger: true }))
  const load = c.storeLoad()
  out.push(createElement(Tag, { key: 'store', at: [STORE_AT.x, 3.0, STORE_AT.z], label: `Store ${Math.round(load * 100)}% full`, danger: load > 0.75 }))
  const backlog = c.backlog()
  if (backlog > 0) out.push(createElement(Tag, { key: 'backlog', at: [CHAT_AT.x, 2.4, CHAT_AT.z], label: `${backlog} writes waiting`, danger: backlog > 60 }))
  if (l.inbox && c.inbox) out.push(createElement(Tag, { key: 'inbox', at: [POS[l.inbox].x, 1.6, POS[l.inbox].z], label: `${c.inbox.load()} waiting for someone away` }))
  return out
}

function common(): Pick<BuildTask, 'pinned' | 'manualStart' | 'rps' | 'shot' | 'fixed' | 'labels' | 'decorate' | 'hints' | 'names' | 'failFast' | 'anywhere'> {
  return {
    pinned: BRIEF,
    manualStart: true,
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

const WATCH: BuildTask['watch'] = [
  {
    kind: 'note',
    label: 'Phones connected',
    read: (flow) => {
      const c = chatOf.get(flow)
      if (!c) return { text: '', bad: false }
      return { text: `${Math.round(c.connected)} of ${Math.round(c.connected + c.waiting)}`, bad: c.waiting > 0.05 * (c.connected + c.waiting) }
    },
  },
]

// What the learner sees going wrong, in numbers. It says what happened, never why.
function symptom(c: Chat): Diagnosis | null {
  const t = c.tally
  if (c.longestWait > WAIT_LIMIT) return { because: 'Some phones could not connect for too long.', look: 'Follow what happens to the phones a gateway carries when the load rises or a gateway crashes.' }
  if (t.lost > 0) return { because: `Some messages were lost.${t.limited ? ' Some were turned away by a rate limiter.' : ''}`, look: 'Follow one message from the sender. What holds it when the next step is busy or away?' }
  if (t.missed > 0) return { because: 'Some messages did not reach everyone they were sent to.', look: 'The sender and the recipient may be connected to different places. How does a message get from one to the other?' }
  if (t.duplicates > 0) return { because: 'Some messages showed up twice.', look: 'What happens when the phone never hears that its message arrived?' }
  if (t.misordered > 0) return { because: 'Some messages arrived before ones sent earlier.', look: 'Messages can take different routes. What tells the phone where each one belongs?' }
  if (c.slowest() > FRESH_LIMIT) return { because: 'Messages are arriving too slowly.', look: 'Where are writes waiting, and what are they waiting for?' }
  return null
}

const passed = (c: Chat, hard: boolean) => c.longestWait <= WAIT_LIMIT && c.tally.lost + c.tally.missed === 0 && c.slowest() <= FRESH_LIMIT && (!hard || (c.tally.duplicates === 0 && c.tally.misordered === 0)) && c.tally.delivered > 0

// Stage 2: an ordinary hour, and the new idea: a message has to find the gateway its recipient is on.
export const FIRST_DESIGN: BuildTask = {
  ...common(),
  title: 'First design: a busy hour.',
  sub: 'Give every phone a connection, and get each message to its recipient. Changing anything restarts the run.',
  goal: 'Keep every phone connected, and deliver every message within 3 seconds.',
  goalShort: 'Connected · delivered',
  win: 'Add a second gateway, since one holds only 1,000 phones. Put a pub/sub topic between the chat service and the gateways, so a message finds the gateway its recipient is on.',
  holdSeconds: 4,
  testSeconds: 36,
  pads: FIRST_SPOTS.map(spot),
  toolbox: [
    { kind: 'app', count: 1 },
    { kind: 'topic', count: 1 },
  ],
  watch: WATCH,
  requirements: [online(), messages, fast],
  assemble: (placed, settings, rng) => assemble(placed, settings, { phases: FIRST_PHASES, bigs: [], hard: false }, rng),
  diagnose(_m, _raw, _settings, flow) {
    const c = chatOf.get(flow)
    return c ? symptom(c) : null
  },
  problem: (m, raw, settings, flow) => FIRST_DESIGN.diagnose!(m, raw, settings, flow)?.because ?? null,
  hint: (_m, raw, settings) => hintFromReview(review(raw, settings).lines, ['Gateways', 'Pub/sub topic'], false),
  check(_m, _raw, _settings, flow) {
    const c = flow && chatOf.get(flow)
    return !!c && flow.tick >= FIRST_SETTLED && passed(c, false)
  },
}

// Stage 3: the real day. Each phase brings a new way to fail.
export const SCALE_UP: BuildTask = {
  ...common(),
  title: 'Where it breaks: a gateway crashes.',
  sub: 'People who are away, a flaky network, a crash and a huge group. Watch the numbers, then tune it.',
  goal: 'Get through the whole day: everyone connected, no message lost, repeated or out of order.',
  goalShort: 'Survive the whole day',
  win: 'Three gateways, so two can hold everyone after a crash. A topic, an inbox queue and a dedupe store. Numbered messages, one stored copy per group message, and retries that back off.',
  holdSeconds: 4,
  testSeconds: 66,
  pads: ALL_SPOTS.map(spot),
  toolbox: [
    { kind: 'app', count: 2 },
    { kind: 'topic', count: 1 },
    { kind: 'queue', count: 1 },
    { kind: 'dedupe', count: 1 },
    { kind: 'limiter', count: 1 },
    { kind: 'breaker', count: 1 },
    { kind: 'ring', count: 1 },
  ],
  timeline: TIMELINE,
  settings: SETTINGS,
  watch: WATCH,
  requirements: [online(), messages, fast, once, inOrder],
  assemble: (placed, settings, rng) => assemble(placed, settings, { phases: SCALE_PHASES, bigs: BIGS, hard: true }, rng),
  diagnose(_m, _raw, _settings, flow) {
    const c = chatOf.get(flow)
    return c ? symptom(c) : null
  },
  problem: (m, raw, settings, flow) => SCALE_UP.diagnose!(m, raw, settings, flow)?.because ?? null,
  hint: (_m, raw, settings) => hintFromReview(review(raw, settings).lines, undefined, false),
  check(_m, _raw, _settings, flow) {
    const c = flow && chatOf.get(flow)
    return !!c && flow.tick >= SCALE_SETTLED && passed(c, true)
  },
}

function review(raw: Placement, settings: Settings): Review {
  const l = layout(raw)
  const s = chosen(settings)
  return {
    lines: [
      { label: 'Gateways', yours: `${l.gateways.length} gateway${l.gateways.length > 1 ? 's' : ''}`, reference: '3 gateways', why: 'Each gateway holds a thousand connections here. When one crashes, the others must hold everybody it carried, so plan for one more than the load needs.', ok: l.gateways.length >= 3 },
      { label: 'Pub/sub topic', yours: l.topic ? 'A topic between the chat service and the gateways' : 'None', reference: 'A topic between the chat service and the gateways', why: 'The sender and the recipient hold connections to different gateways. The chat service publishes once, and the gateway that holds the recipient picks it up.', ok: !!l.topic },
      { label: 'Inbox queue', yours: l.inbox ? 'A queue for people who are away' : 'None', reference: 'A queue for people who are away', why: 'A message for someone who is away has no connection to travel down. It waits in their inbox until they are back.', ok: !!l.inbox },
      { label: 'Dedupe store', yours: l.dedupe ? 'Message ids are remembered' : 'None', reference: 'Message ids are remembered', why: 'When an ack is lost, the phone sends the message again. The id shows the chat service it has seen it before, so it only answers.', ok: !!l.dedupe },
      { label: 'Order', yours: s.numbered ? 'A number for each chat' : 'The time they arrive', reference: 'A number for each chat', why: 'Messages take different routes and arrive in any order. A number given in each chat tells the phone where each one belongs.', ok: s.numbered },
      { label: 'Group messages', yours: s.shared ? 'Stored once for the group' : 'Stored once for every member', reference: 'Stored once for the group', why: 'A message to a huge group would be thousands of writes, and everyone behind it would wait. Store it once, and let each member read it from there.', ok: s.shared },
      { label: 'Reconnecting', yours: s.backoff ? 'After a growing wait' : 'Right away', reference: 'After a growing wait', why: 'After a crash, thousands of phones retry at once, and the gateways spend all their time turning them away. A random, growing wait spreads them out.', ok: s.backoff },
      { label: 'Extras', yours: l.limits.length + l.extras ? 'Pieces this system does not need' : 'Only what is needed', reference: 'No limiter, breaker or hash ring', why: 'A rate limiter turns real messages away. A breaker guards calls to a failing service, and nothing here calls one. A hash ring has nothing to place: the topic already finds each gateway.', ok: l.limits.length + l.extras === 0 },
    ],
    tradeoffs: [
      'A topic spares the chat service from knowing where each phone is, but it is one more hop for every message.',
      'The dedupe store has to remember ids for a while. Remember them for too short a time and a late repeat slips through; for too long and it grows without end.',
      'Storing a group message once makes the write cheap and the read costlier: each member reads from the group’s log, and keeps track of how far they have read.',
      'Spare gateways cost money while they sit half empty. They are what lets the system lose one and stay up.',
    ],
    interview: [
      'Clarify: one to one or groups, how big the groups, history, media, whether messages must be end-to-end encrypted, and whether to show who is online.',
      'Estimate: 100 million people sending 40 messages a day is about 46,000 messages a second. 20 million open connections at 100,000 per gateway is 200 gateways. 4 billion messages of 100 bytes is 400 GB a day.',
      'Design: phones hold a WebSocket to a gateway, the chat service numbers and stores each message, and a pub/sub topic carries it to the recipient’s gateway. An inbox holds it for someone who is away.',
      'Scale: store a group message once, shard the message store by chat, and add gateways as connections grow.',
      'Failures: a crashed gateway sends its phones to others, so keep spare capacity and make them retry with a growing wait. A lost ack means a retry, so use a message id to ignore repeats.',
    ],
  }
}

// The opening: a tiny chat, from one phone to another.
const INTRO_FIXED = [
  { id: 'senders', kind: 'users' as const, x: -8, z: -3 },
  { id: 'receivers', kind: 'users' as const, x: -8, z: 3 },
  { id: 'gw-0', kind: 'app' as const, x: -4.2, z: 0 },
  { id: 'chat', kind: 'app' as const, x: -0.2, z: 0 },
  { id: 's0', kind: 'database' as const, x: 3.8, z: 0 },
]
export const INTRO: Intro = {
  task: {
    title: 'How a chat app works',
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
      const chat = new Chat(rng ?? seeded(3), {
        gateways: ['gw-0'],
        limits: [],
        numbered: true,
        shared: true,
        backoff: true,
        away: false,
        flaky: false,
        phases: [{ from: 0, phones: 2, dms: 0.5 }],
        bigs: [],
      })
      chatOf.set(chat.flow, chat)
      return chat.flow
    },
    check: () => false,
  },
  steps: [
    { say: 'Alice writes to Bob. Her phone keeps a connection open to a gateway, so it can send at once.', at: 'senders', label: 'Alice' },
    { say: 'The gateway passes the message to the chat service. It does not keep it.', at: 'gw-0', label: 'Gateway' },
    { say: 'The chat service writes the message to the store first, so it is safe. Then it sends an ack back to Alice.', at: 's0', label: 'Message store' },
    { say: 'Now it looks for the gateway Bob is connected to, and pushes the message down his open connection.', at: 'chat', label: 'Chat service' },
    { say: 'Bob sees it. Easy for two phones. Now picture millions, some away, with a flaky network and a gateway that crashes.', at: 'receivers', label: 'Bob' },
  ],
  start: 'Take the challenge →',
}

export const CHAT: Capstone = {
  id: 'chat',
  title: 'Chat app',
  stages: ['Requirements', 'First design', 'Where it breaks', 'Final review'],
  intro: INTRO,
  goals: ['Always connected', 'Fast delivery', 'Nothing lost or repeated', 'Survive a crash'],
  brief: BRIEF,
  estimate: {
    intro: 'Before drawing anything, work out how big this is. A few quick numbers decide the design.',
    summary: { title: 'About 46,000 messages a second, and millions of open connections.', body: 'The messages are not the hard part: a store takes 46,000 small writes a second when it is sharded. The open connections are, since each one needs memory on a gateway for as long as the phone is on. Add a huge group, where one message must be stored once, not thousands of times.' },
    questions: [
      { question: '100 million people send 40 messages a day. About how many messages a second?', options: ['About 4,600', 'About 46,000', 'About 460,000'], answer: 1, at: 'senders', show: '46,000 messages / second', why: '4 billion messages a day ÷ 86,400 seconds is about 46,000.' },
      { question: 'At a peak, 20 million phones hold a connection open, and one gateway holds 100,000. About how many gateways?', options: ['About 20', 'About 200', 'About 2,000'], answer: 1, at: 'gw-0', show: '200 gateways', why: '20 million ÷ 100,000 is 200. Plus some spare, so that a crash does not leave phones with nowhere to go.' },
      { question: 'Each message is about 100 bytes. About how much does 4 billion of them a day add up to?', options: ['About 40 GB', 'About 400 GB', 'About 4 TB'], answer: 1, at: 's0', show: '400 GB / day', why: '4 billion × 100 bytes is 400 GB a day, about 150 TB a year. Shard the store, and move old messages to cheaper storage.' },
      { question: 'A group has 100,000 members. If one message is copied into each member’s inbox, how many writes is that?', options: ['About 100', 'About 10,000', 'About 100,000'], answer: 2, at: 'chat', show: '100,000 writes', why: 'One write per member: 100,000 for a single message. Store it once for the group, and let members read from there.' },
      { question: 'On a bad network 1 ack in 10 is lost, so the phone sends again. About how many repeats a second, at 46,000 messages?', options: ['About 460', 'About 4,600', 'About 46,000'], answer: 1, at: 'receivers', show: '4,600 repeats / second', why: '46,000 × 1 in 10 is about 4,600 a second. Without message ids to recognise them, each is stored and shown twice.' },
    ],
  },
  first: FIRST_DESIGN,
  scale: SCALE_UP,
  review,
}
