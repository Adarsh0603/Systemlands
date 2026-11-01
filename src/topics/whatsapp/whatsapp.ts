import { FlowSim, type FlowNode, type Job } from '../../core/flow/engine'
import { SECOND, TICKS_PER_SECOND } from '../../core/flow/time'
import { Jam, Limiter, Net, Pool, Queue } from '../../core/flow/parts'

// A chat service at WhatsApp's size, as a running system. One message goes through:
//   phones → (limiter) → a gateway → written to a message shard → a delivery notice → (queue)
//   → a delivery worker → the other devices → a receipt back to the gateway
// A shard keeps the message until every device has it, which is also the offline queue.
// The learner places every machine: gateways on the phones' side, delivery workers on the
// devices' side, the delivery queue between them, the message shards on the right, and a
// presence cache for the online dots.

export { SECOND, TICKS_PER_SECOND }

export const GROUP_MEMBERS = 400 // members in the group that goes viral
export const DEVICES = 3 // devices that get an ordinary message
export const PUSH_PER = 0.05 // ticks a delivery worker needs to push to one device
export const BACKLOG = 240 // messages waiting for a phone that was away
export const AWAY_DAYS = 21 // days that phone was away
export const HELLOS = 160 // phones that reconnect when a gateway falls
export const JITTER_SECONDS = 8 // how far apart reconnects are spread
export const DOT_FAN = 12 // contacts told when a status changes, if every contact is told
export const BEATS = 800 // pings a second from all phones, at an interval of one second
export const GATE_SLOTS = 4
export const GATE_LINE = 24
export const GATE_WORK = 2
export const SHARD_SLOTS = 4
export const SHARD_LINE = 40
export const MEDIA_EVERY = 3 // one message in this many carries a photo
export const MEDIA_MB = 4
export const SHARD_WRITE = 4 // ticks one shard slot needs to write a message
export const MB_PER_TICK = 0.25 // megabytes one shard slot writes in a tick
export const COPY_PER_TICK = 5 // per-member copies one shard slot writes in a tick
export const CACHE_SLOTS = 10
export const CACHE_LINE = 40
export const BEAT_DISK_WORK = 3
export const RECEIPT_BATCH = 10
export const STORE_MB = 60000
const BASE_MB = 6000
export const DAY_MB = 1300 // megabytes of undelivered messages that pile up for each day they are kept
const QUEUE_CAPACITY = 400
const RECENT = 10 * SECOND
const LINK = 4
const RETRIES = 2
const RETRY_AFTER = SECOND

export type Kind = 'chat' | 'group' | 'backlog'

export interface Phase {
  from: number // tick
  chats: number // messages a second
  dots?: number // status changes a second
}

// A rate limiter standing in front of one lane.
export interface Limit {
  key: string
  lane: 'send' | 'notify'
  rate: number // requests per second it lets through
}

export interface Config {
  gateways: string[]
  workers: string[]
  shards: string[]
  cache?: string
  queue?: string
  limits: Limit[]
  keep: number // days an undelivered message is kept
  groupOnce: boolean // a group message is stored once, not once per member
  linkMedia: boolean // a photo travels as a link to a file store
  batch: boolean // receipts go back in batches
  audience: 'all' | 'open' // who hears of a status change
  beat: number // seconds between pings
  jitter: boolean // phones spread out when they reconnect
  phases: Phase[]
  groups: number[] // ticks when a group message is sent
  groupMembers: number
  crash?: { at: number; down: number } // the first gateway goes down
  backlogs: { at: number; n: number; days: number }[] // a phone that was away comes back
  jam?: string[] // parts standing where requests cannot get through
}

export interface Tally {
  sent: number
  stored: number
  delivered: number
  lost: number // messages gone for good
  stale: number // receipts that never came back, phones that never reconnected, notices turned away
  limited: number
  beatsLost: number
  dotsLost: number
  storedMB: number
}

const blank = (): Tally => ({ sent: 0, stored: 0, delivered: 0, lost: 0, stale: 0, limited: 0, beatsLost: 0, dotsLost: 0, storedMB: 0 })

