import { describe, expect, it } from 'vitest'
import { CHAPTERS as BLOOM_FILTERS } from './bloom-filters/chapters'
import { CHAPTERS as CAP } from './cap/chapters'
import { CHAPTERS as CACHING } from './caching/chapters'
import { CHAPTERS as CHUNKING_DEDUPE } from './chunking-dedupe/chapters'
import { CHAPTERS as CIRCUIT_BREAKERS } from './circuit-breakers/chapters'
import { CHAPTERS as CONSENSUS } from './consensus/chapters'
import { CHAPTERS as CONSISTENT_HASHING } from './consistent-hashing/chapters'
import { CHAPTERS as FAN_OUT } from './fan-out/chapters'
import { CHAPTERS as GEOSPATIAL } from './geospatial/chapters'
import { CHAPTERS as IDEMPOTENCY } from './idempotency/chapters'
import { CHAPTERS as LOAD_BALANCING } from './load-balancing/chapters'
import { CHAPTERS as LOCKING } from './locking/chapters'
import { CHAPTERS as PRESENCE } from './presence/chapters'
import { CHAPTERS as PUBSUB } from './pubsub/chapters'
import { CHAPTERS as RATE_LIMITING } from './rate-limiting/chapters'
import { CHAPTERS as REAL_TIME } from './real-time/chapters'
import { CHAPTERS as QUEUES } from './queues/chapters'
import { CHAPTERS as REPLICATION } from './replication/chapters'
import { CHAPTERS as TRANSACTIONS } from './transactions/chapters'
import { CHAPTERS as SHARDING } from './sharding/chapters'

const topics = { 'load balancing': LOAD_BALANCING, caching: CACHING, replication: REPLICATION, sharding: SHARDING, 'cap & consistency': CAP, 'message queues': QUEUES, 'pub/sub & streams': PUBSUB, 'rate limiting': RATE_LIMITING, 'consistent hashing': CONSISTENT_HASHING, 'circuit breakers': CIRCUIT_BREAKERS, consensus: CONSENSUS, idempotency: IDEMPOTENCY, 'distributed transactions': TRANSACTIONS, 'bloom filters': BLOOM_FILTERS, 'fan-out': FAN_OUT, 'real-time messaging': REAL_TIME, geospatial: GEOSPATIAL, 'chunking and dedupe': CHUNKING_DEDUPE, presence: PRESENCE, locking: LOCKING }

describe.each(Object.entries(topics))('%s questions', (_, chapters) => {
  const questions = chapters.flatMap((c) => c.beats.flatMap((b) => (b.predict ? [b.predict] : [])))

  it('asks only a few, at the surprising moments', () => {
    expect(questions.length).toBeGreaterThanOrEqual(2)
    expect(questions.length).toBeLessThanOrEqual(3)
  })

  it.each(questions.map((q) => [q.question, q] as const))('is answerable by tapping the scene: %s', (_q, q) => {
    expect(q.clue.trim()).not.toBe('')
    expect(q.options.length).toBeGreaterThanOrEqual(2)
    expect(new Set(q.options.map((o) => o.label)).size).toBe(q.options.length)
    expect(q.answer).toBeGreaterThanOrEqual(0)
    expect(q.answer).toBeLessThan(q.options.length)
    for (const o of q.options) expect(o.at).toHaveLength(3)
  })
})
