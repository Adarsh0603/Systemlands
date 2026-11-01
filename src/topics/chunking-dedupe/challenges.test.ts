import { describe, expect, it } from 'vitest'
import { stateAt } from '../../core/chapters'
import { CHAPTERS } from './chapters'
import { ChunkSim } from './engine'
import type { ChunkState } from './types'
import { TICKS_PER_SECOND } from './world'

// The state at a chapter's practice challenge, with its checker.
function challenge(chapter: number) {
  const ch = CHAPTERS[chapter]
  const beat = ch.beats.findIndex((b) => b.challenge)
  return { st: stateAt(ch, beat), goal: ch.beats[beat].challenge! }
}

function play(st: ChunkState, steps: ((s: ChunkState) => ChunkState)[], seconds = 6) {
  const sim = new ChunkSim()
  let cur = st
  sim.apply(cur)
  for (const step of steps) {
    cur = step(cur)
    sim.apply(cur)
    for (let t = 0; t < TICKS_PER_SECOND * seconds; t++) sim.step()
  }
  return { sim, st: cur }
}

const edit = (s: ChunkState) => ({ ...s, edit: s.edit + 1 })
const insert = (s: ChunkState) => ({ ...s, insert: s.insert + 1 })
const copy = (s: ChunkState) => ({ ...s, copy: s.copy + 1 })
const set = (change: Partial<ChunkState>) => (s: ChunkState) => ({ ...s, ...change })
const won = (r: { sim: ChunkSim; st: ChunkState }, goal: ReturnType<typeof challenge>['goal']) => goal.check({ m: r.sim.metrics, st: r.st, sim: r.sim })

describe('chunking challenges', () => {
  it('every chapter but the first ends in a challenge that is not won by waiting', () => {
    for (let i = 1; i < CHAPTERS.length; i++) {
      const { st, goal } = challenge(i)
      expect(won(play(st, [(s) => s], 10), goal), CHAPTERS[i].title).toBe(false)
    }
  })

  it('cut it into chunks: needs chunks and an edit', () => {
    const { st, goal } = challenge(1)
    expect(won(play(st, [edit]), goal)).toBe(false)
    expect(won(play(st, [set({ mode: 'fixed' })]), goal)).toBe(false)
    expect(won(play(st, [set({ mode: 'fixed' }), edit]), goal)).toBe(true)
  })

  it('chunk size: sizes 3 and 4 win, 2 makes a long list, 6 and up send too much', () => {
    const { st, goal } = challenge(2)
    for (const [size, wins] of [[2, false], [3, true], [4, true], [6, false], [8, false], [12, false]] as const) {
      expect(won(play(st, [set({ size }), edit]), goal), `${size} lines`).toBe(wins)
    }
  })

  it('a name for each chunk: asking is what wins', () => {
    const { st, goal } = challenge(3)
    expect(won(play(st, [edit]), goal)).toBe(false)
    expect(won(play(st, [set({ ask: true }), edit]), goal)).toBe(true)
  })

  it('the same file twice: asking first, then a copy', () => {
    const { st, goal } = challenge(4)
    expect(won(play(st, [copy]), goal)).toBe(false)
    expect(won(play(st, [set({ ask: true })]), goal)).toBe(false)
    expect(won(play(st, [set({ ask: true }), copy]), goal)).toBe(true)
  })

  it('a line added at the top: only content cuts win', () => {
    const { st, goal } = challenge(5)
    expect(won(play(st, [insert]), goal)).toBe(false)
    expect(won(play(st, [set({ mode: 'content' })]), goal)).toBe(false)
    expect(won(play(st, [set({ mode: 'content' }), insert]), goal)).toBe(true)
  })

  it('which one to use: needs all three, content cuts, and asking', () => {
    const { st, goal } = challenge(6)
    const day = [edit, insert, copy]
    expect(won(play(st, day), goal)).toBe(false)
    expect(won(play(st, [set({ mode: 'fixed', size: 4, ask: true }), ...day]), goal)).toBe(false)
    expect(won(play(st, [set({ mode: 'content', size: 4, ask: false }), ...day]), goal)).toBe(false)
    expect(won(play(st, [set({ mode: 'content', size: 4, ask: true }), ...day]), goal)).toBe(true)
    expect(won(play(st, [set({ mode: 'content', size: 4, ask: true }), edit, insert]), goal)).toBe(false)
  })
})