interface Message {
  id: number
  at: number
  kind: Kind
  media: boolean
  pushes: number // devices to push to
  gateway: string
  stored: boolean
  delivered: boolean
  failed: boolean
}

// The people with phones: they also run the script of the day.
class Phones implements FlowNode {
  alive = true
  readonly key = 'phones'
  private site: WhatsApp
  private due = { chat: 0, dot: 0, beat: 0 }
  constructor(site: WhatsApp) {
    this.site = site
  }
  receive() {}
  emit(sim: FlowSim) {
    const w = this.site
    w.script(sim)
    const phase = w.phaseAt(sim.tick)
    if (phase) {
      this.due.chat += phase.chats / SECOND
      this.due.dot += (phase.dots ?? 0) / SECOND
    }
    this.due.beat += BEATS / w.cfg.beat / SECOND
    for (; this.due.chat >= 1; this.due.chat--) w.send(sim, 'chat')
    for (; this.due.dot >= 1; this.due.dot--) w.dot(sim)
    for (; this.due.beat >= 1; this.due.beat--) w.beat(sim)
    if (w.cfg.groups.includes(sim.tick)) w.send(sim, 'group')
  }
}

// The other devices: a message arrives here, and a receipt goes back.
class Devices implements FlowNode {
  alive = true
  readonly key = 'devices'
  receive() {}
}

export class WhatsApp {
  readonly flow: Net
  readonly cfg: Config
  readonly tally = blank()
  readonly gateways: Pool[] = []
  readonly workers: Pool[] = []
  readonly shards: Pool[] = []
  cache?: Pool
  queue?: Queue
  private messages = new Map<number, Message>()
  private waiting = new Set<number>()
  private route: Record<'send' | 'notify', string[]> = { send: [], notify: [] }
  private stores: { at: number; delay: number }[] = []
  private deliveries: { at: number; delay: number }[] = []
  private nextMessage = 0
  private gatewayRound = 0
  private workerRound = 0
  private shardRound = 0
  private chatNo = 0
  private receipts = 0
  private later: { at: number; run: (sim: FlowSim) => void }[] = []

  constructor(rng: () => number, cfg: Config) {
    this.cfg = cfg
    const flow = (this.flow = new Net(rng))
    flow.onLoss = (job) => this.lose(job)
    flow.traffic = () => {
      const phase = this.phaseAt(flow.tick)
      return phase ? phase.chats : 0
    }
    flow.add(new Phones(this))
    flow.add(new Devices())
    for (const l of cfg.limits) {
      flow.add(new Limiter(l.key, l.rate, () => this.tally.limited++, (job, sim) => this.pass(job, l.lane, l.key, sim)))
      this.route[l.lane].push(l.key)
    }
    cfg.shards.forEach((key) => {
      this.shards.push(flow.add(new Pool(key, SHARD_SLOTS, SHARD_LINE, (job, sim) => this.written(job, sim))))
    })
    if (cfg.cache) {
      this.cache = flow.add(new Pool(cfg.cache, CACHE_SLOTS, CACHE_LINE, () => {}))
      flow.link('phones', cfg.cache, LINK)
    }
    cfg.gateways.forEach((key) => {
      this.gateways.push(flow.add(new Pool(key, GATE_SLOTS, GATE_LINE, (job, sim) => this.handled(job, key, sim))))
      for (const s of cfg.shards) flow.link(key, s, 6)
      flow.link('devices', key, LINK)
    })
    cfg.workers.forEach((key) => {
      this.workers.push(flow.add(new Pool(key, 1, 1, (job, sim) => this.told(job, key, sim))))
      flow.link(key, 'devices', LINK)
    })
    if (cfg.queue) {
      this.route.notify.push(cfg.queue)
      if (cfg.jam?.includes(cfg.queue)) flow.add(new Jam(cfg.queue))
      else this.queue = flow.add(new Queue(cfg.queue, QUEUE_CAPACITY, () => this.workers))
    }
    const send = this.route.send
    send.forEach((key, i) => flow.link(i === 0 ? 'phones' : send[i - 1], key, LINK))
    const lastSend = send.length ? send[send.length - 1] : 'phones'
    for (const g of cfg.gateways) flow.link(lastSend, g, LINK)
    const notify = this.route.notify
    for (const g of cfg.gateways) if (notify[0]) flow.link(g, notify[0], LINK)
    notify.forEach((key, i) => i > 0 && flow.link(notify[i - 1], key, LINK))
    const lastNotify = notify.length ? notify[notify.length - 1] : undefined
    for (const n of cfg.workers) {
      if (lastNotify) flow.link(lastNotify, n, cfg.queue === lastNotify ? 0 : LINK)
      else for (const g of cfg.gateways) flow.link(g, n, LINK)
    }
    if (notify[0]) flow.link('phones', notify[0], LINK)
    else for (const n of cfg.workers) flow.link('phones', n, LINK)
    for (const s of cfg.shards) flow.link('phones', s, LINK)
  }

