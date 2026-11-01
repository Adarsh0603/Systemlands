// A file sent to a store, in chunks:
//
//   Laptop ──▶ Store
//
// The file is a row of units (think of each as a line). The laptop cuts it into chunks and
// gives every chunk a short name made from what is inside it, so the same chunk always has
// the same name, whoever holds it.
//
//   - With `ask`, the laptop sends the list of names first. The store answers with the ones
//     it lacks, and only those chunks travel.
//   - Without it, every chunk travels, and the store keeps what it is given.
//
// A file is cut one of three ways:
//   whole:   one chunk, the whole file
//   fixed:   every `size` units
//   content: after a unit whose neighbourhood matches a pattern, so the cuts follow what is
//            written and not where it sits

import type { ChunkState, Mode } from './types'
import { TICKS_PER_SECOND } from './world'

const LATENCY = 20 // ticks for a message to cross
const GAP = 3 // ticks between two chunks leaving the laptop
const FLASH = 70 // ticks a changed unit stays marked

function mix(a: number, b: number) {
  let h = Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca6b)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  h = Math.imul(h, 0x297a2d39)
  h ^= h >>> 15
  return h >>> 0
}

// The file every run starts from.
// The numbers are what is written on each line. A line whose number divides by the chunk size ends a chunk.
export const BASE_FILE: number[] = [28, 11, 33, 30, 12, 40, 29, 53, 44, 18, 41, 39, 13, 9, 24, 10, 41, 22, 12, 35, 29, 11, 29, 32]
export const FILE_UNITS = BASE_FILE.length
// Lines in the middle of the file that an edit changes, one after another.
const EDITS = [6, 16, 10, 7, 15, 11, 8, 18]
// New lines get numbers that divide by no chunk size, so they never end a chunk.
const NEW_FROM = 1001
const NEW_STEP = 12

// Cut a file into chunks.
export function cut(file: number[], mode: Mode, size: number): number[][] {
  if (mode === 'whole') return [file]
  const out: number[][] = []
  let cur: number[] = []
  for (let i = 0; i < file.length; i++) {
    cur.push(file[i])
    const last = i === file.length - 1
    const edge = mode === 'fixed' ? cur.length >= size : cur.length >= 2 && file[i] % size === 0
    if (edge && !last) {
      out.push(cur)
      cur = []
    }
  }
  if (cur.length) out.push(cur)
  return out
}

export interface Chunk {
  units: number[]
  hash: number
  name: string
  color: number
}

const LETTERS = 'abcdefghjkmnpqrstuvwxyz'
export function chunkOf(units: number[]): Chunk {
  let h = 17
  for (const u of units) h = mix(h, u)
  return { units, hash: h, name: `${LETTERS[h % LETTERS.length]}${(h >>> 8) % 10}`, color: (h >>> 4) % 5 }
}

export interface Stored {
  chunk: Chunk
  copies: number
}

interface Wire {
  id: number
  from: 'laptop' | 'store'
  to: 'laptop' | 'store'
  sentAt: number
  arrive: number
}

export type Body =
  | { kind: 'list'; n: number; count: number }
  | { kind: 'need'; n: number; count: number }
  | { kind: 'chunk'; n: number; at: number; len: number; color: number }

export type Msg = Wire & Body

interface Upload {
  n: number
  chunks: Chunk[]
}

export interface ChunkMetrics {
  uploads: number
  edits: number
  inserts: number
  copies: number
  chunks: number // chunks in the file now
  sentLast: number // units sent for the last upload
  sentTotal: number
  stored: number // units the store holds, counting every copy
  unique: number // units of different chunks
  waiting: number // uploads not yet finished
}

export class ChunkSim {
  msgs: Msg[] = []
  tick = 0
  file: number[] = [...BASE_FILE]
  chunks: Chunk[] = []
  store: Stored[] = []
  changed: { i: number; at: number }[] = []
  who = ''
  whoAt = -9999

  private st: ChunkState = { mode: 'whole', size: 4, ask: true, edit: 0, insert: 0, copy: 0, round: 0 }
  private cfg: string | null = null
  private seen = { edit: 0, insert: 0, copy: 0 }
  private due: ('edit' | 'insert' | 'copy')[] = []
  private uploads = new Map<number, Upload>()
  private msgId = 0
  private upId = 0
  private edits = 0
  private inserts = 0
  private copiesDone = 0
  private sentLast = 0
  private sentTotal = 0
  private unit = NEW_FROM

  private fresh() {
    const u = this.unit
    this.unit += NEW_STEP
    return u
  }

