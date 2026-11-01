import { FlowSim, type FlowNode, type Job } from '../../core/flow/engine'
import { SECOND, TICKS_PER_SECOND } from '../../core/flow/time'
import { Jam, Limiter, Net, Pool, Queue } from '../../core/flow/parts'

// A file-sync service at Dropbox's size, as a running system. One save goes through:
//   laptops → (limiter) → a metadata server → every copy written to a block shard
//   → a change notice → (queue) → a notifier → the other devices → the changed chunks read back
// The metadata server keeps the list of chunks each file is made of and checks which of them the
// store has. The learner places every machine: metadata servers on the laptops' side, notifiers
// on the devices' side, and the shards of the block store on the right.

export { SECOND, TICKS_PER_SECOND }

export const FILE_MB = 100 // an ordinary file
export const BIG_MB = 2000 // a big file with a one-line edit
export const COPY_MB = 600 // a file many people upload
export const SHIFT_MB = 200 // a file with a line added at the top
export const EDIT_MB = 1 // what an edit changes
export const STORM_MEMBERS = 1600 // devices in the shared folder that changes
export const MEMBERS = 8 // devices that hold an ordinary file
export const CHUNKS_PER_TICK = 20 // chunks a metadata server checks in one tick of work
export const META_BASE = 2
export const META_SLOTS = 4
export const META_LINE = 24
export const MB_PER_TICK = 4 // megabytes one shard slot writes in a tick
export const SHARD_SLOTS = 4
export const SHARD_LINE = 40
export const NOTIFY_PER = 0.25 // ticks a notifier needs to tell one device
export const BATCH = 10 // devices told in one go when notices are batched
const NOTICE_LINE = 1
const QUEUE_CAPACITY = 400
export const STORE_MB = 60000 // what the store holds, in all
const START_MB = 24000 // what it holds when the day begins
const RECENT = 10 * SECOND
const LINK = 4
const RETRIES = 2

export type Kind = 'edit' | 'big' | 'copy' | 'shift' | 'storm'

export interface Phase {
  from: number // tick
  saves: number // ordinary edits a second
  copies?: number // uploads of a file the store already has, a second
  shifts?: number // files with a line added at the top, a second
}

// A rate limiter standing in front of one lane.
export interface Limit {
  key: string
  lane: 'save' | 'notify'
  rate: number // requests per second it lets through
}

export interface Config {
  metas: string[] // metadata servers
  notifiers: string[]
  shards: string[]
  queue?: string
  limits: Limit[]
  chunk: number // megabytes in a chunk
  content: boolean // chunks cut where the content says, not every so many bytes
  dedupe: boolean // a chunk the store already has is not sent again
  copies: number // copies of every chunk
  batch: boolean // one notice for a batch of devices
  phases: Phase[]
  bigs: number[] // ticks when a big file is edited
  storms: number[] // ticks when a shared folder changes
  stormMembers: number // devices in that folder
  crash?: { at: number; down: number; shards: number } // the first `shards` shards go down together
  jam?: string[] // parts standing where requests cannot get through
}

export interface Tally {
  saves: number
  committed: number
  synced: number
  lost: number // changes lost, or files that could not be read back
  stale: number // devices never told, or never given the file
  limited: number
  sentMB: number
  storedMB: number
}

const blank = (): Tally => ({ saves: 0, committed: 0, synced: 0, lost: 0, stale: 0, limited: 0, sentMB: 0, storedMB: 0 })

interface Save {
  id: number
  at: number
  sentMB: number // megabytes of chunks that have to travel
  members: number
  meta: string
  left: number // copies still being written
  holders: string[] // shards holding a copy
  committed: boolean
  synced: boolean
  failed: boolean
}