  phaseAt(tick: number) {
    return [...this.cfg.phases].reverse().find((p) => p.from <= tick)
  }

  // Things that happen at a set time, once a tick.
  script(sim: FlowSim) {
    const { crash } = this.cfg
    if (crash) {
      const g = this.gateways[0]
      if (g && sim.tick === crash.at) {
        g.alive = false
        sim.fail(g.key)
        this.reconnect()
      }
      if (g && sim.tick === crash.at + crash.down) g.alive = true
    }
    for (const b of this.cfg.backlogs) if (sim.tick === b.at) this.comeBack(b.n, b.days, sim)
    while (this.later.length && this.later[0].at <= sim.tick) this.later.shift()!.run(sim)
  }

  private after(ticks: number, run: (sim: FlowSim) => void) {
    const at = this.flow.tick + ticks
    const i = this.later.findIndex((l) => l.at > at)
    this.later.splice(i < 0 ? this.later.length : i, 0, { at, run })
  }

  // --- A message ---------------------------------------------------------------------

  send(sim: FlowSim, kind: 'chat' | 'group') {
    const id = this.nextMessage++
    const media = kind === 'chat' && ++this.chatNo % MEDIA_EVERY === 0
    const msg: Message = { id, at: sim.tick, kind, media, pushes: kind === 'group' ? this.cfg.groupMembers : DEVICES, gateway: '', stored: false, delivered: false, failed: false }
    this.messages.set(id, msg)
    this.waiting.add(id)
    this.tally.sent++
    const job = sim.newJob(GATE_WORK, undefined, 'send')
    job.msg = id
    this.pass(job, 'send', 'phones', sim)
  }

  // Send a request on to whatever stands after `from` in its lane.
  pass(job: Job, lane: 'send' | 'notify', from: string, sim: FlowSim) {
    const route = this.route[lane]
    const next = route[route.indexOf(from) + 1]
    if (next) return sim.forward(job, from, next)
    if (lane === 'send') {
      const online = this.gateways.filter((g) => g.alive)
      if (!online.length) return sim.drop(job, from)
      return sim.forward(job, from, online[this.gatewayRound++ % online.length].key)
    }
    const online = this.workers.filter((w) => w.alive)
    if (!online.length) return sim.drop(job, from)
    sim.forward(job, from, online[this.workerRound++ % online.length].key)
  }

  // A gateway has taken a message, a receipt or a reconnecting phone.
  private handled(job: Job, gateway: string, sim: FlowSim) {
    if (job.from === 'hello' || job.from === 'receipt') return
    const msg = this.messages.get(job.msg!)
    if (!msg || msg.failed) return
    msg.gateway = gateway
    if (!this.shards.length) return
    const { groupOnce, linkMedia } = this.cfg
    let work = SHARD_WRITE
    if (msg.media && !linkMedia) work += Math.ceil(MEDIA_MB / MB_PER_TICK)
    if (msg.kind === 'group' && !groupOnce) work += Math.ceil(msg.pushes / COPY_PER_TICK)
    const write = sim.newJob(work, undefined, 'write')
    write.msg = msg.id
    sim.forward(write, gateway, this.shards[this.shardRound++ % this.shards.length].key)
  }

