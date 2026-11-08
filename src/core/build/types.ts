import type { ReactNode } from 'react'
import type { FlowSim, Job } from '../flow/engine'
import type { Shot, V3 } from '../types'

// "Build it": the learner drags pieces onto pads on the floor, and traffic
// flows through whatever they've assembled.

export type PieceKind = 'users' | 'balancer' | 'server' | 'app' | 'cache' | 'database' | 'replica' | 'autoscaler' | 'ring' | 'queue' | 'topic' | 'stream' | 'limiter' | 'breaker' | 'provider' | 'dead' | 'dedupe'

export const PIECE_NAMES: Record<PieceKind, string> = {
  users: 'Users',
  balancer: 'Load balancer',
  server: 'Server',
  app: 'App server',
  cache: 'Cache',
  database: 'Database',
  replica: 'Read replica',
  autoscaler: 'Autoscaler',
  ring: 'Hash ring',
  queue: 'Queue',
  topic: 'Topic',
  stream: 'Stream',
  limiter: 'Rate limiter',
  breaker: 'Circuit breaker',
  provider: 'Provider',
  dead: 'Dead-letter queue',
  dedupe: 'Dedupe store',
}

// Half the footprint of each piece: where requests leave and arrive.
export const HALF: Record<PieceKind, number> = {
  users: 0.95,
  balancer: 0.65,
  server: 0.55,
  app: 0.75,
  cache: 0.95,
  database: 0.85,
  replica: 0.65,
  autoscaler: 0.6,
  ring: 0.65,
  queue: 0.8,
  topic: 0.65,
  stream: 0.95,
  limiter: 0.65,
  breaker: 0.65,
  provider: 0.85,
  dead: 0.8,
  dedupe: 0.65,
}

// A spot on the floor where pieces can be dropped.
export interface Pad {
  id: string
  x: number
  z: number
  accepts: PieceKind[]
}

// Something already in place that can't be moved, like the users.
export interface FixedPiece {
  id: string
  kind: PieceKind
  x: number
  z: number
}

// Which piece sits on each pad, by pad id.
export type Placement = Record<string, PieceKind>

export interface BuildMetrics {
  dropRate: number // percent, over the last few seconds
  avgMs: number
  busy: Record<string, number> // node key → how busy its workers were, 0–1
  busiest: number // the highest of those
  latency: Record<string, number> // source key → recent average response, ms
}

// A number the learner can adjust once a piece is placed, e.g. cache size.
export interface BuildSetting {
  id: string
  label: string // singular unit, e.g. "item"
  when: PieceKind
  min: number
  max: number
  step: number
  initial: number
  // Names for the values min…max, when the setting is a choice, not a count.
  options?: string[]
  // A count with many values shows as a slider, with this unit after the number.
  slider?: { unit: string }
}

export type Settings = Record<string, number>

// A live number shown at the top: busy-ness of one node, response time of
// one source, or (by default) the busiest server.
export type Watch =
  | { kind: 'busy'; key: string; label: string }
  | { kind: 'latency'; key: string; label: string; limitMs: number }
  // Anything the task tracks itself, read off the running system.
  | { kind: 'note'; label: string; read: (flow: FlowSim) => { text: string; bad: boolean } }

// One line of a capstone's requirement checks: the win needs every one to hold.
export interface Requirement {
  label: string
  says: string // the requirement in a plain sentence, listed in the brief
  read: (flow: FlowSim, m: BuildMetrics) => { text: string; ok: boolean }
}

// A build problem told as cause and pointer, not as numbers: why it broke, and which
// part of the design to look at, without saying what to put there.
export interface Diagnosis {
  because: string
  look?: string
}