// The people saving files: they also run the script of the day.
class Laptops implements FlowNode {
  alive = true
  readonly key = 'laptops'
  private site: Dropbox
  private due = { edit: 0, copy: 0, shift: 0 }
  constructor(site: Dropbox) {
    this.site = site
  }
  receive() {}
  emit(sim: FlowSim) {
    const d = this.site
    d.script(sim)
    const phase = d.phaseAt(sim.tick)
    if (phase) {
      this.due.edit += phase.saves / SECOND
      this.due.copy += (phase.copies ?? 0) / SECOND
      this.due.shift += (phase.shifts ?? 0) / SECOND
    }
    for (; this.due.edit >= 1; this.due.edit--) d.save(sim, 'edit')
    for (; this.due.copy >= 1; this.due.copy--) d.save(sim, 'copy')
    for (; this.due.shift >= 1; this.due.shift--) d.save(sim, 'shift')
    if (d.cfg.bigs.includes(sim.tick)) d.save(sim, 'big')
    if (d.cfg.storms.includes(sim.tick)) d.save(sim, 'storm')
  }
}

// The other devices: a change arrives here, and they ask the store for the chunks.
class Devices implements FlowNode {
  alive = true
  readonly key = 'devices'
  private site: Dropbox
  constructor(site: Dropbox) {
    this.site = site
  }
  receive(job: Job, sim: FlowSim) {
    this.site.pull(job, sim)
  }
}

export class Dropbox {
  readonly flow: Net
  readonly cfg: Config
  readonly tally = blank()
  readonly metas: Pool[] = []
  readonly notifiers: Pool[] = []
  readonly shards: Pool[] = []
  queue?: Queue
  private saves = new Map<number, Save>()
  private waiting = new Set<number>()
  private route: Record<'save' | 'notify', string[]> = { save: [], notify: [] }
  private commits: { at: number; delay: number }[] = []
  private syncs: { at: number; delay: number }[] = []
  private nextSave = 0
  private metaRound = 0
  private notifyRound = 0

  constructor(rng: () => number, cfg: Config) {
    this.cfg = cfg
    const flow = (this.flow = new Net(rng))
    flow.onLoss = (job) => this.lose(job)
    flow.traffic = () => {
      const phase = this.phaseAt(flow.tick)
      return phase ? phase.saves + (phase.copies ?? 0) + (phase.shifts ?? 0) : 0
    }
    flow.add(new Laptops(this))
    flow.add(new Devices(this))
    for (const l of cfg.limits) {
      flow.add(new Limiter(l.key, l.rate, () => this.tally.limited++, (job, sim) => this.pass(job, l.lane, l.key, sim)))
      this.route[l.lane].push(l.key)
    }
    cfg.shards.forEach((key) => {
      this.shards.push(flow.add(new Pool(key, SHARD_SLOTS, SHARD_LINE, (job, sim) => this.stored(job, sim))))
      flow.link('devices', key, LINK)
    })
    cfg.metas.forEach((key) => {
      this.metas.push(flow.add(new Pool(key, META_SLOTS, META_LINE, (job, sim) => this.checked(job, key, sim))))
      for (const s of cfg.shards) flow.link(key, s, 6)
    })
    cfg.notifiers.forEach((key) => {
      this.notifiers.push(flow.add(new Pool(key, 1, NOTICE_LINE, (job, sim) => this.told(job, key, sim))))
      flow.link(key, 'devices', LINK)
    })
    if (cfg.queue) {
      this.route.notify.push(cfg.queue)
      if (cfg.jam?.includes(cfg.queue)) flow.add(new Jam(cfg.queue))
      else this.queue = flow.add(new Queue(cfg.queue, QUEUE_CAPACITY, () => this.notifiers))
    }
    const save = this.route.save
    save.forEach((key, i) => flow.link(i === 0 ? 'laptops' : save[i - 1], key, LINK))
    const lastSave = save.length ? save[save.length - 1] : 'laptops'
    for (const m of cfg.metas) flow.link(lastSave, m, LINK)
    const notify = this.route.notify
    for (const m of cfg.metas) if (notify[0]) flow.link(m, notify[0], LINK)
    notify.forEach((key, i) => i > 0 && flow.link(notify[i - 1], key, LINK))
    const lastNotify = notify.length ? notify[notify.length - 1] : undefined
    for (const n of cfg.notifiers) {
      if (lastNotify) flow.link(lastNotify, n, cfg.queue === lastNotify ? 0 : LINK)
      else for (const m of cfg.metas) flow.link(m, n, LINK)
    }
  }

