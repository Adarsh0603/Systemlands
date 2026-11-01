import { TICKS_PER_SECOND } from '../../core/flow/time'
// Where things stand on the floor, left to right:
//
//   Laptop   [ the file, cut into chunks ] ─────▶ [ the store ]
//
// The laptop holds a file made of units. The store keeps chunks, each under a short
// name made from what is inside.

export { TICKS_PER_SECOND }
export const MS_PER_TICK = 1000 / TICKS_PER_SECOND

export type Place = 'laptop' | 'store'

export const SPOT: Record<Place, { x: number; z: number }> = {
  laptop: { x: -4.2, z: 0 },
  store: { x: 4.6, z: 0 },
}

export const LAPTOP = { x: -8.6, w: 1.1, d: 1.1, h: 0.5 }
export const PITCH = 0.34
export const COLS = 12
export const CELL = PITCH * 0.82
export const SLAB_H = 0.2
const GAP = 0.5 // space between two chunks, in cells

export interface Cell {
  i: number // which unit
  x: number
  z: number
}

// The cells of a list of chunks, laid out in rows of up to COLS, with a gap between chunks.
export function layoutChunks(lens: number[], originX: number): { cells: Cell[]; rows: number; starts: { x: number; z: number }[] } {
  const cells: Cell[] = []
  const starts: { x: number; z: number }[] = []
  let col = 0
  let row = 0
  let i = 0
  for (const len of lens) {
    let first = true
    for (let k = 0; k < len; k++) {
      if (col + 1 > COLS) {
        col = 0
        row++
      }
      const x = originX + col * PITCH
      const z = row * PITCH
      if (first) starts.push({ x, z })
      first = false
      cells.push({ i: i++, x, z })
      col++
    }
    col += GAP
    if (col > COLS - 1) {
      col = 0
      row++
    }
  }
  return { cells, rows: row + 1, starts }
}

export const FILE_X = SPOT.laptop.x - (COLS * PITCH) / 2 + PITCH / 2
export const STORE_X = SPOT.store.x - (COLS * PITCH) / 2 + PITCH / 2

const COLORS = ['var(--srv-1)', 'var(--srv-2)', 'var(--srv-3)', 'var(--srv-4)', 'var(--srv-5)']
export const colorOf = (n: number) => COLORS[n % COLORS.length]
