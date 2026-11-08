import { TICKS_PER_SECOND } from '../../core/flow/time'

// Where things stand on the floor, left to right:
//
//   buyers ──▶ lock service ──▶ database ──▶ the seats it sells
//
// The lock service only shows when buyers take a lock.

export { TICKS_PER_SECOND }
export const MS_PER_TICK = 1000 / TICKS_PER_SECOND

export const LOCK = { x: -2.2, z: -2.2 }
export const DB = { x: 0.6, z: 0.2 }

const BUYER_PITCH = 1.15
const SEAT_COLS = 4
export const SEAT_PITCH = 0.95

// One column of buyers for a small crowd, two for a big one.
export function buyerAt(i: number, n: number): { x: number; z: number } {
  const cols = n > 4 ? 2 : 1
  const rows = Math.ceil(n / cols)
  const col = i % cols
  const row = Math.floor(i / cols)
  return { x: -6.4 + col * 1.3, z: (row - (rows - 1) / 2) * BUYER_PITCH }
}

export function seatAt(i: number, n: number): { x: number; z: number } {
  const rows = Math.ceil(n / SEAT_COLS)
  const cols = Math.min(SEAT_COLS, n)
  return { x: 3.4 + (i % SEAT_COLS - (cols - 1) / 2) * SEAT_PITCH + 0.9, z: (Math.floor(i / SEAT_COLS) - (rows - 1) / 2) * SEAT_PITCH }
}

// Each buyer has a colour, so a seat shows who holds its ticket.
export const buyerColor = (i: number) => `var(--srv-${(i % 6) + 1})`
