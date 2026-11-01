import { describe, expect, it } from 'vitest'
import { CAPACITY, dropOf, fanOf, loadOf, PresenceSim } from './engine'
import type { PresenceState } from './types'
import { TICKS_PER_SECOND } from './world'

const BASE: PresenceState = { mode: 'beat', interval: 5, grace: 0, audience: 'all', store: 'memory', leave: 0, die: 0, back: 0, tunnel: 0, crash: 0, round: 0 }

function run(sim: ChunkLike, seconds: number) {
  for (let t = 0; t < TICKS_PER_SECOND * seconds; t++) sim.step()
}
type ChunkLike = PresenceSim

function start(st: Partial<PresenceState> = {}) {
  const sim = new PresenceSim()
  const state = { ...BASE, ...st }
  sim.apply(state)
  return { sim, state }
}

function act(sim: PresenceSim, state: PresenceState, what: 'leave' | 'die' | 'back' | 'tunnel' | 'crash', seconds = 5) {
  const next = { ...state, [what]: state[what] + 1 }
  sim.apply(next)
  run(sim, seconds)
  return next
}

describe('presence', () => {
  it('starts online and right', () => {
    const { sim } = start()
    run(sim, 30)
    expect(sim.metrics.shown).toBe(true)
    expect(sim.metrics.flips).toBe(0)
  })

  it('goodbye turns the dot grey, hello turns it green', () => {
    const { sim, state } = start({ mode: 'flag' })
    const a = act(sim, state, 'leave')
    expect(sim.metrics.shown).toBe(false)
    act(sim, a, 'back')
    expect(sim.metrics.shown).toBe(true)
  })

  it('a dead phone stays online for ever with hello and goodbye', () => {
    const { sim, state } = start({ mode: 'flag' })
    act(sim, state, 'die', 600)
    expect(sim.metrics.shown).toBe(true)
    expect(sim.metrics.up).toBe(false)
    expect(sim.metrics.stale).toBeGreaterThan(500)
  })

  it('heartbeats find a dead phone after three missed pings', () => {
    const { sim, state } = start({ interval: 5 })
    run(sim, 12)
    sim.apply({ ...state, die: 1 })
    run(sim, 10)
    expect(sim.metrics.shown).toBe(true)
    run(sim, 10)
    expect(sim.metrics.shown).toBe(false)
    expect(sim.metrics.late).toBe(16)
  })

  it('a longer interval finds a dead phone later', () => {
    const times: number[] = []
    for (const interval of [2, 5, 10, 20]) {
      const { sim, state } = start({ interval })
      run(sim, 3)
      act(sim, state, 'die', interval * 5)
      times.push(sim.metrics.late)
    }
    expect(times).toEqual([...times].sort((a, b) => a - b))
    expect(times[0]).toBeLessThan(times[3])
  })

  it('tunnels make the dot blink unless the server waits', () => {
    const blink = start({ interval: 2, grace: 0 })
    act(blink.sim, blink.state, 'tunnel', 60)
    expect(blink.sim.metrics.flips).toBe(4)
    const calm = start({ interval: 2, grace: 20 })
    act(calm.sim, calm.state, 'tunnel', 60)
    expect(calm.sim.metrics.flips).toBe(0)
    expect(calm.sim.metrics.updates).toBe(0)
  })

  it('a long wait delays real news', () => {
    const { sim, state } = start({ interval: 2, grace: 20 })
    run(sim, 3)
    act(sim, state, 'die', 60)
    expect(sim.metrics.shown).toBe(false)
    expect(sim.metrics.late).toBe(27)
  })

  it('a ping cancels the wait', () => {
    const { sim, state } = start({ mode: 'flag', grace: 10 })
    const a = act(sim, state, 'leave', 4)
    expect(sim.metrics.shown).toBe(true)
    act(sim, a, 'back', 15)
    expect(sim.metrics.shown).toBe(true)
    expect(sim.metrics.changes).toBe(0)
  })

  it('tells every contact, or only the chats on screen', () => {
    const all = start({ audience: 'all' })
    act(all.sim, all.state, 'leave')
    expect(all.sim.metrics.updates).toBe(27)
    const open = start({ audience: 'open' })
    act(open.sim, open.state, 'leave')
    expect(open.sim.metrics.updates).toBe(3)
    expect(open.sim.metrics.shown).toBe(false)
    expect(fanOf({ audience: 'all' })).toBeGreaterThan(fanOf({ audience: 'open' }) * 50)
  })

  it('a slow store loses pings and the dot blinks', () => {
    const { sim } = start({ interval: 5, store: 'disk' })
    run(sim, 300)
    expect(sim.metrics.lost).toBeGreaterThan(0)
    expect(sim.metrics.flips).toBeGreaterThan(0)
  })

  it('memory keeps up at the same load', () => {
    const { sim } = start({ interval: 5, store: 'memory' })
    run(sim, 300)
    expect(sim.metrics.lost).toBe(0)
    expect(sim.metrics.flips).toBe(0)
  })

  it('load and drops follow the interval and the store', () => {
    expect(loadOf({ mode: 'beat', interval: 5 })).toBe(200_000)
    expect(loadOf({ mode: 'flag', interval: 5 })).toBe(0)
    expect(dropOf({ mode: 'beat', interval: 5, store: 'memory' })).toBe(0)
    expect(dropOf({ mode: 'beat', interval: 5, store: 'disk' })).toBeCloseTo(1 - CAPACITY.disk / 200_000)
  })

  it('a restart wipes memory, and the next ping repairs it', () => {
    const { sim, state } = start({ interval: 5, store: 'memory' })
    run(sim, 3)
    act(sim, state, 'crash', 1.5)
    expect(sim.metrics.shown).toBe(false)
    run(sim, 8)
    expect(sim.metrics.shown).toBe(true)
  })

  it('a restart does not forget a disk store', () => {
    const { sim, state } = start({ interval: 20, store: 'disk' })
    act(sim, state, 'crash', 3)
    expect(sim.metrics.shown).toBe(true)
    expect(sim.metrics.flips).toBe(0)
  })

  it('without heartbeats a restart cannot be repaired', () => {
    const { sim, state } = start({ mode: 'flag', store: 'memory' })
    act(sim, state, 'crash', 120)
    expect(sim.metrics.shown).toBe(false)
    expect(sim.metrics.up).toBe(true)
  })

  it('changing a setting starts the run again', () => {
    const { sim, state } = start()
    const a = act(sim, state, 'die', 60)
    expect(sim.metrics.dies).toBe(1)
    sim.apply({ ...a, interval: 10 })
    expect(sim.metrics.dies).toBe(0)
    expect(sim.metrics.shown).toBe(true)
    expect(sim.metrics.up).toBe(true)
  })
})
