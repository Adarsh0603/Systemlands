import type { ReactNode } from 'react'
import { crowd, edge, glide } from '../../core/iso/crowd'
import { IsoBox, Tag } from '../../core/iso/primitives'
import Viewport from '../../core/iso/Viewport'
import type { SceneProps, V3 } from '../../core/types'
import type { Msg, PresenceSim } from './engine'
import type { Beat, PresenceState } from './types'
import { COLS, contactAt, CONTACTS, MS_PER_TICK, ON, OPEN, PITCH, SPOT, TICKS_PER_SECOND } from './world'

const FLY_Y = 0.9
const SHOWN = TICKS_PER_SECOND * 2.2 // the label of what just happened stays for this long
const GLOW = TICKS_PER_SECOND * 0.8 // a contact that just heard something stays marked

const colorOf = (online: boolean) => (online ? ON : 'var(--iso-idle)')

function endpoint(m: Msg, end: 'from' | 'to') {
  const p = m[end]
  if (p === 'contact') return contactAt(m.at)
  return SPOT[p]
}

export default function Scene({ simRef, lastTickAt, beat, shot, shake, quiet, markers }: SceneProps<PresenceState, PresenceSim, Beat>) {
  const sim = simRef.current
  if (!sim) return null

  const bounds: V3[] = [
    [SPOT.phone.x - 1, 2, 0],
    [contactAt(COLS - 1).x + 1, 2, 0],
  ]

  return (
    <Viewport
      target={shot.target}
      zoom={shot.zoom}
      shake={shake}
      panKey={shot}
      label="Isometric view of Sam's phone on the left, a presence server in the middle, and a grid of contacts' phones on the right. Green means online."
      markers={markers}
      bounds={bounds}
    >
      {({ now }) => {
        const frac = Math.min(1, Math.max(0, (now - lastTickAt.current) / MS_PER_TICK))
        const c = crowd(sim.msgs.length)
        const tags = new Set(beat.tags ?? [])

        const labels: ReactNode[] = []
        if (tags.has('parties')) {
          labels.push(<Tag key="phone" at={[SPOT.phone.x, 1.2, 0]} label="Sam" />)
          labels.push(<Tag key="server" at={[SPOT.server.x, 1.8, 0]} label="Presence server" />)
        }
        if (tags.has('status')) {
          labels.push(<Tag key="rec" at={[SPOT.server.x, 1.4, 0.9]} label={sim.recorded ? 'Says: online' : 'Says: offline'} danger={sim.recorded !== sim.up} />)
          labels.push(<Tag key="true" at={[SPOT.phone.x, 0.9, 0.9]} label={sim.up ? 'Really: online' : 'Really: offline'} />)
        }
        if (tags.has('contacts')) {
          labels.push(<Tag key="open" at={[contactAt(1).x, 0.9, contactAt(1).z - 0.8]} label="Chat open" />)
          labels.push(<Tag key="rest" at={[contactAt(13).x, 0.7, contactAt(13).z + 1.1]} label="The rest of the contact list" />)
        }
        if (sim.who && sim.tick - sim.whoAt < SHOWN) {
          labels.push(<Tag key="who" at={[SPOT.phone.x + 2.2, 1.6, -1.4]} label={sim.who} />)
        }
        if (sim.crashing) labels.push(<Tag key="crash" at={[SPOT.server.x, 2.3, 0]} label="Restarted" danger />)

        const place = (m: Msg) => {
          const a = endpoint(m, 'from')
          const b = endpoint(m, 'to')
          const p = glide(Math.min(1, Math.max(0, (sim.tick - m.sentAt + frac) / (m.arrive - m.sentAt))))
          return { x: a.x + (b.x - a.x) * p, z: a.z + (b.z - a.z) * p, p }
        }

        return (
          <>
            <IsoBox x={SPOT.phone.x} z={0} w={0.9} d={0.9} h={0.9} fill={colorOf(sim.up)} dim={!sim.up} />
            <IsoBox x={SPOT.server.x} z={0} w={1.4} d={1.4} h={0.9} />
            <IsoBox x={SPOT.server.x} z={0} y={0.9} w={0.6} d={0.6} h={0.25} fill={sim.crashing ? 'var(--danger)' : colorOf(sim.recorded)} />

            {Array.from({ length: CONTACTS }, (_, i) => {
              const { x, z } = contactAt(i)
              const open = i < OPEN
              const hot = sim.tick - sim.flash[i] < GLOW
              return (
                <IsoBox
                  key={`c${i}`}
                  x={x}
                  z={z}
                  w={PITCH * 0.7}
                  d={PITCH * 0.7}
                  h={open ? 0.55 : 0.3}
                  fill={colorOf(sim.shown[i])}
                  stroke={hot ? 'var(--fg)' : undefined}
                  opacity={open || hot ? 1 : 0.8}
                />
              )
            })}

            {sim.msgs.map((m) => {
              const { x, z, p } = place(m)
              const k = (m.kind === 'status' ? 0.16 : 0.24) * c.scale
              const fill = m.kind === 'status' ? colorOf(m.online) : m.kind === 'bye' ? 'var(--muted)' : ON
              return (
                <IsoBox
                  key={m.id}
                  x={x}
                  z={z}
                  y={FLY_Y + Math.sin(p * Math.PI) * 0.4}
                  w={k}
                  d={k}
                  h={k}
                  fill={fill}
                  opacity={c.opacity * edge(p)}
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
