import { currentProgress } from '../core/progress'
import { markSeen, useSeenTips } from '../core/tips'
import { PROJECTS, TIER_NAMES } from './projects'
import { TOPICS, TRACKS } from '../topics/registry'

// Notes for learners who were here before something changed, newest first. To
// announce a change, add one entry at the top with an id never used before.
export interface News {
  id: string
  date: string // when it shipped, YYYY-MM-DD
  title: string
  body: string
  topic?: string // registry id of the tactic or system it points to, if any
}

export const NEWS: News[] = [
  {
    id: 'tradeoffs',
    date: '2026-11-09',
    title: 'Tradeoffs on every choice',
    body: 'In a build, tap the (i) beside a setting to see what your choice gains and what it costs.',
  },
  {
    id: 'locking',
    date: '2026-11-09',
    title: 'New tactic: Locking & concurrency',
    body: 'Stop two requests from selling the same seat.',
    topic: 'locking',
  },
  {
    id: 'whatsapp',
    date: '2026-11-01',
    title: 'New system: WhatsApp',
    body: 'Deliver a hundred billion messages a day, even to phones that are off.',
    topic: 'whatsapp',
  },
  {
    id: 'presence',
    date: '2026-11-01',
    title: 'New tactic: Presence',
    body: 'Show who is online without flooding the server.',
    topic: 'presence',
  },
]

// Each note is remembered with the first-visit tips, so it syncs with progress
// and a signed-in learner sees it once across devices.
export const seenId = (n: News) => `news:${n.id}`

// A first-time visitor has nothing to catch up on: every note that exists now
// counts as seen, so only changes made after their first visit are announced.
if (Object.keys(currentProgress()).length === 0) NEWS.forEach((n) => markSeen(seenId(n)))

export function useUnseenNews(): News[] {
  const seen = useSeenTips()
  return NEWS.filter((n) => !seen.includes(seenId(n)))
}

export const markNewsSeen = () => NEWS.forEach((n) => markSeen(seenId(n)))

// Whether this browser has already closed the welcome dialog (same key it uses),
// so the notes never pile on top of it.
export function welcomeSeen() {
  try {
    return localStorage.getItem('systemlands.welcome') === '1'
  } catch {
    return false
  }
}

// Where a note's tactic or system lives, step by step, so the learner can find it: a tactic
// by its Arsenal track (e.g. "Distributed systems / Locking & concurrency"), a
// system by its tier on the map (e.g. "Expert / WhatsApp").
export function newsPath(n: News): string[] | undefined {
  const topic = n.topic && TOPICS.find((t) => t.id === n.topic)
  if (!topic) return undefined
  if (topic.track === 'capstones') {
    const project = PROJECTS.find((p) => p.id === topic.id)
    return project ? [TIER_NAMES[project.tier], topic.title] : [topic.title]
  }
  const track = TRACKS.find((t) => t.id === topic.track)
  return track ? [track.title, topic.title] : [topic.title]
}
