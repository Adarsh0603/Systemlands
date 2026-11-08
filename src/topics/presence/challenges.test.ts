import { describe, expect, it } from 'vitest'
import { stateAt } from '../../core/chapters'
import { CHAPTERS } from './chapters'
import { dayStep } from './day'
import { PresenceSim } from './engine'
import type { PresenceState } from './types'
import { TICKS_PER_SECOND } from './world'

// The state at a chapter's practice challenge, with its checker.
function challenge(chapter: number) {
  const ch = CHAPTERS[chapter]
  const beat = ch.beats.findIndex((b) => b.challenge)
  return { st: stateAt(ch, beat), goal: ch.beats[beat].challenge! }
}

function play(st: PresenceState, steps: (((s: PresenceState) => PresenceState) | number)[]) {
  const sim = new PresenceSim()
  let cur = st
  sim.apply(cur)
  for (const step of steps) {
    if (typeof step === 'number') {
      for (let t = 0; t < TICKS_PER_SECOND * step; t++) sim.step()
      continue
    }
    cur = step(cur)
    sim.apply(cur)
    for (let t = 0; t < TICKS_PER_SECOND * 3; t++) sim.step()
  }
  return { sim, st: cur }
}

const die = (s: PresenceState) => ({ ...s, die: s.die + 1 })
const leave = (s: PresenceState) => ({ ...s, leave: s.leave + 1 })
const back = (s: PresenceState) => ({ ...s, back: s.back + 1 })
const tunnel = (s: PresenceState) => ({ ...s, tunnel: s.tunnel + 1 })
const crash = (s: PresenceState) => ({ ...s, crash: s.crash + 1 })
const set = (change: Partial<PresenceState>) => (s: PresenceState) => ({ ...s, ...change })
const won = (r: { sim: PresenceSim; st: PresenceState }, goal: ReturnType<typeof challenge>['goal']) => goal.check({ m: r.sim.metrics, st: r.st, sim: r.sim })

describe('presence challenges', () => {
  it('every chapter but the first ends in a challenge that is not won by waiting', () => {
    for (let i = 1; i < CHAPTERS.length; i++) {
      const { st, goal } = challenge(i)
      expect(won(play(st, [120]), goal), CHAPTERS[i].title).toBe(false)
    }
  })

  it('heartbeats: need the mode and a dead phone', () => {
    const { st, goal } = challenge(1)
    expect(won(play(st, [die, 60]), goal)).toBe(false)
    expect(won(play(st, [set({ mode: 'beat' }), 30]), goal)).toBe(false)
    expect(won(play(st, [set({ mode: 'beat' }), die, 30]), goal)).toBe(true)
  })

  it('how often: only the middle wins', () => {
    const { st, goal } = challenge(2)
    for (const [interval, wins] of [[1, false], [2, false], [5, true], [10, false], [20, false], [40, false]] as const) {
      expect(won(play(st, [set({ interval }), die, interval * 4 + 10]), goal), `every ${interval}s`).toBe(wins)
    }
  })

  it('the flapping phone: short waits blink, long waits come late, a middle one wins', () => {
    const { st, goal } = challenge(3)
    const day = (c: Partial<PresenceState>) => play(st, [set({ interval: 2, ...c }), tunnel, 60, die, 70])
    expect(won(day({ grace: 0 }), goal)).toBe(false)
    expect(won(day({ grace: 5 }), goal)).toBe(false)
    expect(won(day({ grace: 20 }), goal)).toBe(true)
    expect(won(day({ interval: 5, grace: 10 }), goal)).toBe(true)
    expect(won(day({ interval: 10, grace: 0 }), goal)).toBe(false)
    expect(won(day({ interval: 5, grace: 20 }), goal)).toBe(false)
  })

  it('who gets told: needs the chats on screen, and two changes', () => {
    const { st, goal } = challenge(4)
    expect(won(play(st, [leave, back]), goal)).toBe(false)
    expect(won(play(st, [set({ audience: 'open' })]), goal)).toBe(false)
    expect(won(play(st, [set({ audience: 'open' }), leave, back]), goal)).toBe(true)
  })

  it('where it lives: memory with a short interval wins, disk does not', () => {
    const { st, goal } = challenge(5)
    expect(won(play(st, [crash, 60]), goal)).toBe(false)
    expect(won(play(st, [set({ store: 'memory' }), crash, 30]), goal)).toBe(true)
    expect(won(play(st, [set({ store: 'memory', interval: 10 }), crash, 40]), goal)).toBe(true)
    expect(won(play(st, [set({ store: 'memory', interval: 2 }), crash, 30]), goal)).toBe(false)
    expect(won(play(st, [set({ store: 'disk', interval: 20 }), crash, 60]), goal)).toBe(false)
  })

  it('which one to use: needs every setting right and the whole day, one event at a time', () => {
    const { st, goal } = challenge(6)
    const right = { mode: 'beat', interval: 5, grace: 10, audience: 'open', store: 'memory' } as const
    // Press the button for each event once the one before it has played out.
    const day = (c: Partial<PresenceState>) => {
      let cur = { ...st, ...right, ...c }
      const sim = new PresenceSim()
      sim.apply(cur)
      for (let t = 0; t < TICKS_PER_SECOND * 400; t++) {
        const step = dayStep(sim.metrics)
        if ('over' in step) break
        if ('next' in step) {
          cur = { ...cur, [step.next]: cur[step.next] + 1 }
          sim.apply(cur)
        }
        sim.step()
      }
      for (let t = 0; t < TICKS_PER_SECOND * 2; t++) sim.step()
      return { sim, st: cur }
    }
    const ok = day({})
    expect(dayStep(ok.sim.metrics)).toEqual({ over: true, won: true })
    expect(won(ok, goal)).toBe(true)
    for (const bad of [{ mode: 'flag' }, { grace: 0 }, { audience: 'all' }, { store: 'disk' }, { interval: 40 }] as const) {
      const r = day(bad)
      expect(dayStep(r.sim.metrics), JSON.stringify(bad)).toEqual({ over: true, won: false })
      expect(won(r, goal), JSON.stringify(bad)).toBe(false)
    }
    expect(won(play(st, [set(right), tunnel, 60, die, 80]), goal)).toBe(false)
  })
})