  // A shard has written a message, or a ping.
  private written(job: Job, sim: FlowSim) {
    if (job.from === 'beat') return
    const msg = this.messages.get(job.msg!)
    if (!msg || msg.failed || msg.stored) return
    msg.stored = true
    this.tally.stored++
    if (msg.media && !this.cfg.linkMedia) this.tally.storedMB += MEDIA_MB
    this.stores.push({ at: sim.tick, delay: sim.tick - msg.at })
    this.notice(msg, 'notice', sim, msg.gateway)
  }

  private notice(msg: Message, from: 'notice' | 'backlog', sim: FlowSim, source: string) {
    const notice = sim.newJob(Math.max(1, Math.ceil(msg.pushes * PUSH_PER)), undefined, from)
    notice.msg = msg.id
    this.pass(notice, 'notify', source || 'phones', sim)
  }

  // A delivery worker has pushed to the devices.
  private told(job: Job, _worker: string, sim: FlowSim) {
    if (job.from === 'dot') return
    const msg = this.messages.get(job.msg!)
    if (!msg || msg.failed || msg.delivered) return
    msg.delivered = true
    this.waiting.delete(msg.id)
    this.tally.delivered++
    this.deliveries.push({ at: sim.tick, delay: sim.tick - msg.at })
    job.createdAt = msg.at
    sim.complete(job)
    this.receipt(2, sim)
  }

  // Delivered and read: two receipts for the sender's phone, through a gateway.
  private receipt(n: number, sim: FlowSim) {
    if (this.cfg.batch) {
      this.receipts += n
      if (this.receipts < RECEIPT_BATCH) return
      const count = this.receipts
      this.receipts = 0
      return this.sendReceipt(sim, count)
    }
    for (let i = 0; i < n; i++) this.sendReceipt(sim, 1)
  }

  private sendReceipt(sim: FlowSim, count: number, attempts = 0) {
    const online = this.gateways.filter((g) => g.alive)
    const job = sim.newJob(1, count, 'receipt')
    job.attempts = attempts
    if (!online.length) return sim.drop(job, 'devices')
    sim.forward(job, 'devices', online[this.gatewayRound++ % online.length].key)
  }

  // --- Presence ----------------------------------------------------------------------

  // A phone says it is still there. A cache takes this lightly; a disk shard does not.
  beat(sim: FlowSim) {
    const job = sim.newJob(1, undefined, 'beat')
    if (this.cache) return sim.forward(job, 'phones', this.cache.key)
    if (!this.shards.length) return
    job.work = BEAT_DISK_WORK
    job.remaining = job.work
    sim.forward(job, 'phones', this.shards[this.shardRound++ % this.shards.length].key)
  }

  // A status changes: the contacts who are told hear it from a delivery worker.
  dot(sim: FlowSim) {
    const n = this.cfg.audience === 'all' ? DOT_FAN : 1
    for (let i = 0; i < n; i++) {
      const job = sim.newJob(1, undefined, 'dot')
      this.pass(job, 'notify', 'phones', sim)
    }
  }

  // --- A gateway falls and a phone comes back ----------------------------------------

  // The phones of the gateway that went down all reconnect, at once or spread out.
  private reconnect() {
    for (let i = 0; i < HELLOS; i++) {
      const wait = this.cfg.jitter ? Math.floor(((i + 0.5) / HELLOS) * JITTER_SECONDS * SECOND) : 1
      this.after(wait, (s) => this.hello(s, 0))
    }
  }

  private hello(sim: FlowSim, attempts: number) {
    const job = sim.newJob(1, undefined, 'hello')
    job.attempts = attempts
    this.pass(job, 'send', 'phones', sim)
  }

