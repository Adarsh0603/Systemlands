import { describe, expect, it } from 'vitest'
import { Running } from '../../core/build/run'
import type { BuildTask, Placement, Settings } from '../../core/build/types'
import { DROPBOX, FIRST_DESIGN, SCALE_UP, dropboxOf } from './build'

const without = (placed: Placement, ...ids: string[]) => Object.fromEntries(Object.entries(placed).filter(([id]) => !ids.includes(id))) as Placement

const rngOf = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function win(task: BuildTask, placed: Placement, settings: Settings, seed = 0, seconds = 72) {
  const run = new Running(task.assemble(placed, settings, seed ? rngOf(seed) : undefined))
  let held = 0
  for (let t = 0; t < seconds * 20; t++) {
    run.step()
    // The game stops a run the moment any requirement breaks.
    if (task.requirements?.some((r) => !r.read(run.flow, run.metrics()).ok)) return false
    held = task.check(run.metrics(), placed, settings, run.flow) ? held + 1 : 0
    if (held >= task.holdSeconds * 20) return true
  }
  return false
}

const FIRST: Placement = { m1: 'app', q1: 'queue', n1: 'app', s2: 'database' }

describe('first design', () => {
  it('wins with a queue, a metadata server, a notifier and a shard', () => {
    expect(win(FIRST_DESIGN, FIRST, {})).toBe(true)
  })
  it.each([
    ['no queue', without(FIRST, 'q1')],
    ['a queue behind the notifier', { ...without(FIRST, 'q1'), q1: 'app', s2: 'queue', n1: 'app' } as Placement],
    ['no metadata server', without(FIRST, 'm1')],
    ['no notifier', without(FIRST, 'n1')],
    ['no shard', without(FIRST, 's2')],
    ['nothing', {} as Placement],
  ])('fails with %s', (_name, placed) => {
    expect(win(FIRST_DESIGN, placed, {})).toBe(false)
  })
})

const GOOD: Placement = { m1: 'app', m2: 'app', q1: 'queue', n1: 'app', n2: 'app', n3: 'app', s1: 'database', s2: 'database', s3: 'database' }
const GOOD_SET: Settings = { chunk: 4, content: 1, dedupe: 1, copies: 3, batch: 1 }

describe('where it breaks', () => {
  it.each(Array.from({ length: 40 }, (_, i) => i))('wins with the full design, seed %i', (seed) => {
    expect(win(SCALE_UP, GOOD, GOOD_SET, seed)).toBe(true)
  })
  it('has exactly as many pads as the reference design has pieces', () => {
    expect(SCALE_UP.pads.map((p) => p.id).sort()).toEqual(Object.keys(GOOD).sort())
  })
  it('has no pad left for a piece it does not need', () => {
    const placed = { ...without(GOOD, 's3'), s3: 'ring' } as Placement
    expect(win(SCALE_UP, placed, GOOD_SET)).toBe(false)
    expect(DROPBOX.review(placed, GOOD_SET).lines.some((l) => !l.ok)).toBe(true)
  })
  it.each([
    ['no queue', without(GOOD, 'q1'), GOOD_SET],
    ['no batching', GOOD, { ...GOOD_SET, batch: 0 }],
    ['one metadata server', without(GOOD, 'm2'), GOOD_SET],
    ['no metadata server', without(GOOD, 'm1', 'm2'), GOOD_SET],
    ['two notifiers', without(GOOD, 'n3'), GOOD_SET],
    ['one notifier', without(GOOD, 'n2', 'n3'), GOOD_SET],
    ['no notifier', without(GOOD, 'n1', 'n2', 'n3'), GOOD_SET],
    ['no shard', without(GOOD, 's1', 's2', 's3'), GOOD_SET],
    ['one shard', without(GOOD, 's2', 's3'), GOOD_SET],
    ['two shards', without(GOOD, 's3'), GOOD_SET],
    ['1 MB chunks', GOOD, { ...GOOD_SET, chunk: 1 }],
    ['16 MB chunks', GOOD, { ...GOOD_SET, chunk: 16 }],
    ['whole-file chunks', GOOD, { ...GOOD_SET, chunk: 128 }],
    ['chunks cut every so many bytes', GOOD, { ...GOOD_SET, content: 0 }],
    ['chunks sent again', GOOD, { ...GOOD_SET, dedupe: 0 }],
    ['one copy', GOOD, { ...GOOD_SET, copies: 1 }],
    ['two copies', GOOD, { ...GOOD_SET, copies: 2 }],
    ['a rate limiter on the saves', { ...without(GOOD, 's3'), s3: 'limiter' } as Placement, GOOD_SET],
    ['a queue behind the notifiers', { ...without(GOOD, 'q1'), q1: 'app', n1: 'queue' } as Placement, GOOD_SET],
  ])('fails with %s', (_name, placed, settings) => {
    expect(win(SCALE_UP, placed, settings)).toBe(false)
  })
  it('names the symptom, not the cause', () => {
    const placed = without(GOOD, 'q1')
    const run = new Running(SCALE_UP.assemble(placed, GOOD_SET))
    for (let t = 0; t < 70 * 20; t++) run.step()
    const problem = SCALE_UP.problem?.(run.metrics(), placed, GOOD_SET, run.flow)
    expect(problem).toMatch(/lost|told|catch|room|long/)
    expect(problem).not.toMatch(/queue|dedupe|batch|copies/i)
    expect(dropboxOf.get(run.flow)).toBeDefined()
  })
})

describe('final review', () => {
  it('marks the reference design all right', () => {
    expect(DROPBOX.review(GOOD, GOOD_SET).lines.every((l) => l.ok)).toBe(true)
  })
  it('flags a bare design', () => {
    expect(DROPBOX.review({}, { chunk: 128, content: 0, dedupe: 0, copies: 1, batch: 0 }).lines.filter((l) => !l.ok).length).toBe(9)
  })
})
