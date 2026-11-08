import { describe, expect, it } from 'vitest'
import { LockingSim, QUIET_AVG, RUSH_TRIES } from './engine'
import type { LockingState } from './types'
import { TICKS_PER_SECOND } from './world'

const BASE: LockingState = { mode: 'none', hold: 'seat', lease: 0, fence: false, crowd: 'two', fault: 'none', sale: 1, round: 0 }

function sale(st: Partial<LockingState>, seconds = 120) {
  const sim = new LockingSim()
  sim.apply({ ...BASE, ...st })
  for (let t = 0; t < TICKS_PER_SECOND * seconds && !sim.metrics.done; t++) sim.step()
  return sim.metrics
}

describe('locking', () => {
  it('waits for sales to open', () => {
    const m = sale({ sale: 0 }, 10)
    expect(m.tickets).toBe(0)
    expect(m.done).toBe(false)
  })

  it('without a lock, two buyers both take the last seat', () => {
    const m = sale({ mode: 'none' })
    expect(m.done).toBe(true)
    expect(m.tickets).toBe(2)
    expect(m.twice).toBe(1)
    expect(m.left).toBe(0)
  })

  it('a lock sells the last seat once, and the second buyer waits', () => {
    const m = sale({ mode: 'lock' })
    expect(m.tickets).toBe(1)
    expect(m.twice).toBe(0)
    expect(m.soldOut).toBe(1)
    expect(m.longest).toBeGreaterThan(0.5)
  })

  it('a version check turns the second write down', () => {
    const m = sale({ mode: 'version' })
    expect(m.tickets).toBe(1)
    expect(m.twice).toBe(0)
    expect(m.retries).toBe(1)
    expect(m.soldOut).toBe(1)
  })

  it('holding the lock through the payment makes a long line', () => {
    const pay = sale({ mode: 'lock', crowd: 'eight', hold: 'pay' })
    const seat = sale({ mode: 'lock', crowd: 'eight', hold: 'seat' })
    expect(pay.served).toBe(8)
    expect(seat.served).toBe(8)
    expect(pay.twice + seat.twice).toBe(0)
    expect(pay.longest).toBeGreaterThan(15)
    expect(seat.longest).toBeLessThanOrEqual(15)
  })

  it('a crashed holder without a lease stops sales for ever', () => {
    const m = sale({ mode: 'lock', crowd: 'four', hold: 'pay', fault: 'crash' }, 120)
    expect(m.stuck).toBe(true)
    expect(m.done).toBe(false)
    expect(m.served).toBe(0)
  })

  it('leases: too short sells twice, too long waits, a middle one works', () => {
    const run = (lease: number) => sale({ mode: 'lock', crowd: 'four', hold: 'pay', fault: 'crash', lease }, 200)
    const short = run(1)
    expect(short.twice).toBeGreaterThan(0)
    const mid = run(5)
    expect(mid.done).toBe(true)
    expect(mid.twice).toBe(0)
    expect(mid.served).toBe(3)
    expect(mid.longest).toBeLessThanOrEqual(20)
    const long = run(60)
    expect(long.twice).toBe(0)
    expect(long.longest).toBeGreaterThan(20)
  })

  it('a paused holder sells twice, unless the database checks fencing tokens', () => {
    const plain = sale({ mode: 'lock', crowd: 'four', hold: 'pay', fault: 'pause', lease: 5 }, 200)
    expect(plain.twice).toBeGreaterThan(0)
    const fenced = sale({ mode: 'lock', crowd: 'four', hold: 'pay', fault: 'pause', lease: 5, fence: true }, 200)
    expect(fenced.done).toBe(true)
    expect(fenced.twice).toBe(0)
    expect(fenced.served).toBe(4)
    expect(fenced.rejected).toBe(1)
  })

  it('a quiet day suits a version check, a rush suits a lock', () => {
    const day = { hold: 'seat' as const, lease: 5, fence: true }
    const quietV = sale({ ...day, mode: 'version', crowd: 'quiet' })
    const quietL = sale({ ...day, mode: 'lock', crowd: 'quiet' })
    const rushV = sale({ ...day, mode: 'version', crowd: 'rush' })
    const rushL = sale({ ...day, mode: 'lock', crowd: 'rush' })
    for (const m of [quietV, quietL, rushV, rushL]) {
      expect(m.done).toBe(true)
      expect(m.twice).toBe(0)
    }
    expect(quietV.avg).toBeLessThanOrEqual(QUIET_AVG)
    expect(quietL.avg).toBeGreaterThan(QUIET_AVG)
    expect(rushV.tries / rushV.tickets).toBeGreaterThan(RUSH_TRIES)
    expect(rushL.tries / rushL.tickets).toBeLessThanOrEqual(RUSH_TRIES)
    expect(sale({ ...day, mode: 'none', crowd: 'quiet' }).twice).toBeGreaterThan(0)
    expect(sale({ ...day, mode: 'none', crowd: 'rush' }).twice).toBeGreaterThan(0)
  })

  it('remembers each crowd once its sale is done, and forgets on a new round', () => {
    const sim = new LockingSim()
    sim.apply({ ...BASE, mode: 'version', crowd: 'quiet' })
    for (let t = 0; t < TICKS_PER_SECOND * 60; t++) sim.step()
    sim.apply({ ...BASE, mode: 'lock', crowd: 'rush' })
    for (let t = 0; t < TICKS_PER_SECOND * 60; t++) sim.step()
    expect(sim.metrics.marks.quiet?.mode).toBe('version')
    expect(sim.metrics.marks.rush?.mode).toBe('lock')
    sim.apply({ ...BASE, mode: 'lock', crowd: 'rush', round: 1 })
    expect(sim.metrics.marks).toEqual({})
  })
})