  // A phone that was away comes back, and the shards hold its messages.
  private comeBack(n: number, days: number, sim: FlowSim) {
    if (days > this.cfg.keep) {
      this.tally.lost += n
      return
    }
    for (let i = 0; i < n; i++) {
      const id = this.nextMessage++
      const msg: Message = { id, at: sim.tick, kind: 'backlog', media: false, pushes: DEVICES, gateway: '', stored: true, delivered: false, failed: false }
      this.messages.set(id, msg)
      this.waiting.add(id)
      this.notice(msg, 'backlog', sim, '')
    }
  }

  // --- Things thrown away ------------------------------------------------------------

  private fail(msg: Message, how: 'lost' | 'stale') {
    if (msg.failed) return
    msg.failed = true
    this.waiting.delete(msg.id)
    this.tally[how]++
  }

  private lose(job: Job) {
    if (job.from === 'beat') {
      this.tally.beatsLost++
      return
    }
    if (job.from === 'dot') {
      this.tally.dotsLost++
      return
    }
    if (job.from === 'receipt') {
      // A receipt that did not get through is sent again a second later.
      const tries = job.attempts ?? 0
      if (tries < RETRIES) this.after(RETRY_AFTER, (s) => this.sendReceipt(s, job.key ?? 1, tries + 1))
      else this.tally.stale += job.key ?? 1
      return
    }
    if (job.from === 'hello') {
      // A phone that cannot reconnect tries again a second later, and gives up after a few tries.
      const tries = job.attempts ?? 0
      if (tries < RETRIES) this.after(RETRY_AFTER, (s) => this.hello(s, tries + 1))
      else this.tally.stale++
      return
    }
    const msg = this.messages.get(job.msg!)
    if (!msg || msg.failed) return
    if (job.from === 'send' || job.from === 'write') {
      // The phone sends it again when no answer comes.
      const tries = job.attempts ?? 0
      if (tries < RETRIES) {
        this.after(RETRY_AFTER, (s) => {
          if (msg.failed || msg.stored) return
          const again = s.newJob(GATE_WORK, undefined, 'send')
          again.msg = msg.id
          again.attempts = tries + 1
          this.pass(again, 'send', 'phones', s)
        })
        return
      }
      return this.fail(msg, 'lost')
    }
    // A notice turned away: the message waits on the shard, but nothing tells the devices.
    this.fail(msg, 'stale')
  }

  // --- What the checks read ----------------------------------------------------------

  // Seconds the slowest message of the last 10 seconds took to be stored, or has been waiting so far.
  slowestStore() {
    const t = this.flow.tick
    const done = this.stores.filter((c) => t - c.at < RECENT).map((c) => c.delay)
    const open = [...this.waiting].map((id) => this.messages.get(id)!).filter((m) => !m.stored).map((m) => t - m.at)
    return Math.max(0, ...done, ...open) / SECOND
  }

  // Seconds the slowest message of the last 10 seconds took to reach the devices, or has been waiting so far.
  slowestDelivery() {
    const t = this.flow.tick
    const done = this.deliveries.filter((c) => t - c.at < RECENT).map((c) => c.delay)
    const open = [...this.waiting].map((id) => t - this.messages.get(id)!.at)
    return Math.max(0, ...done, ...open) / SECOND
  }

  // Share of the store that is full, 0 to 1 and over.
  full() {
    return (BASE_MB + this.cfg.keep * DAY_MB + this.tally.storedMB) / STORE_MB
  }

  // Seconds before a dead phone stops looking online.
  deadLate() {
    return 3 * this.cfg.beat
  }

  gatewayLoad() {
    if (!this.gateways.length) return 0
    return Math.max(...this.gateways.map((g) => g.load() / (GATE_SLOTS + GATE_LINE)))
  }

  storeLoad() {
    if (!this.shards.length) return 0
    return Math.max(...this.shards.map((s) => s.load() / SHARD_LINE))
  }

  // Notices and status updates waiting for a delivery worker.
  backlog() {
    return (this.queue?.load() ?? 0) + this.workers.reduce((n, p) => n + p.load(), 0)
  }
}
