import type { ReactNode } from 'react'
import { depth } from '../../core/iso/geometry'
import { crowd, edge, glide } from '../../core/iso/crowd'
import { IsoBox, Tag } from '../../core/iso/primitives'
import Viewport from '../../core/iso/Viewport'
import type { SceneProps, V3 } from '../../core/types'
import type { ChunkSim, Msg } from './engine'
import type { Beat, ChunkState } from './types'
import { CELL, colorOf, FILE_X, LAPTOP, layoutChunks, MS_PER_TICK, PITCH, SLAB_H, SPOT, STORE_X, TICKS_PER_SECOND } from './world'

const FLY_Y = 0.9
const SHOWN = TICKS_PER_SECOND * 2.2 // the label of what just happened stays for this long
const FLASH = 70 // matches the engine: a changed unit glows for this long
const MAX_STORED = 96

function size(m: Msg): number {
  return m.kind === 'chunk' ? 0.16 + 0.035 * m.len : 0.2
}

export default function Scene({ simRef, lastTickAt, beat, shot, shake, quiet, markers }: SceneProps<ChunkState, ChunkSim, Beat>) {
  const sim = simRef.current
  if (!sim) return null

  const bounds: V3[] = [
    [LAPTOP.x, 2, 0],
    [SPOT.store.x + 3, 2, 0],
  ]

  return (
    <Viewport
      target={shot.target}
      zoom={shot.zoom}
      shake={shake}
      panKey={shot}
      label="Isometric view of a laptop on the left holding a file cut into chunks, and a store on the right that keeps chunks."
      markers={markers}
      bounds={bounds}
    >
      {({ now }) => {
        const frac = Math.min(1, Math.max(0, (now - lastTickAt.current) / MS_PER_TICK))
        const c = crowd(sim.msgs.length)
        const tags = new Set(beat.tags ?? [])

        const lens = sim.chunks.map((k) => k.units.length)
        const file = layoutChunks(lens, FILE_X)
        const unitColor: number[] = []
        sim.chunks.forEach((k) => k.units.forEach(() => unitColor.push(k.color)))

        const stored = sim.store.flatMap((s) => Array.from({ length: s.copies }, () => s.chunk)).slice(0, MAX_STORED)
        const slab = layoutChunks(stored.map((k) => k.units.length), STORE_X)
        const storedColor = stored.flatMap((k) => k.units.map(() => k.color))

        const place = (m: Msg) => {
          const a = SPOT[m.from]
          const b = SPOT[m.to]
          const p = glide(Math.min(1, Math.max(0, (sim.tick - m.sentAt + frac) / (m.arrive - m.sentAt))))
          return { x: a.x + (b.x - a.x) * p, z: a.z + (b.z - a.z) * p, p }
        }

        const labels: ReactNode[] = []
        if (tags.has('parties')) {
          labels.push(<Tag key="laptop" at={[LAPTOP.x, LAPTOP.h + 0.6, 0]} label="Laptop" />)
          labels.push(<Tag key="store" at={[SPOT.store.x, SLAB_H + 0.4 + slab.rows * PITCH + 0.5, 0]} label="Store" />)
        }
        if (tags.has('who') && sim.who && sim.tick - sim.whoAt < SHOWN) {
          labels.push(<Tag key="who" at={[SPOT.laptop.x, 1.3, -1.7]} label={sim.who} />)
        }
        if (tags.has('names')) {
          file.starts.forEach((s, i) => {
            const k = sim.chunks[i]
            if (k) labels.push(<Tag key={`n${i}`} at={[s.x + (k.units.length * PITCH) / 2 - PITCH / 2, 0.5, s.z - 0.5]} label={k.name} />)
          })
        }

        const cells = [...file.cells].sort((a, b) => depth(a.x, a.z) - depth(b.x, b.z))

        return (
          <>
            <IsoBox x={LAPTOP.x} z={0} w={LAPTOP.w} d={LAPTOP.d} h={LAPTOP.h} />
            <IsoBox x={SPOT.laptop.x} z={((file.rows - 1) * PITCH) / 2} w={12 * PITCH + 0.5} d={file.rows * PITCH + 0.4} h={0.08} />
            {cells.map(({ i, x, z }) => {
              const fresh = sim.changed.some((ch) => ch.i === i && sim.tick - ch.at < FLASH)
              return <IsoBox key={`f${i}`} x={x} z={z} y={0.08} w={CELL} d={CELL} h={fresh ? 0.3 : 0.22} fill={fresh ? 'var(--fg)' : colorOf(unitColor[i] ?? 0)} />
            })}

            <IsoBox x={SPOT.store.x} z={((slab.rows - 1) * PITCH) / 2} w={12 * PITCH + 0.5} d={slab.rows * PITCH + 0.4} h={SLAB_H} />
            {slab.cells.map(({ i, x, z }) => (
              <IsoBox key={`s${i}`} x={x} z={z} y={SLAB_H} w={CELL} d={CELL} h={0.2} fill={colorOf(storedColor[i] ?? 0)} />
            ))}

            {sim.msgs.map((m) => {
              if (m.sentAt > sim.tick) return null
              const { x, z, p } = place(m)
              const k = size(m) * c.scale
              const fill = m.kind === 'chunk' ? colorOf(m.color) : 'var(--fg)'
              return (
                <IsoBox
                  key={m.id}
                  x={x}
                  z={z + (m.kind === 'need' ? 0.5 : m.kind === 'list' ? -0.5 : 0)}
                  y={FLY_Y + Math.sin(p * Math.PI) * 0.4}
                  w={m.kind === 'chunk' ? k * 1.6 : k}
                  d={k}
                  h={k}
                  fill={fill}
                  opacity={c.opacity * edge(p) * (m.kind === 'chunk' ? 1 : 0.7)}
                />
              )
            })}

            {!quiet && labels}
          </>
        )
      }}
    </Viewport>
  )
}