  phaseAt(tick: number) {
    return [...this.cfg.phases].reverse().find((p) => p.from <= tick)
  }

  // Crashes, once a tick.
  script(sim: FlowSim) {
    const { crash } = this.cfg
    if (!crash) return
    const down = this.shards.slice(0, crash.shards)
    if (sim.tick === crash.at) {
      for (const s of down) {
        s.alive = false
        sim.fail(s.key)
      }
    }
    if (sim.tick === crash.at + crash.down) for (const s of down) s.alive = true
  }

  // --- A save ---------------------------------------------------------------------------

  // Megabytes of chunks a save has to send, and the chunks of the whole file.
  private sizes(kind: Kind) {
    const { chunk, content, dedupe } = this.cfg
    const file = kind === 'big' ? BIG_MB : kind === 'copy' ? COPY_MB : kind === 'shift' ? SHIFT_MB : FILE_MB
    const edited = Math.min(file, Math.ceil(EDIT_MB / chunk) * chunk)
    let sent = edited
    if (kind === 'copy') sent = dedupe ? 0 : file
    // A line added at the top moves every fixed-size chunk, so none of them matches any more.
    if (kind === 'shift' && !content) sent = file
    return { sent, chunks: Math.ceil(file / chunk) }
  }

  save(sim: FlowSim, kind: Kind) {
    const id = this.nextSave++
    const { sent, chunks } = this.sizes(kind)
    const save: Save = { id, at: sim.tick, sentMB: sent, members: kind === 'storm' ? this.cfg.stormMembers : MEMBERS, meta: '', left: 0, holders: [], committed: false, synced: false, failed: false }
    this.saves.set(id, save)
    this.waiting.add(id)
    this.tally.saves++
    this.tally.sentMB += sent
    const job = sim.newJob(META_BASE + Math.ceil(chunks / CHUNKS_PER_TICK), undefined, 'save')
    job.msg = id
    this.pass(job, 'save', 'laptops', sim)
  }

  // Send a request on to whatever stands after `from` in its lane.
  pass(job: Job, lane: 'save' | 'notify', from: string, sim: FlowSim) {
    const route = this.route[lane]
    const next = route[route.indexOf(from) + 1]
    if (next) return sim.forward(job, from, next)
    if (lane === 'save') {
      const online = this.metas.filter((m) => m.alive)
      if (!online.length) return sim.drop(job, from)
      return sim.forward(job, from, online[this.metaRound++ % online.length].key)
    }
    const online = this.notifiers.filter((n) => n.alive)
    if (!online.length) return sim.drop(job, from)
    sim.forward(job, from, online[this.notifyRound++ % online.length].key)
  }

  // A metadata server has checked the chunk list: write the chunks that are new.
  private checked(job: Job, meta: string, sim: FlowSim) {
    const save = this.saves.get(job.msg!)
    if (!save || save.failed) return
    save.meta = meta
    const copies = Math.min(this.cfg.copies, this.shards.length)
    if (save.sentMB === 0 || copies === 0) return this.commit(save, sim)
    save.left = copies
    const work = Math.ceil(save.sentMB / MB_PER_TICK) + 1
    for (let k = 0; k < copies; k++) {
      const shard = this.shards[(save.id + k) % this.shards.length].key
      const write = sim.newJob(work, undefined, 'write')
      write.msg = save.id
      write.via = shard
      sim.forward(write, meta, shard)
    }
  }

  // A shard has written a copy, or read a chunk back.
  private stored(job: Job, sim: FlowSim) {
    const save = this.saves.get(job.msg!)
    if (!save) return
    if (job.from === 'write') {
      if (save.failed) return
      save.holders.push(job.via!)
      this.tally.storedMB += save.sentMB
      return this.copyDone(save, sim)
    }
    if (save.synced || save.failed) return
    save.synced = true
    this.waiting.delete(save.id)
    this.tally.synced++
    this.syncs.push({ at: sim.tick, delay: sim.tick - save.at })
    job.createdAt = save.at
    sim.complete(job)
  }

  private copyDone(save: Save, sim: FlowSim) {
    if (--save.left > 0) return
    this.commit(save, sim)
  }