export interface BuildTask {
  title: string
  // A capstone's client brief: pinned on screen the whole time, not a popup.
  pinned?: { title: string; lines: string[] }
  // What the finished system must satisfy, as checks that turn green live.
  requirements?: Requirement[]
  sub: string
  // The situation in plain words, one paragraph each, shown before building.
  brief?: string[]
  // Any piece may go on any pad, and nothing lights up to show where one fits.
  anywhere?: boolean
  // Stop the run the moment any requirement breaks, and say which and why.
  failFast?: boolean
  // Hold traffic back until the learner presses Start, so they can build first.
  manualStart?: boolean
  goal: string
  goalShort?: string // the goal in a few words, for when it's folded away
  win: string
  // What the win popup teaches, in this order: the problem the design avoided, the choice that won,
  // what it costs, and the next problem. When set, the popup shows these and the result as a small line.
  lesson?: { without: string; choice: string; cost: string; next?: string }
  holdSeconds: number
  // About how long a run takes to judge, hold included, so the learner knows to wait.
  testSeconds?: number
  rps: number
  shot: Shot
  fixed: FixedPiece[]
  // Names written on the floor, for scenes with several similar pieces.
  labels?: { at: V3; text: string }[]
  pads: Pad[]
  toolbox: { kind: PieceKind; count: number }[]
  // Names that replace the standard ones, when a piece plays a different part here.
  // The standard name then shows under it, as the piece's type.
  names?: Partial<Record<PieceKind, string>>
  // One line per piece: what it does, shown in the toolbox before it is placed.
  hints?: Partial<Record<PieceKind, string>>
  // The run as a strip of named phases (start tick of each), so a long scripted
  // run reads as a day with a shape, not as random traffic. Later phases show
  // by name only.
  timeline?: { phases: { name: string; from: number }[]; end: number }
  // Replaces the "Testing your build" line while it returns text, e.g. once the traffic is over.
  statusNote?: (flow: FlowSim) => string | null
  settings?: BuildSetting[]
  watch?: Watch[]
  // Turn a placement into a running system. Node keys are the fixed pieces'
  // and pads' ids, so the scene knows where to draw each node. A node the
  // system adds on an empty pad by itself (an autoscaler's server) is drawn
  // as the first piece that pad accepts.
  // Fill of a request in flight, when requests differ (e.g. by product);
  // undefined draws it hollow.
  jobFill?: (job: Job, flow: FlowSim) => string | undefined
  // Extra live drawing in the scene, in world coordinates: tags that follow
  // the numbers, markers, anything the generic pieces can't show.
  decorate?: (flow: FlowSim, placed: Placement, settings: Settings) => ReactNode
  // Which requests are answered back to whoever asked, so the answer is drawn travelling home.
  // Leave it out for one-way systems (uploads, posts, crawling).
  replies?: (job: Job) => boolean
  assemble: (placed: Placement, settings: Settings, rng?: () => number) => FlowSim
  // `flow` is the running system, for goals the numbers alone can't judge.
  // Says what's going wrong with the build right now, if anything, so the
  // learner knows why it isn't working.
  problem?: (m: BuildMetrics, placed: Placement, settings: Settings, flow: FlowSim) => string | null
  // The same, as cause + where to look. When set, the cards show it instead of `problem`.
  diagnose?: (m: BuildMetrics, placed: Placement, settings: Settings, flow: FlowSim) => Diagnosis | null
  // Every run gets its own day (a little more traffic, a later restart), so a design
  // tuned to the exact numbers of one run fails the next. The task reads it from `rng`.
  freshDay?: boolean
  // What the finished run achieved, in its own numbers: shown on the win card instead of `win`.
  result?: (m: BuildMetrics, placed: Placement, settings: Settings, flow: FlowSim) => string | null
  // After HINT_AFTER failed runs (counted again after each hint) the failure card also says why. Unlike `problem`, it may name the cause.
  hint?: (m: BuildMetrics, placed: Placement, settings: Settings, flow: FlowSim) => string | null
  check: (m: BuildMetrics, placed: Placement, settings: Settings, flow?: FlowSim) => boolean
}
