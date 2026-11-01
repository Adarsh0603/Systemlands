import type { Shot } from '../../core/types'
import { OPEN } from './world'
import type { PresenceChapter, PresenceState } from './types'

const BASE: PresenceState = { mode: 'flag', interval: 5, grace: 0, audience: 'all', store: 'memory', leave: 0, die: 0, back: 0, tunnel: 0, crash: 0, round: 0 }

const WIDE: Shot = { target: [-1.5, 0.5, 0], zoom: 0.62 }

// Tap targets for a question, in the middle of the scene.
const ASK_AT = {
  left: (label: string) => ({ label, at: [-1.2, 1.6, -1.2] as [number, number, number] }),
  right: (label: string) => ({ label, at: [1.2, 1.6, -1.2] as [number, number, number] }),
}

export const CHAPTERS: PresenceChapter[] = [
  {
    title: 'Is Sam online?',
    level: 'Beginner',
    initial: { ...BASE, mode: 'flag' },
    beats: [
      {
        caption: 'Is Sam around?',
        sub: 'You open a chat. A green dot next to Sam’s name tells you whether a reply will come now or tomorrow.',
        shot: WIDE,
        tags: ['parties', 'contacts'],
      },
      {
        caption: 'The phone says goodbye.',
        sub: 'When Sam closes the app, the phone tells the presence server. The server tells Sam’s contacts, and the dots go grey.',
        set: { leave: 1 },
        shot: WIDE,
        tags: ['parties', 'status', 'contacts'],
        hud: ['seen'],
      },
      {
        caption: 'And hello.',
        sub: 'When Sam opens the app again, the phone says hello. The dots go green.',
        set: { back: 1 },
        shot: WIDE,
        tags: ['parties', 'status', 'contacts'],
        hud: ['seen'],
      },
      {
        caption: 'Then the phone dies.',
        sub: 'Sam’s battery runs out in a lift. A dead phone says nothing, not even goodbye.',
        set: { die: 1 },
        predict: {
          clue: 'The server only changes what it believes when the phone says something. This phone said nothing.',
          question: 'What do Sam’s contacts see?',
          options: [ASK_AT.left('Online'), ASK_AT.right('Offline')],
          answer: 0,
        },
        shot: WIDE,
        tags: ['parties', 'status', 'contacts'],
        hud: ['seen', 'stale'],
      },
      {
        caption: 'Online, for ever.',
        sub: 'The server is waiting for a goodbye that will never come. Sam’s phone is off, and everyone still sees a green dot. We need a way to find out that a phone went quiet.',
        shot: WIDE,
        tags: ['parties', 'status', 'contacts'],
        hud: ['seen', 'stale'],
      },
    ],
  },
  {
    title: 'Heartbeats',
    level: 'Beginner',
    initial: { ...BASE, mode: 'beat', interval: 5 },
    beats: [
      {
        caption: 'Say “still here”.',
        sub: 'The phone sends a tiny ping every 5 seconds while it is connected. It carries nothing but “I am here”.',
        shot: WIDE,
        tags: ['parties', 'contacts'],
        hud: ['pings'],
      },
      {
        caption: 'Quiet means gone.',
        sub: 'The phone dies. No goodbye, but the pings stop. After three missed pings in a row, the server decides Sam is gone and tells the contacts.',
        set: { die: 1 },
        shot: WIDE,
        tags: ['parties', 'status', 'contacts'],
        hud: ['seen', 'stale', 'pings'],
      },
      {
        caption: 'Why three?',
        sub: 'One missed ping can be a slow network. Three in a row is not an accident. The longer the server waits, the fewer mistakes it makes, and the longer a dead phone looks alive.',
        shot: WIDE,
        tags: ['parties', 'status', 'contacts'],
        hud: ['seen', 'stale'],
      },
      {
        sub: 'Go back to hello and goodbye, then use heartbeats, and let the phone die.',
        set: { mode: 'flag', round: 1 },
        shot: WIDE,
        tags: ['parties', 'status', 'contacts'],
        controls: ['mode', 'die'],
        hud: ['seen', 'stale'],
        challenge: {
          goal: 'Use heartbeats, let the phone die, and make the contacts see “offline”.',
          win: 'A phone that cannot say goodbye still gives itself away by going quiet.',
          holdSeconds: 2,
          check: ({ m, st }) => st.mode === 'beat' && m.dies >= 1 && m.waiting === 0 && !m.up && !m.shown,
        },
      },
    ],
  },
  {
    title: 'How often?',
    level: 'Intermediate',
    initial: { ...BASE, mode: 'beat', interval: 40 },
    beats: [
      {
        caption: 'Every 40 seconds.',
        sub: 'Cheap: hardly any pings. The server waits for three missed ones.',
        shot: WIDE,
        tags: ['parties', 'contacts'],
        hud: ['pings'],
      },
      {
        caption: 'A dead phone looks alive for two minutes.',
        sub: 'Three missed pings of 40 seconds is 120 seconds. Sam’s dot stays green all that time.',
        set: { die: 1 },
        shot: WIDE,
        tags: ['parties', 'status', 'contacts'],
        hud: ['seen', 'stale'],
      },
      {
        caption: 'So ping often?',
        sub: 'Every second, a dead phone shows within 3 seconds. But a million phones now send a million pings every second, and the server must take every one.',
        set: { interval: 1 },
        shot: WIDE,
        tags: ['parties', 'load'],
        hud: ['pings', 'load'],
      },
      {
        caption: 'A few seconds late, a lot cheaper.',
        sub: 'Every 10 seconds sends ten times fewer pings than every second. For a green dot, nobody needs to know within one second.',
        set: { interval: 10 },
        predict: {
          clue: 'A million phones. Each one pings once per interval.',
          question: 'Which interval is easier on the server?',
          options: [ASK_AT.left('Every 2 seconds'), ASK_AT.right('Every 20 seconds')],
          answer: 1,
        },
        shot: WIDE,
        tags: ['parties', 'load'],
        hud: ['pings', 'load'],
      },
      {
        sub: 'Find an interval that shows a dead phone quickly and keeps the load under 200,000 pings a second.',
        set: { interval: 40, round: 1 },
        shot: WIDE,
        tags: ['parties', 'status', 'contacts'],
        controls: ['interval', 'die'],
        hud: ['seen', 'stale', 'load'],
        challenge: {
          goal: 'Show a dead phone as offline within 20 seconds, with no more than 200,000 pings a second from a million phones.',
          win: 'Fast enough to notice, cheap enough to run. Real apps pick somewhere between a few seconds and a minute.',
          holdSeconds: 2,
          check: ({ m, st }) => st.mode === 'beat' && m.dies >= 1 && m.waiting === 0 && !m.up && !m.shown && m.late <= 20 && m.load <= 200_000,
        },
      },
    ],
  },
  {
    title: 'The flapping phone',
    level: 'Intermediate',
    initial: { ...BASE, mode: 'beat', interval: 2, grace: 0 },
    beats: [
      {
        caption: 'A bad road.',
        sub: 'Sam drives through two tunnels. Each time, the phone loses its connection for 20 seconds, then it comes back.',
        shot: WIDE,
        tags: ['parties', 'contacts'],
        hud: ['flips'],
      },
      {
        caption: 'The dot blinks.',
        sub: 'The server gives up after 6 seconds of quiet, and tells everyone. Then the phone returns, and it tells everyone again. Every contact sees the dot blink, and every blink is a message to all of them.',
        set: { tunnel: 1 },
        shot: WIDE,
        tags: ['parties', 'status', 'contacts'],
        hud: ['flips', 'updates'],
      },
      {
        caption: 'Wait before saying “offline”.',
        sub: 'The server waits 20 seconds after the last ping before it says anything. If a ping turns up in that time, it says nothing.',
        set: { grace: 20 },
        shot: WIDE,
        tags: ['parties', 'contacts'],
        hud: ['flips', 'updates'],
      },
      {
        caption: 'Calm dots.',
        sub: 'The tunnels are shorter than the wait. Nothing changed for the contacts, and nobody got a message.',
        set: { tunnel: 2 },
        shot: WIDE,
        tags: ['parties', 'status', 'contacts'],
        hud: ['flips', 'updates'],
      },
      {
        caption: 'But a real death is slower.',
        sub: 'Sam’s phone really dies now. The server waits for 6 seconds of quiet, then 20 more. The dot stays green for 26 seconds.',
        set: { die: 1 },
        shot: WIDE,
        tags: ['parties', 'status', 'contacts'],
        hud: ['seen', 'stale'],
      },
      {
        sub: 'Drive through the tunnels without blinking, and still show a dead phone within 30 seconds.',
        set: { grace: 0, round: 1 },
        shot: WIDE,
        tags: ['parties', 'status', 'contacts'],
        controls: ['interval', 'grace', 'tunnel', 'die'],
        hud: ['seen', 'flips', 'stale'],
        challenge: {
          goal: 'Drive through the tunnels, then let the phone die. The dot may change twice at most, and a dead phone must show as offline within 30 seconds.',
          win: 'A short wait hides bumps in the road. A short wait also keeps real news from being too late.',
          holdSeconds: 2,
          check: ({ m }) => m.tunnels >= 1 && m.dies >= 1 && m.waiting === 0 && !m.up && !m.shown && m.flips <= 2 && m.late <= 30,
        },
      },
    ],
  },
  {
    title: 'Who gets told?',
    level: 'Intermediate',
    initial: { ...BASE, mode: 'beat', interval: 5, audience: 'all' },
    beats: [
      {
        caption: 'Three hundred contacts.',
        sub: 'Sam has 300 contacts. The block on the right stands for them. Three have Sam’s chat open on their screen right now.',
        shot: WIDE,
        tags: ['parties', 'contacts'],
      },
      {
        caption: 'One change, a message to everyone.',
        sub: 'Sam closes the app, and the server sends an update to every contact. Most of them are not looking at Sam’s chat.',
        set: { leave: 1 },
        shot: WIDE,
        tags: ['parties', 'contacts'],
        hud: ['updates'],
      },
      {
        caption: 'Now a million people.',
        sub: 'Everyone changes status every few minutes, and every change goes to 300 contacts. That is a million updates a second, to show dots nobody is looking at.',
        shot: WIDE,
        tags: ['parties', 'contacts'],
        hud: ['updates', 'fan'],
      },
      {
        caption: 'Who needs it?',
        sub: 'Sam comes back. A dot only matters to someone who can see it.',
        set: { back: 1 },
        predict: {
          clue: 'Three contacts have the chat open. Twenty-four do not, and will look when they open it.',
          question: 'Who needs to hear it right now?',
          options: [ASK_AT.left('The three with the chat open'), ASK_AT.right('All contacts')],
          answer: 0,
        },
        shot: WIDE,
        tags: ['parties', 'contacts'],
        hud: ['updates'],
      },
      {
        caption: 'Tell only the chats on screen.',
        sub: 'The server sends updates to the people looking at Sam. Anyone who opens the chat later asks the server once, and gets the answer then.',
        set: { audience: 'open' },
        shot: WIDE,
        tags: ['parties', 'contacts'],
        hud: ['updates', 'fan'],
      },
      {
        caption: 'A hundred times less.',
        sub: 'Three updates instead of 300. The people who can see the dot still see the right one.',
        set: { leave: 2 },
        shot: WIDE,
        tags: ['parties', 'contacts'],
        hud: ['seen', 'updates', 'fan'],
      },
      {
        sub: 'Tell only the chats on screen, and change Sam’s status twice.',
        set: { audience: 'all', round: 1 },
        shot: WIDE,
        tags: ['parties', 'contacts'],
        controls: ['audience', 'leave', 'back'],
        hud: ['seen', 'updates', 'fan'],
        challenge: {
          goal: `Send updates only to the chats on screen (${OPEN} people), and change Sam’s status twice. The watcher must still see the right dot.`,
          win: 'The server sends only what someone can see. Everyone else asks when they look.',
          holdSeconds: 2,
          check: ({ m, st }) => st.audience === 'open' && m.changes >= 2 && m.waiting === 0 && m.perChange <= OPEN && m.shown === m.up,
        },
      },
    ],
  },
  {
    title: 'Where it lives',
    level: 'Advanced',
    initial: { ...BASE, mode: 'beat', interval: 5, store: 'disk' },
    beats: [
      {
        caption: 'Every ping is a write.',
        sub: 'The server records “seen at” for each ping. A million phones every 5 seconds is 200,000 writes a second. A disk-backed database takes about 50,000.',
        shot: WIDE,
        tags: ['parties', 'load'],
        hud: ['pings', 'load'],
      },
      {
        caption: 'The store falls behind.',
        sub: 'It cannot write them all, so some pings are lost. Sam’s phone is fine, but the server stops hearing from it for three pings in a row and gives up. Watch the dot blink.',
        shot: WIDE,
        tags: ['parties', 'status', 'contacts', 'load'],
        hud: ['seen', 'flips', 'load'],
      },
      {
        caption: 'Keep it in memory.',
        sub: 'A ping refreshes a key that expires after three intervals. If the key expires, the phone is offline. Memory takes 400,000 writes a second, and the timeout comes for free.',
        set: { store: 'memory' },
        shot: WIDE,
        tags: ['parties', 'status', 'contacts', 'load'],
        hud: ['seen', 'flips', 'load'],
      },
      {
        caption: 'And if it restarts?',
        sub: 'Memory forgets everything. For a moment every phone looks offline. The next ping from each one brings it back, so it repairs itself within one interval.',
        set: { crash: 1 },
        shot: WIDE,
        tags: ['parties', 'status', 'contacts'],
        hud: ['seen', 'stale'],
      },
      {
        sub: 'Store presence so that a million phones cause no lost pings, a dead phone shows within 30 seconds, and a restart repairs itself.',
        set: { store: 'disk', interval: 5, round: 1 },
        shot: WIDE,
        tags: ['parties', 'load'],
        controls: ['store', 'interval', 'crash'],
        hud: ['seen', 'flips', 'load'],
        challenge: {
          goal: 'Pick a store and an interval: no pings lost, a dead phone noticed within 30 seconds, and a restart that heals itself.',
          win: 'Presence is many small, short-lived writes. Memory with expiry fits it, and a restart costs only a moment.',
          holdSeconds: 2,
          check: ({ m, st }) => st.mode === 'beat' && st.interval * 3 <= 30 && m.load <= m.cap && m.lost === 0 && m.crashes >= 1 && m.waiting === 0 && m.up && m.shown,
        },
      },
    ],
  },
  {
    title: 'Which one to use',
    level: 'Advanced',
    initial: { ...BASE, mode: 'flag', interval: 20, grace: 0, audience: 'all', store: 'disk' },
    beats: [
      {
        caption: 'A full day.',
        sub: 'Sam drives through tunnels, the phone dies, and the server restarts. Contacts must see the right dot, a dead phone must show within 40 seconds, the load must fit, and nobody gets messages they do not need.',
        shot: WIDE,
        tags: ['parties', 'status', 'contacts'],
        hud: ['seen', 'flips', 'updates'],
      },
      {
        sub: 'Set it up, then play the whole day: tunnels, a dead phone, and a restart.',
        set: { round: 1 },
        shot: WIDE,
        tags: ['parties', 'status', 'contacts'],
        controls: ['mode', 'interval', 'grace', 'audience', 'store', 'tunnel', 'die', 'crash'],
        hud: ['seen', 'stale', 'flips', 'updates', 'load'],
        challenge: {
          goal: 'Run the whole day. The dot may change at most three times, a dead phone must show within 40 seconds, no pings may be lost, and only the chats on screen are told.',
          win: 'Heartbeats find dead phones, a short wait hides bumps, the right people get told, and memory with expiry keeps up.',
          holdSeconds: 2,
          check: ({ m, st }) =>
            st.mode === 'beat' &&
            st.interval * 3 + st.grace <= 40 &&
            m.tunnels >= 1 &&
            m.dies >= 1 &&
            m.crashes >= 1 &&
            m.waiting === 0 &&
            !m.up &&
            !m.shown &&
            m.lost === 0 &&
            m.load <= m.cap &&
            m.perChange <= OPEN &&
            m.flips <= 3 &&
            m.late <= 40,
        },
      },
    ],
  },
]
