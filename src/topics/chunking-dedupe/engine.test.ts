import { describe, expect, it } from 'vitest'
import { BASE_FILE, chunkOf, ChunkSim, cut, FILE_UNITS } from './engine'
import type { ChunkState } from './types'
import { TICKS_PER_SECOND } from './world'

const BASE: ChunkState = { mode: 'fixed', size: 6, ask: true, edit: 0, insert: 0, copy: 0, round: 0 }

function run(sim: ChunkSim, seconds: number) {
  for (let t = 0; t < TICKS_PER_SECOND * seconds; t++) sim.step()
}

function start(st: Partial<ChunkState> = {}) {
  const sim = new ChunkSim()
  const state = { ...BASE, ...st }
  sim.apply(state)
  return { sim, state }
}

// Does one thing and lets everything settle.
function act(sim: ChunkSim, state: ChunkState, what: 'edit' | 'insert' | 'copy') {
  const next = { ...state, [what]: state[what] + 1 }
  sim.apply(next)
  run(sim, 6)
  return next
}

describe('chunking', () => {
  it('keeps every unit of the file, in order', () => {
    for (const mode of ['whole', 'fixed', 'content'] as const) {
      for (const size of [2, 3, 4, 6, 8, 12]) expect(cut(BASE_FILE, mode, size).flat()).toEqual(BASE_FILE)
    }
  })

  it('cuts the whole file into one chunk, and a fixed file every N units', () => {
    expect(cut(BASE_FILE, 'whole', 4)).toHaveLength(1)
    expect(cut(BASE_FILE, 'fixed', 6).map((c) => c.length)).toEqual([6, 6, 6, 6])
    expect(cut(BASE_FILE, 'fixed', 5).map((c) => c.length)).toEqual([5, 5, 5, 5, 4])
  })

  it('cuts by content into chunks of uneven length, near the chosen size', () => {
    const lens = cut(BASE_FILE, 'content', 4).map((c) => c.length)
    expect(new Set(lens).size).toBeGreaterThan(1)
    expect(lens.length).toBeGreaterThanOrEqual(5)
    expect(lens.length).toBeLessThanOrEqual(7)
  })

  it('names a chunk by what is inside it', () => {
    expect(chunkOf([1, 2, 3]).name).toBe(chunkOf([1, 2, 3]).name)
    expect(chunkOf([1, 2, 3]).hash).not.toBe(chunkOf([1, 2, 4]).hash)
  })
})

describe('uploads', () => {
  it('starts with the file stored once', () => {
    const { sim } = start()
    expect(sim.metrics.stored).toBe(FILE_UNITS)
    expect(sim.metrics.unique).toBe(FILE_UNITS)
  })

  it('sends the whole file when it is not cut', () => {
    const { sim, state } = start({ mode: 'whole' })
    act(sim, state, 'edit')
    expect(sim.metrics.sentLast).toBe(FILE_UNITS)
  })

  it('sends only the changed chunk when it is cut and the store is asked', () => {
    const { sim, state } = start()
    act(sim, state, 'edit')
    expect(sim.metrics.sentLast).toBe(6)
    expect(sim.metrics.waiting).toBe(0)
  })

  it('sends every chunk when it does not ask, and stores them again', () => {
    const { sim, state } = start({ ask: false })
    act(sim, state, 'edit')
    expect(sim.metrics.sentLast).toBe(FILE_UNITS)
    expect(sim.metrics.stored).toBeGreaterThan(sim.metrics.unique)
  })

  it('sends nothing for a file the store already has, when it asks', () => {
    const { sim, state } = start()
    act(sim, state, 'copy')
    expect(sim.metrics.sentLast).toBe(0)
    expect(sim.metrics.stored).toBe(sim.metrics.unique)
    expect(sim.metrics.waiting).toBe(0)
  })

  it('stores a copy twice when it does not ask', () => {
    const { sim, state } = start({ ask: false })
    act(sim, state, 'copy')
    expect(sim.metrics.sentLast).toBe(FILE_UNITS)
    expect(sim.metrics.stored).toBe(FILE_UNITS * 2)
  })

  it('stores a chunk once even when the same chunk appears twice in a file', () => {
    const { sim, state } = start({ size: 2 })
    act(sim, state, 'edit')
    act(sim, { ...state, edit: 1 }, 'copy')
    expect(sim.metrics.stored).toBe(sim.metrics.unique)
  })
})

describe('a line added at the top', () => {
  it('moves every fixed chunk, so all of them are sent', () => {
    const { sim, state } = start({ size: 4 })
    act(sim, state, 'insert')
    expect(sim.metrics.sentLast).toBeGreaterThanOrEqual(FILE_UNITS)
  })

  it.each([3, 4, 6])('changes one chunk when the cuts follow the content, size %i', (size) => {
    const { sim, state } = start({ mode: 'content', size })
    act(sim, state, 'insert')
    const first = cut(BASE_FILE, 'content', size)[0].length
    expect(sim.metrics.sentLast).toBe(first + 1)
  })
})

describe('a change in the middle', () => {
  it.each([3, 4, 6])('sends about one chunk, size %i', (size) => {
    for (const mode of ['fixed', 'content'] as const) {
      const { sim, state } = start({ mode, size })
      act(sim, state, 'edit')
      expect(sim.metrics.sentLast, `${mode} ${size}`).toBeLessThanOrEqual(size * 2)
      expect(sim.metrics.sentLast, `${mode} ${size}`).toBeGreaterThan(0)
    }
  })

  it('starts again when the way of cutting changes', () => {
    const { sim, state } = start()
    const after = act(sim, state, 'edit')
    sim.apply({ ...after, size: 3 })
    expect(sim.metrics.edits).toBe(0)
    expect(sim.metrics.chunks).toBe(8)
  })
})