  private commit(save: Save, sim: FlowSim) {
    if (save.committed) return
    if (save.sentMB > 0 && save.holders.length === 0) return this.fail(save, 'lost')
    save.committed = true
    this.tally.committed++
    this.commits.push({ at: sim.tick, delay: sim.tick - save.at })
    const per = this.cfg.batch ? NOTIFY_PER / BATCH : NOTIFY_PER
    const notice = sim.newJob(Math.max(1, Math.ceil(save.members * per)), undefined, 'notice')
    notice.msg = save.id
    this.pass(notice, 'notify', save.meta, sim)
  }

  // A notifier has told the devices: they ask the store for the chunks.
  private told(job: Job, notifier: string, sim: FlowSim) {
    const save = this.saves.get(job.msg!)
    if (!save || save.failed) return
    const pull = sim.newJob(1, undefined, 'pull')
    pull.msg = save.id
    pull.createdAt = save.at
    sim.forward(pull, notifier, 'devices')
  }

  // The devices ask a shard that holds the chunks.
  pull(job: Job, sim: FlowSim) {
    const save = this.saves.get(job.msg!)
    if (!save || save.failed) return
    const pool = save.holders.length ? this.shards.filter((s) => save.holders.includes(s.key)) : this.shards
    const alive = pool.filter((s) => s.alive)
    if (!alive.length) return this.fail(save, 'lost')
    job.work = Math.ceil(Math.max(1, save.sentMB) / (2 * MB_PER_TICK)) + 1
    job.remaining = job.work
    sim.forward(job, 'devices', alive[save.id % alive.length].key)
  }

  private fail(save: Save, how: 'lost' | 'stale') {
    if (save.failed) return
    save.failed = true
    this.waiting.delete(save.id)
    this.tally[how]++
  }

  // Something was thrown away on its way.
  private lose(job: Job) {
    const save = this.saves.get(job.msg!)
    if (!save || save.failed) return
    if (job.from === 'save') return this.fail(save, 'lost')
    if (job.from === 'write') {
      if (--save.left > 0) return
      if (save.holders.length === 0) return this.fail(save, 'lost')
      return this.commit(save, this.flow)
    }
    // A device whose shard went away asks another shard that holds the chunks.
    if (job.from === 'pull' && (job.attempts ?? 0) < RETRIES) {
      job.attempts = (job.attempts ?? 0) + 1
      return this.pull(job, this.flow)
    }
    this.fail(save, 'stale')
  }

  // --- What the checks read -----------------------------------------------------

  // Seconds the slowest save of the last 10 seconds took to be safe, or has been waiting so far.
  slowestSave() {
    const t = this.flow.tick
    const done = this.commits.filter((c) => t - c.at < RECENT).map((c) => c.delay)
    const open = [...this.waiting].map((id) => this.saves.get(id)!).filter((s) => !s.committed).map((s) => t - s.at)
    return Math.max(0, ...done, ...open) / SECOND
  }

  // Seconds the slowest change of the last 10 seconds took to reach the other devices, or has been waiting so far.
  slowestSync() {
    const t = this.flow.tick
    const done = this.syncs.filter((c) => t - c.at < RECENT).map((c) => c.delay)
    const open = [...this.waiting].map((id) => t - this.saves.get(id)!.at)
    return Math.max(0, ...done, ...open) / SECOND
  }

  // Share of the store that is full, 0 to 1 and over.
  full() {
    return (START_MB + this.tally.storedMB) / STORE_MB
  }

  // Share of the metadata servers' slots that are taken, 0 to 1.
  metaLoad() {
    if (!this.metas.length) return 0
    return Math.max(...this.metas.map((m) => m.load() / (META_SLOTS + META_LINE)))
  }

  // The busiest shard, 0 to 1.
  storeLoad() {
    if (!this.shards.length) return 0
    return Math.max(...this.shards.map((s) => s.load() / SHARD_LINE))
  }

  // Notices waiting for a notifier.
  backlog() {
    return (this.queue?.load() ?? 0) + this.notifiers.reduce((n, p) => n + p.load(), 0)
  }
}
