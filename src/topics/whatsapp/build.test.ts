import { describe, expect, it } from 'vitest'
import { Running } from '../../core/build/run'
import type { BuildTask, Placement, Settings } from '../../core/build/types'
import { FIRST_DESIGN, SCALE_UP, WHATSAPP, whatsappOf } from './build'

const without = (placed: Placement, ...ids: string[]) => Object.fromEntries(Object.entries(placed).filter(([id]) => !ids.includes(id))) as Placement

const rngOf = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// Runs a design the way the game does. Returns what broke first, or 'win'.
function play(task: BuildTask, placed: Placement, settings: Settings, seed = 0, seconds = 84) {
  const run = new Running(task.assemble(placed, settings, seed ? rngOf(seed) : undefined))
  let held = 0
  for (let t = 0; t < seconds * 20; t++) {
    run.step()
    const bad = task.requirements?.find((r) => !r.read(run.flow, run.metrics()).ok)
    if (bad) return `${bad.label} at ${(t / 20).toFixed(1)} s`
    held = task.check(run.metrics(), placed, settings, run.flow) ? held + 1 : 0
    if (held >= task.holdSeconds * 20) return 'win'
  }
  return 'no win'
}
const win = (task: BuildTask, placed: Placement, settings: Settings, seed = 0) => play(task, placed, settings, seed) === 'win'

const FIRST: Placement = { m1: 'app', q1: 'queue', n1: 'app', s2: 'database' }

describe('first design', () => {
  it('wins with a queue, a gateway, a delivery worker and a shard', () => {
    expect(play(FIRST_DESIGN, FIRST, {})).toBe('win')
  })
  it.each([
    ['no queue', without(FIRST, 'q1')],
    ['a queue behind the worker', { ...without(FIRST, 'q1'), q1: 'app', s2: 'queue', n1: 'app' } as Placement],
    ['no gateway', without(FIRST, 'm1')],
    ['no worker', without(FIRST, 'n1')],
    ['no shard', without(FIRST, 's2')],
    ['nothing', {} as Placement],
  ])('fails with %s', (_name, placed) => {
    expect(win(FIRST_DESIGN, placed, {})).toBe(false)
  })
})

const GOOD: Placement = { m1: 'app', m2: 'app', c1: 'cache', q1: 'queue', n1: 'app', n2: 'app', n3: 'app', s1: 'database', s2: 'database', s3: 'database' }
const GOOD_SET: Settings = { keep: 30, group: 1, media: 1, receipts: 1, jitter: 1, dots: 1, beat: 7 }

describe('where it breaks', () => {
  it.each(Array.from({ length: 40 }, (_, i) => i))('wins with the full design, seed %i', (seed) => {
    expect(play(SCALE_UP, GOOD, GOOD_SET, seed)).toBe('win')
  })
  it('has exactly as many pads as the reference design has pieces', () => {
    expect(SCALE_UP.pads.map((p) => p.id).sort()).toEqual(Object.keys(GOOD).sort())
  })
  it('has no pad left for a piece it does not need', () => {
    const placed = { ...without(GOOD, 's3'), s3: 'ring' } as Placement
    expect(win(SCALE_UP, placed, GOOD_SET)).toBe(false)
    expect(WHATSAPP.review(placed, GOOD_SET).lines.some((l) => !l.ok)).toBe(true)
  })
  it.each([
    ['no queue', without(GOOD, 'q1'), GOOD_SET],
    ['no cache', without(GOOD, 'c1'), GOOD_SET],
    ['one gateway', without(GOOD, 'm2'), GOOD_SET],
    ['no gateway', without(GOOD, 'm1', 'm2'), GOOD_SET],
    ['two workers', without(GOOD, 'n3'), GOOD_SET],
    ['one worker', without(GOOD, 'n2', 'n3'), GOOD_SET],
    ['no worker', without(GOOD, 'n1', 'n2', 'n3'), GOOD_SET],
    ['no shard', without(GOOD, 's1', 's2', 's3'), GOOD_SET],
    ['one shard', without(GOOD, 's2', 's3'), GOOD_SET],
    ['two shards', without(GOOD, 's3'), GOOD_SET],
    ['kept 1 day', GOOD, { ...GOOD_SET, keep: 1 }],
    ['kept 14 days', GOOD, { ...GOOD_SET, keep: 14 }],
    ['kept 60 days', GOOD, { ...GOOD_SET, keep: 60 }],
    ['a group stored for every member', GOOD, { ...GOOD_SET, group: 0 }],
    ['photos inside the message', GOOD, { ...GOOD_SET, media: 0 }],
    ['receipts one by one', GOOD, { ...GOOD_SET, receipts: 0 }],
    ['phones reconnecting all at once', GOOD, { ...GOOD_SET, jitter: 0 }],
    ['status sent to every contact', GOOD, { ...GOOD_SET, dots: 0 }],
    ['pings every second', GOOD, { ...GOOD_SET, beat: 1 }],
    ['pings every 3 seconds', GOOD, { ...GOOD_SET, beat: 3 }],
    ['pings every 12 seconds', GOOD, { ...GOOD_SET, beat: 12 }],
    ['pings every 40 seconds', GOOD, { ...GOOD_SET, beat: 40 }],
    ['a rate limiter on the sends', { ...without(GOOD, 's3'), s3: 'limiter' } as Placement, GOOD_SET],
    ['a queue behind the workers', { ...without(GOOD, 'q1'), q1: 'app', n1: 'queue' } as Placement, GOOD_SET],
  ])('fails with %s', (_name, placed, settings) => {
    expect(play(SCALE_UP, placed, settings)).not.toBe('win')
  })
  it('names the symptom, not the cause', () => {
    const placed = without(GOOD, 'q1')
    const run = new Running(SCALE_UP.assemble(placed, GOOD_SET))
    for (let t = 0; t < 84 * 20; t++) run.step()
    const problem = SCALE_UP.problem?.(run.metrics(), placed, GOOD_SET, run.flow)
    expect(problem).toMatch(/lost|never|room|long|pings/)
    expect(problem).not.toMatch(/queue|batch|cache|jitter|spread/i)
    expect(whatsappOf.get(run.flow)).toBeDefined()
  })
})

describe('final review', () => {
  it('marks the reference design all right', () => {
    expect(WHATSAPP.review(GOOD, GOOD_SET).lines.every((l) => l.ok)).toBe(true)
  })
  it('flags a bare design', () => {
    expect(WHATSAPP.review({}, { keep: 1, group: 0, media: 0, receipts: 0, jitter: 0, dots: 0, beat: 1 }).lines.filter((l) => !l.ok).length).toBe(12)
  })
})
