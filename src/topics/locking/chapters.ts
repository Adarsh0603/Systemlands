import type { Shot, V3 } from '../../core/types'
import { QUIET_AVG, RUSH_TRIES, type LockingMetrics } from './engine'
import type { LockingChapter, LockingState } from './types'
import { DB } from './world'

const BASE: LockingState = { mode: 'none', hold: 'seat', lease: 0, fence: false, crowd: 'two', fault: 'none', sale: 0, round: 0 }

const WIDE: Shot = { target: [-1.2, 0.6, 0], zoom: 0.8 }

// Tap targets for a question, above the database.
const ASK_AT = {
  left: (label: string) => ({ label, at: [DB.x - 1.4, 2.2, DB.z - 1.6] as V3 }),
  right: (label: string) => ({ label, at: [DB.x + 1.4, 2.2, DB.z - 1.6] as V3 }),
}

type Part = { label: string; state: 'todo' | 'pass' | 'fail' }

// The last chapter: one quiet day and one rush, each judged once its sale is over.
export function dayParts(m: LockingMetrics): Part[] {
  const q = m.marks.quiet
  const r = m.marks.rush
  return [
    { label: `Quiet Tuesday: nothing sold twice, buying takes under ${QUIET_AVG} s on average`, state: !q ? 'todo' : q.twice === 0 && q.avg <= QUIET_AVG ? 'pass' : 'fail' },
    { label: `Concert rush: nothing sold twice, at most ${RUSH_TRIES} writes per ticket`, state: !r ? 'todo' : r.twice === 0 && r.tries <= RUSH_TRIES ? 'pass' : 'fail' },
  ]
}