  apply(st: ChunkState) {
    this.st = st
    const cfg = [st.mode, st.size, st.ask, st.round].join('|')
    const first = this.cfg === null
    if (first || cfg !== this.cfg) {
      this.cfg = cfg
      this.reset()
      this.seen = { edit: st.edit, insert: st.insert, copy: st.copy }
    }
    for (const key of ['edit', 'insert', 'copy'] as const) {
      if (st[key] > this.seen[key]) this.due.push(key)
      this.seen[key] = st[key]
    }
  }

  private reset() {
    this.msgs = []
    this.file = [...BASE_FILE]
    this.chunks = cut(this.file, this.st.mode, this.st.size).map(chunkOf)
    this.store = []
    for (const c of this.chunks) this.keep(c)
    this.changed = []
    this.who = ''
    this.whoAt = -9999
    this.uploads.clear()
    this.due = []
    this.upId = this.edits = this.inserts = this.copiesDone = this.sentLast = this.sentTotal = 0
    this.unit = NEW_FROM
  }

  private keep(c: Chunk) {
    const have = this.store.find((s) => s.chunk.hash === c.hash)
    if (have) have.copies++
    else this.store.push({ chunk: c, copies: 1 })
  }

  private has(hash: number) {
    return this.store.some((s) => s.chunk.hash === hash)
  }

  private send(from: Wire['from'], to: Wire['to'], body: Body, delay = 0) {
    this.msgs.push({ id: this.msgId++, from, to, sentAt: this.tick + delay, arrive: this.tick + delay + LATENCY, ...body })
  }

  // The file changes, and the laptop uploads it.
  private act(what: 'edit' | 'insert' | 'copy') {
    if (what === 'edit') {
      const p = EDITS[this.edits % EDITS.length]
      this.file = this.file.map((u, i) => (i === p ? this.fresh() : u))
      this.changed = [{ i: p, at: this.tick }]
      this.edits++
      this.who = 'A line changed'
    } else if (what === 'insert') {
      this.file = [this.fresh(), ...this.file]
      this.changed = [{ i: 0, at: this.tick }]
      this.inserts++
      this.who = 'A line added at the top'
    } else {
      this.changed = []
      this.copiesDone++
      this.who = 'Another person uploads it'
    }
    this.whoAt = this.tick
    this.chunks = cut(this.file, this.st.mode, this.st.size).map(chunkOf)
    const n = ++this.upId
    this.uploads.set(n, { n, chunks: this.chunks })
    if (this.st.ask) this.send('laptop', 'store', { kind: 'list', n, count: this.chunks.length })
    else this.sendChunks(n, this.chunks)
  }

  private sendChunks(n: number, list: Chunk[]) {
    const units = list.reduce((a, c) => a + c.units.length, 0)
    this.sentLast = units
    this.sentTotal += units
    if (!list.length) this.uploads.delete(n)
    list.forEach((c, k) => this.send('laptop', 'store', { kind: 'chunk', n, at: k, len: c.units.length, color: c.color }, k * GAP))
  }

  step() {
    this.tick++
    const t = this.tick
    const due = this.msgs.filter((m) => m.arrive <= t)
    this.msgs = this.msgs.filter((m) => m.arrive > t)
    for (const m of due) {
      const up = this.uploads.get(m.n)
      if (!up) continue
      if (m.kind === 'list') {
        // The store names the chunks it lacks, once each.
        const seen = new Set<number>()
        const need = up.chunks.filter((c) => {
          if (this.has(c.hash) || seen.has(c.hash)) return false
          seen.add(c.hash)
          return true
        })
        this.uploads.set(m.n, { n: m.n, chunks: need })
        this.send('store', 'laptop', { kind: 'need', n: m.n, count: need.length })
      } else if (m.kind === 'need') {
        this.sendChunks(m.n, up.chunks)
      } else {
        const c = up.chunks[m.at]
        if (c) this.keep(c)
        if (m.at === up.chunks.length - 1) this.uploads.delete(m.n)
      }
    }
    const next = this.due.shift()
    if (next) this.act(next)
    this.changed = this.changed.filter((c) => t - c.at < FLASH)
  }

  get metrics(): ChunkMetrics {
    let stored = 0
    let unique = 0
    for (const s of this.store) {
      stored += s.chunk.units.length * s.copies
      unique += s.chunk.units.length
    }
    return {
      uploads: this.upId,
      edits: this.edits,
      inserts: this.inserts,
      copies: this.copiesDone,
      chunks: this.chunks.length,
      sentLast: this.sentLast,
      sentTotal: this.sentTotal,
      stored,
      unique,
      waiting: this.uploads.size,
    }
  }
}

export { TICKS_PER_SECOND }
