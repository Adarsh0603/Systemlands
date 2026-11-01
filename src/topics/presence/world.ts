import { TICKS_PER_SECOND } from '../../core/flow/time'
// Where things stand on the floor, left to right:
//
//   Sam's phone ──▶ presence server ──▶ contacts (a grid of phones)
//
// Three contacts have Sam's chat open on screen. The other twenty-four stand for the
// rest of Sam's contact list.

export { TICKS_PER_SECOND }
export const MS_PER_TICK = 1000 / TICKS_PER_SECOND

export type Place = 'phone' | 'server'

export const SPOT: Record<Place, { x: number; z: number }> = {
  phone: { x: -7, z: 0 },
  server: { x: -2.6, z: 0 },
}

export const COLS = 9
export const CONTACTS = 27
export const OPEN = 3
export const PITCH = 0.78

export function contactAt(i: number): { x: number; z: number } {
  return { x: 1.6 + (i % COLS) * PITCH, z: (Math.floor(i / COLS) - 1) * PITCH }
}

export const ON = 'var(--srv-3)'