export const CHAPTERS: LockingChapter[] = [
  {
    title: 'Two buyers, one seat',
    level: 'Beginner',
    initial: { ...BASE },
    beats: [
      {
        caption: 'One seat left.',
        sub: 'Two fans want the last seat for tonight’s show. To buy, each one asks the database how many seats are left, then writes one fewer and takes that seat.',
        shot: WIDE,
        tags: ['parties', 'left', 'seats'],
      },
      {
        caption: 'They click at the same moment.',
        sub: 'Both ask. Both hear “1 left”.',
        set: { sale: 1 },
        predict: {
          clue: 'Each buyer reads “1 left”, then writes “0 left” and takes the seat. Neither looks again before writing.',
          question: 'How many tickets are sold for the last seat?',
          options: [ASK_AT.left('One'), ASK_AT.right('Two')],
          answer: 1,
        },
        shot: WIDE,
        tags: ['parties', 'left', 'seats'],
        hud: ['left', 'sold'],
      },
      {
        caption: 'Sold twice.',
        sub: 'Both writes said “0 left”, so the count looks fine. But two fans hold a ticket for the same seat, and one of them finds out at the door.',
        shot: WIDE,
        tags: ['parties', 'left', 'seats'],
        hud: ['left', 'sold', 'twice'],
      },
      {
        caption: 'The gap is the problem.',
        sub: 'Between reading “1 left” and writing “0 left”, nothing stops another buyer reading the same thing. This is a race condition. We need to close that gap.',
        shot: WIDE,
        tags: ['parties', 'left', 'seats'],
        hud: ['sold', 'twice'],
      },
    ],
  },
  {
    title: 'Lock the seats',
    level: 'Beginner',
    initial: { ...BASE, mode: 'lock' },
    beats: [
      {
        caption: 'Take a lock first.',
        sub: 'Before reading, a buyer asks the lock service for the lock on the seats. Only one buyer can hold it. Anyone else waits in line.',
        shot: WIDE,
        tags: ['parties', 'left', 'seats', 'lock'],
      },
      {
        caption: 'One at a time.',
        sub: 'The first buyer gets the lock, reads “1 left”, takes the seat and lets go. Then the second gets it, reads “0 left”, and is told the show is sold out.',
        set: { sale: 1 },
        shot: WIDE,
        tags: ['parties', 'left', 'seats', 'lock'],
        hud: ['left', 'sold', 'twice'],
      },
      {
        caption: 'Right, and slower.',
        sub: 'The second buyer waited for the first one to finish. Waiting is the price of a lock.',
        shot: WIDE,
        tags: ['parties', 'left', 'seats', 'lock'],
        hud: ['sold', 'wait'],
      },
      {
        sub: 'Choose how buyers buy, then open sales again.',
        set: { mode: 'none', sale: 2 },
        shot: WIDE,
        tags: ['parties', 'left', 'seats', 'lock'],
        controls: ['mode', 'sale'],
        modes: ['none', 'lock'],
        hud: ['sold', 'twice'],
        challenge: {
          goal: 'Sell the last seat exactly once.',
          win: 'A lock closes the gap between the read and the write: only the holder can do either.',
          holdSeconds: 2,
          check: ({ m, st }) => st.mode === 'lock' && m.done && m.tickets === 1 && m.twice === 0,
        },
      },
    ],
  },
  {
    title: 'Everyone wants in',
    level: 'Intermediate',
    initial: { ...BASE, mode: 'lock', hold: 'pay', crowd: 'eight' },
    beats: [
      {
        caption: 'Eight fans, eight seats.',
        sub: 'Every buyer changes the same row: the count of seats left. So every buyer needs the same lock.',
        shot: WIDE,
        tags: ['parties', 'left', 'seats', 'lock'],
      },
      {
        caption: 'A long line.',
        sub: 'Each holder charges the card while it holds the lock. That takes 3 seconds, and the last fan waits for everyone in front.',
        set: { sale: 1 },
        shot: WIDE,
        tags: ['parties', 'left', 'seats', 'lock'],
        hud: ['sold', 'wait'],
      },
      {
        caption: 'Hold it for less.',
        sub: 'Take the seat under the lock and let go at once. Charge the card after. If the card fails, give the seat back.',
        set: { hold: 'seat', sale: 2 },
        shot: WIDE,
        tags: ['parties', 'left', 'seats', 'lock'],
        hud: ['sold', 'wait'],
      },
      {
        caption: 'A hot row.',
        sub: 'A row that everyone writes is called a hot row. A lock on it lets one buyer in at a time, so keep the work done under the lock short.',
        shot: WIDE,
        tags: ['parties', 'left', 'seats', 'lock'],
        hud: ['sold', 'wait'],
      },
      {
        sub: 'Choose what a buyer does while holding the lock, then open sales again.',
        set: { hold: 'pay', sale: 3 },
        shot: WIDE,
        tags: ['parties', 'left', 'seats', 'lock'],
        controls: ['hold', 'sale'],
        hud: ['sold', 'twice', 'wait'],
        challenge: {
          goal: 'Sell all 8 seats once each, with nobody waiting more than 15 seconds for the lock.',
          win: 'Hold a lock only for the change it protects. Slow work goes outside it.',
          holdSeconds: 2,
          check: ({ m, st }) => st.mode === 'lock' && m.done && m.served === 8 && m.twice === 0 && m.longest <= 15,
        },
      },
    ],
  },
  {
    title: 'Check the version',
    level: 'Intermediate',
    initial: { ...BASE, mode: 'version' },
    beats: [
      {
        caption: 'No lock at all.',
        sub: 'The row now carries a version number. A buyer reads “1 left, version 7”, then writes “0 left, but only if it is still version 7”.',
        shot: WIDE,
        tags: ['parties', 'left', 'seats'],
      },
      {
        caption: 'They click at the same moment.',
        sub: 'Both read version 7. Both write.',
        set: { sale: 1 },
        predict: {
          clue: 'Both buyers read version 7. The first write that lands makes it version 8.',
          question: 'What happens to the second write?',
          options: [ASK_AT.left('It is saved'), ASK_AT.right('It is turned down')],
          answer: 1,
        },
        shot: WIDE,
        tags: ['parties', 'left', 'seats'],
        hud: ['left', 'sold'],
      },
      {
        caption: 'Turned down, so it reads again.',
        sub: 'The second buyer reads again, sees “0 left”, and is told the show is sold out. Nobody waited in a line, and nothing was sold twice.',
        shot: WIDE,
        tags: ['parties', 'left', 'seats'],
        hud: ['sold', 'twice', 'retries'],
      },
      {
        caption: 'Cheap while collisions are rare.',
        sub: 'This is optimistic locking. When buyers seldom write the same row at the same moment, almost every write goes through the first time.',
        shot: WIDE,
        tags: ['parties', 'left', 'seats'],
        hud: ['sold', 'retries'],
      },
      {
        sub: 'Choose how buyers buy, then open sales again.',
        set: { mode: 'none', sale: 2 },
        shot: WIDE,
        tags: ['parties', 'left', 'seats'],
        controls: ['mode', 'sale'],
        modes: ['none', 'version'],
        hud: ['sold', 'twice', 'retries'],
        challenge: {
          goal: 'Sell the last seat exactly once, without a lock.',
          win: 'A version check turns the late write down, so a race can no longer sell a seat twice.',
          holdSeconds: 2,
          check: ({ m, st }) => st.mode === 'version' && m.done && m.tickets === 1 && m.twice === 0,
        },
      },
    ],
  },
  {
    title: 'The holder crashes',
    level: 'Advanced',
    initial: { ...BASE, mode: 'lock', hold: 'pay', crowd: 'four', fault: 'crash', lease: 0 },
    beats: [
      {
        caption: 'A lock on another machine.',
        sub: 'Many app servers sell tickets, so the lock lives in a shared lock service. Each holder needs it for about 3 seconds.',
        shot: WIDE,
        tags: ['parties', 'left', 'seats', 'lock'],
      },
      {
        caption: 'The holder crashes.',
        sub: 'The first buyer’s server dies while it holds the lock. It will never let go, so everyone else waits for ever.',
        set: { sale: 1 },
        shot: WIDE,
        tags: ['parties', 'left', 'seats', 'lock'],
        hud: ['sold', 'wait'],
      },
      {
        caption: 'Give the lock a lease.',
        sub: 'The lock service takes the lock back by itself after a set time, here 5 seconds. A holder that is still alive finishes long before that.',
        set: { lease: 5, sale: 2 },
        shot: WIDE,
        tags: ['parties', 'left', 'seats', 'lock'],
        hud: ['sold', 'wait'],
      },
      {
        caption: 'How long a lease?',
        sub: 'Too long, and a crash stops sales for that long. Too short, and the lease runs out while a healthy holder is still working, so two buyers are inside at once.',
        shot: WIDE,
        tags: ['parties', 'left', 'seats', 'lock'],
        hud: ['sold', 'twice', 'wait'],
      },
      {
        sub: 'Choose the lease, then open sales again. The first holder will crash.',
        set: { lease: 0, sale: 3 },
        shot: WIDE,
        tags: ['parties', 'left', 'seats', 'lock'],
        controls: ['lease', 'sale'],
        hud: ['sold', 'twice', 'wait'],
        challenge: {
          goal: 'The first holder crashes. Sell the other 3 seats once each, with nobody waiting more than 20 seconds for the lock.',
          win: 'A lease frees a lock that its holder can no longer let go. It must be longer than the work, and short enough to recover fast.',
          holdSeconds: 2,
          check: ({ m, st }) => st.mode === 'lock' && st.fault === 'crash' && m.done && m.crashed >= 1 && m.served === 3 && m.twice === 0 && m.longest <= 20,
        },
      },
    ],
  },
  {
    title: 'The holder wakes up late',
    level: 'Advanced',
    initial: { ...BASE, mode: 'lock', hold: 'pay', crowd: 'four', fault: 'pause', lease: 5 },
    beats: [
      {
        caption: 'A pause, not a crash.',
        sub: 'This time the first holder’s server freezes for 8 seconds, busy cleaning up its memory. Its lease runs out after 5.',
        shot: WIDE,
        tags: ['parties', 'left', 'seats', 'lock'],
      },
      {
        caption: 'Someone else gets the lock.',
        sub: 'The lease runs out, and the next buyer takes the lock. The frozen server has not written yet, so the count still says 4.',
        set: { sale: 1 },
        predict: {
          clue: 'The frozen server still thinks it holds the lock. It read “4 left” before it froze.',
          question: 'It wakes up and writes “3 left”. Is that saved?',
          options: [ASK_AT.left('Yes'), ASK_AT.right('No')],
          answer: 0,
        },
        shot: WIDE,
        tags: ['parties', 'left', 'seats', 'lock'],
        hud: ['left', 'sold'],
      },
      {
        caption: 'Sold twice again.',
        sub: 'Two buyers read “4 left” and took the same seat. A lease cannot stop a holder that does not know its time is up.',
        shot: WIDE,
        tags: ['parties', 'left', 'seats', 'lock'],
        hud: ['sold', 'twice'],
      },
      {
        caption: 'Fencing tokens.',
        sub: 'Each time the lock service hands out the lock, it adds a number that goes up: 1, then 2. The database remembers the highest it has seen, and turns down a write with a lower one.',
        set: { fence: true, sale: 2 },
        shot: WIDE,
        tags: ['parties', 'left', 'seats', 'lock'],
        hud: ['sold', 'twice', 'rejected'],
      },
      {
        caption: 'The late write bounces.',
        sub: 'The woken server writes with number 1 after the database has seen 2, so it is turned down. That buyer asks for the lock again and buys a seat properly.',
        shot: WIDE,
        tags: ['parties', 'left', 'seats', 'lock'],
        hud: ['sold', 'twice', 'rejected'],
      },
      {
        sub: 'Choose what the database checks, then open sales again. The first holder will freeze.',
        set: { fence: false, sale: 3 },
        shot: WIDE,
        tags: ['parties', 'left', 'seats', 'lock'],
        controls: ['fence', 'sale'],
        hud: ['sold', 'twice', 'rejected'],
        challenge: {
          goal: 'The first holder freezes past its lease. Sell all 4 seats once each.',
          win: 'A lease keeps sales moving. A fencing token stops a late holder from undoing someone else’s work.',
          holdSeconds: 2,
          check: ({ m, st }) => st.mode === 'lock' && st.fault === 'pause' && m.done && m.served === 4 && m.twice === 0,
        },
      },
    ],
  },
  {
    title: 'Lock or version?',
    level: 'Advanced',
    initial: { ...BASE, mode: 'lock', hold: 'seat', lease: 5, fence: true, crowd: 'quiet' },
    beats: [
      {
        caption: 'Two kinds of day.',
        sub: 'On a quiet Tuesday a few fans buy seats now and then, and two might click at once. When a big show goes on sale, everyone arrives in the same moment.',
        shot: WIDE,
        tags: ['parties', 'left', 'seats', 'lock'],
      },
      {
        caption: 'Each way has a price.',
        sub: 'A lock costs every buyer a trip to the lock service, even when nobody else is there. A version check needs no trip, but in a crowd most writes are turned down and done again.',
        shot: WIDE,
        tags: ['parties', 'left', 'seats', 'lock'],
      },
      {
        sub: 'Pick a day and a way to buy, then open sales. Each day counts once its sale is over.',
        set: { sale: 1, round: 1 },
        shot: WIDE,
        tags: ['parties', 'left', 'seats', 'lock'],
        controls: ['crowd', 'mode', 'sale'],
        modes: ['lock', 'version'],
        hud: ['sold', 'twice', 'avg', 'tries'],
        challenge: {
          goal: 'Pick the better way for each day:',
          win: 'Few collisions: check a version and retry. Many: take a lock and wait in line. The right choice depends on how often buyers collide.',
          holdSeconds: 1,
          parts: ({ m }) => dayParts(m),
          progress: ({ m }) => dayParts(m).filter((p) => p.state === 'pass').length / 2,
          check: ({ m }) => dayParts(m).every((p) => p.state === 'pass'),
        },
      },
    ],
  },
]
