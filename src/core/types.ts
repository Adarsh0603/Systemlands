import type { ComponentType } from 'react'
import type { BuildTask } from './build/types'

// Shared shapes for every topic. A topic supplies its own state (S),
// simulation (Sim), live metrics (M) and beat type (B); the core player and
// iso viewport work with any of them.

export type V3 = [number, number, number]

export type Level = 'Beginner' | 'Intermediate' | 'Advanced'

// Where the camera looks. `fit` lets a topic zoom out further when its scene
// is crowded.
export interface Shot {
  target: V3
  zoom: number
  fit?: boolean
}

export interface Challenge<S, Sim, M> {
  goal: string
  win: string
  holdSeconds: number
  check: (ctx: { m: M; st: S; sim: Sim }) => boolean
  // How much of the goal is done, 0 to 1, for a goal reached in several steps.
  // The bar shows this instead of the hold timer.
  progress?: (ctx: { m: M; st: S; sim: Sim }) => number
  // A checklist under the goal that fills in as the learner works through it.
  parts?: (ctx: { m: M; st: S; sim: Sim }) => { label: string; state: 'todo' | 'pass' | 'fail' }[]
}

// A beat that changes state on a timer, e.g. traffic climbing. `next` returns
// null once it's done.
export interface Ramp<S> {
  everyMs: number
  next: (st: S) => S | null
}

// A "what happens next?" question asked before a beat plays. The beat's setup
// is shown, frozen, and the learner answers by tapping a thing in the scene.
export interface Predict {
  // The one fact the guess depends on, shown with the question (the caption
  // and labels are hidden while it's open).
  clue: string
  question: string
  options: { label: string; at: V3 }[] // tap targets, pinned in the world
  answer: number // index into options
}

// A tappable label pinned in the scene: a question's options, or the answer
// once it's been given.
export interface Marker {
  at: V3
  label: string
  tone: 'ask' | 'answer'
  onPick?: () => void
}

// What every beat has. Topics extend this with their own fields (labels,
// which stats and controls to show, ...).
export interface BaseBeat<S, Sim, M> {
  caption?: string
  sub?: string
  set?: Partial<S>
  ramp?: Ramp<S>
  shot?: Shot
  challenge?: Challenge<S, Sim, M>
  predict?: Predict
}

export interface Chapter<S, B> {
  title: string
  level: Level
  initial: S
  beats: B[]
  // A "Build it" chapter: instead of playing beats, the learner assembles
  // the system themselves.
  build?: BuildTask
}

export type Update<S> = (change: (prev: S) => Partial<S>) => void

// A running simulation as the player sees it.
export interface Runtime<Sim, M> {
  sim: Sim
  simRef: { current: Sim | null }
  lastTickAt: { current: number }
  metrics: M
  tick: number
}

export interface SceneProps<S, Sim, B> {
  simRef: { current: Sim | null }
  lastTickAt: { current: number }
  st: S
  beat: B
  shot: Shot
  shake: number
  update: Update<S>
  // While a question is open: hide labels that would give the answer away,
  // and show these tap targets instead.
  quiet: boolean
  markers: Marker[]
}

export interface PanelProps<S, Sim, M, B> {
  st: S
  sim: Sim
  m: M
  beat: B
  update: Update<S>
  stopRamp: () => void
}

export interface Reference {
  interview: string[]
  cards: { title: string; body: string }[]
}

// Everything the core player needs from a topic to play it.
export interface TopicSpec<S, Sim, M, B extends BaseBeat<S, Sim, M>> {
  chapters: Chapter<S, B>[]
  // A hook: owns the running simulation. Reads the latest state through stRef.
  // While `paused`, the simulation doesn't advance.
  useRuntime: (stRef: { current: S }, paused: boolean) => Runtime<Sim, M>
  // Make the simulation match the state.
  sync: (sim: Sim, st: S) => void
  Scene: ComponentType<SceneProps<S, Sim, B>>
  Stats: ComponentType<PanelProps<S, Sim, M, B>>
  Controls: ComponentType<PanelProps<S, Sim, M, B>>
  // Which state changes deserve a crash (shake + sound) or a rise sound.
  feedback: (prev: S, next: S) => { crash?: boolean; rise?: boolean }
  // Total requests dropped so far, for the drop sound.
  dropCount: (sim: Sim) => number
}
