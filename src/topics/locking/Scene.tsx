import type { ReactNode } from 'react'
import { crowd, edge, glide } from '../../core/iso/crowd'
import { IsoBox, Tag } from '../../core/iso/primitives'
import Viewport from '../../core/iso/Viewport'
import type { SceneProps, V3 } from '../../core/types'
import type { LockingSim, Msg, Place } from './engine'
import type { Beat, LockingState } from './types'
import { buyerAt, buyerColor, DB, LOCK, MS_PER_TICK, SEAT_PITCH, seatAt, TICKS_PER_SECOND } from './world'

const FLY_Y = 0.9
const SHOWN = TICKS_PER_SECOND * 2.4 // what just happened stays up this long

export default function Scene({ simRef, lastTickAt, st, beat, shot, shake, quiet, markers }: SceneProps<LockingState, LockingSim, Beat>) {
  const sim = simRef.current
  if (!sim) return null
  const n = sim.buyers.length
  const where = (p: Place, buyer: number) => (p === 'buyer' ? buyerAt(buyer, n) : p === 'lock' ? LOCK : DB)

  // Frame every buyer, the lock service, the database and every seat.
  const seats = sim.owners.length
  const bounds: V3[] = [
    ...sim.buyers.map((b): V3 => [buyerAt(b.id, n).x, 0.6, buyerAt(b.id, n).z]),
    [LOCK.x, 1, LOCK.z],
    [DB.x, 1, DB.z],
    ...[0, seats - 1].map((i): V3 => [seatAt(i, seats).x, 0.4, seatAt(i, seats).z]),
  ]

  return (
    <Viewport
      target={shot.target}
      zoom={shot.zoom}
      shake={shake}
      panKey={shot}
      label="Isometric view of ticket buyers on the left, a lock service and a database in the middle, and the seats for sale on the right. A seat takes the colour of the buyer holding its ticket."
      markers={markers}
      bounds={bounds}
    >
      {({ now }) => {
        const frac = Math.min(1, Math.max(0, (now - lastTickAt.current) / MS_PER_TICK))
        const c = crowd(sim.msgs.length)
        const tags = new Set(beat.tags ?? [])
        const locking = st.mode === 'lock' && tags.has('lock')
        const labels: ReactNode[] = []

        if (tags.has('parties')) {
          labels.push(<Tag key="buyers" at={[buyerAt(0, n).x, 1.3, buyerAt(0, n).z - 0.8]} label="Buyers" />)
          labels.push(<Tag key="db" at={[DB.x, 2.1, DB.z]} label="Database" />)
          if (locking) labels.push(<Tag key="lock" at={[LOCK.x, 1.9, LOCK.z]} label="Lock service" />)
        }
        if (tags.has('left')) {
          const extra = st.mode === 'version' ? ` · version ${sim.version}` : st.fence && st.mode === 'lock' ? ` · saw no. ${sim.highest}` : ''
          labels.push(<Tag key="left" at={[DB.x + 0.4, 0.6, DB.z + 1.6]} label={`${sim.left} left${extra}`} />)
        }
        if (locking) {
          const holder = sim.holder === -1 ? 'Free' : `Held by buyer ${sim.holder + 1}`
          labels.push(<Tag key="held" at={[LOCK.x - 0.2, 0.5, LOCK.z + 1.4]} label={sim.line.length ? `${holder} · ${sim.line.length} in line` : holder} />)
        }
        if (tags.has('seats')) {
          const twice = sim.owners.findIndex((o) => o.length > 1)
          if (twice >= 0) {
            const s = seatAt(twice, sim.owners.length)
            labels.push(<Tag key="twice" at={[s.x, 1.1, s.z]} label="Sold twice" danger />)
          }
        }
        for (const b of sim.buyers) {
          const p = buyerAt(b.id, n)
          if (b.phase === 'crashed') labels.push(<Tag key={`b${b.id}`} at={[p.x, 1.1, p.z]} label="Crashed" danger />)
          else if (b.phase === 'paused') labels.push(<Tag key={`b${b.id}`} at={[p.x, 1.1, p.z]} label="Frozen" danger />)
        }
        if (sim.who && sim.tick - sim.whoAt < SHOWN) labels.push(<Tag key="who" at={[-4.6, 2.2, 2.6]} label={sim.who} />)

        const place = (m: Msg) => {
          const a = where(m.from, m.buyer)
          const b = where(m.to, m.buyer)
          const p = glide(Math.min(1, Math.max(0, (sim.tick - m.sentAt + frac) / (m.arrive - m.sentAt))))
          return { x: a.x + (b.x - a.x) * p, z: a.z + (b.z - a.z) * p, p }
        }

        return (
          <>
            {sim.buyers.map((b) => {
              const { x, z } = buyerAt(b.id, n)
              if (b.phase === 'coming') return <IsoBox key={`b${b.id}`} x={x} z={z} w={0.7} d={0.7} h={0.6} ghost />
              const fill = b.phase === 'crashed' ? 'var(--danger)' : buyerColor(b.id)
              return (
                <g key={`b${b.id}`}>
                  <IsoBox x={x} z={z} w={0.7} d={0.7} h={0.6} fill={fill} dim={b.phase === 'soldout'} opacity={b.phase === 'queued' || b.phase === 'asking' ? 0.7 : 1} />
                  {b.phase === 'ticket' && <IsoBox x={x} z={z} y={0.6} w={0.42} d={0.26} h={0.1} fill="var(--fg)" />}
                </g>
              )
            })}

            {locking && (
              <>
                <IsoBox x={LOCK.x} z={LOCK.z} w={1.2} d={1.2} h={0.8} />
                <IsoBox x={LOCK.x} z={LOCK.z} y={0.8} w={0.5} d={0.5} h={0.22} fill={sim.holder === -1 ? 'var(--iso-idle)' : buyerColor(sim.holder)} />
              </>
            )}

            <IsoBox x={DB.x} z={DB.z} w={1.6} d={1.6} h={1.0} />

            {sim.owners.map((o, i) => {
              const s = seatAt(i, sim.owners.length)
              const fill = o.length > 1 ? 'var(--danger)' : o.length === 1 ? buyerColor(o[0]) : undefined
              return <IsoBox key={`s${i}`} x={s.x} z={s.z} w={SEAT_PITCH * 0.7} d={SEAT_PITCH * 0.7} h={0.35} fill={fill} />
            })}

            {sim.msgs.map((m) => {
              const { x, z, p } = place(m)
              const k = 0.2 * c.scale
              const fill = m.kind === 'no' ? 'var(--danger)' : buyerColor(m.buyer)
              return <IsoBox key={m.id} x={x} z={z} y={FLY_Y + Math.sin(p * Math.PI) * 0.4} w={k} d={k} h={k} fill={fill} opacity={c.opacity * edge(p)} />
            })}

            {!quiet && labels}
          </>
        )
      }}
    </Viewport>
  )
}
