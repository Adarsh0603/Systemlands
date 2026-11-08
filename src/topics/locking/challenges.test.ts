import { describe, expect, it } from 'vitest'
import { stateAt } from '../../core/chapters'
import { CHAPTERS } from './chapters'
import { LockingSim } from './engine'
import type { LockingState } from './types'
import { TICKS_PER_SECOND } from './world'

// The state at a chapter's practice challenge, with its checker.
function challenge(chapter: number) {
  const ch = CHAPTERS[chapter]
  const beat = ch.beats.findIndex((b) => b.challenge)
  return { st: stateAt(ch, beat), goal: ch.beats[beat].challenge! }
}

// Apply each change in turn, letting the sale run for a while after each.
function play(st: LockingState, changes: Partial<LockingState>[], seconds = 120) {
  const sim = new LockingSim()
  let cur = st
  sim.apply(cur)
  for (let t = 0; t < TICKS_PER_SECOND * seconds; t++) sim.step()
  for (const c of changes) {
    cur = { ...cur, ...c }
    sim.apply(cur)
    for (let t = 0; t < TICKS_PER_SECOND * seconds; t++) sim.step()
  }
  return { sim, st: cur }
}

type Goal = ReturnType<typeof challenge>['goal']
const won = (r: { sim: LockingSim; st: LockingState }, goal: Goal) => goal.check({ m: r.sim.metrics, st: r.st, sim: r.sim })

describe('locking challenges', () => {
  it('every chapter but the first ends in a challenge that is not won by waiting', () => {
    expect(CHAPTERS[0].beats.some((b) => b.challenge)).toBe(false)
    for (let i = 1; i < CHAPTERS.length; i++) {
      const { st, goal } = challenge(i)
      expect(won(play(st, []), goal), CHAPTERS[i].title).toBe(false)
    }
  })

  it('lock the seats: needs the lock', () => {
    const { st, goal } = challenge(1)
    expect(won(play(st, [{ mode: 'lock' }]), goal)).toBe(true)
  })

  it('everyone wants in: only a short hold wins', () => {
    const { st, goal } = challenge(2)
    expect(won(play(st, [{ hold: 'seat' }]), goal)).toBe(true)
    expect(won(play(st, [{ hold: 'pay', sale: st.sale + 1 }]), goal)).toBe(false)
  })

  it('check the version: needs the version check', () => {
    const { st, goal } = challenge(3)
    expect(won(play(st, [{ mode: 'version' }]), goal)).toBe(true)
  })

  it('the holder crashes: only a middle lease wins', () => {
    const { st, goal } = challenge(4)
    for (const [lease, wins] of [[0, false], [1, false], [5, true], [60, false]] as const) {
      expect(won(play(st, [{ lease }], 200), goal), `lease ${lease}`).toBe(wins)
    }
  })

  it('the holder wakes up late: needs fencing tokens', () => {
    const { st, goal } = challenge(5)
    expect(won(play(st, [{ fence: true }], 200), goal)).toBe(true)
  })

  it('lock or version: needs each day run the better way', () => {
    const { st, goal } = challenge(6)
    const best = play(st, [{ crowd: 'quiet', mode: 'version' }, { crowd: 'rush', mode: 'lock' }])
    expect(won(best, goal)).toBe(true)
    const worst = play(st, [{ crowd: 'quiet', mode: 'lock' }, { crowd: 'rush', mode: 'version' }])
    expect(won(worst, goal)).toBe(false)
    const allLock = play(st, [{ crowd: 'rush', mode: 'lock' }])
    expect(won(allLock, goal)).toBe(false)
    const allVersion = play(st, [{ crowd: 'quiet', mode: 'version' }, { crowd: 'rush', mode: 'version' }])
    expect(won(allVersion, goal)).toBe(false)
  })
})
