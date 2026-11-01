import { TOPICS } from '../topics/registry'

// The projects on the realm map: interview-style systems, easy to hard. The list is the road's order, with the AI isles last, after every expert project. Each
// lists the concepts it needs, which link to the lessons.

export type Tier = 0 | 1 | 2 | 3 | 4
export const TIER_NAMES = ['Starter', 'Intermediate', 'Advanced', 'Expert', 'AI'] as const

export interface Project {
  id: string // the registry id once built
  name: string
  short: string // fits under the castle when the map is zoomed out on a phone
  tier: Tier
  x: number // where its castle stands on the map (viewBox 1600 x 800)
  y: number
  needs: string[]
}

// Concepts, by the name a project uses, to the lesson that teaches them.
const LESSON: Record<string, string> = {
  Caching: 'caching',
  Replication: 'replication',
  Sharding: 'sharding',
  'Bloom filters': 'bloom-filters',
  'Rate limiting': 'rate-limiting',
  'Message queues': 'queues',
  'Pub/sub': 'pubsub',
  Idempotency: 'idempotency',
  'Consistent hashing': 'consistent-hashing',
  CDN: 'cdn',
  Autoscaling: 'autoscaling',
  CAP: 'cap',
  Consensus: 'consensus',
  Sagas: 'sagas',
  'Circuit breakers': 'circuit-breakers',
  'Fan-out': 'fan-out',
  'Real-time messaging': 'real-time',
  Presence: 'presence',
  Geospatial: 'geospatial',
  'Chunking and dedupe': 'chunking-dedupe',
  'Adaptive streaming': 'adaptive-streaming',
  'Inverted index': 'search',
}

export interface Concept {
  name: string
  // The lesson's registry id, when it is built.
  built?: string
}

export function conceptOf(name: string): Concept {
  const id = LESSON[name]
  const built = id && TOPICS.some((t) => t.id === id && t.Play) ? id : undefined
  return { name, built }
}

export const PROJECTS: Project[] = [
  { id: 'url-shortener', name: 'URL shortener', short: 'URL', tier: 0, x: 200, y: 690, needs: ['Caching', 'Replication', 'Sharding', 'Bloom filters', 'Rate limiting'] },
  { id: 'notifications', name: 'Notifications', short: 'Notify', tier: 0, x: 340, y: 652, needs: ['Message queues', 'Pub/sub', 'Rate limiting', 'Idempotency'] },
  { id: 'web-crawler', name: 'Web crawler', short: 'Crawler', tier: 0, x: 470, y: 685, needs: ['Message queues', 'Bloom filters', 'Rate limiting', 'Consistent hashing'] },
  { id: 'news-feed', name: 'Social feed', short: 'Feed', tier: 1, x: 630, y: 615, needs: ['Caching', 'Fan-out', 'Message queues', 'Sharding'] },
  { id: 'chat', name: 'Chat app', short: 'Chat', tier: 1, x: 770, y: 572, needs: ['Real-time messaging', 'Pub/sub', 'Replication', 'Consistent hashing'] },
  { id: 'video-streaming', name: 'Video streaming', short: 'Video', tier: 1, x: 930, y: 560, needs: ['CDN', 'Message queues', 'Autoscaling', 'Caching'] },
  { id: 'key-value-store', name: 'Key-value store', short: 'KV store', tier: 1, x: 660, y: 492, needs: ['Consistent hashing', 'Replication', 'CAP', 'Consensus'] },
  { id: 'payments', name: 'Payments', short: 'Payments', tier: 2, x: 380, y: 445, needs: ['Idempotency', 'Sagas', 'Circuit breakers', 'Consensus'] },
  { id: 'ride-sharing', name: 'Ride sharing', short: 'Rides', tier: 2, x: 230, y: 400, needs: ['Geospatial', 'Sharding', 'Pub/sub', 'Consensus'] },
  { id: 'twitter-timeline', name: 'Twitter timeline', short: 'Twitter', tier: 3, x: 540, y: 310, needs: ['Fan-out', 'Caching', 'Sharding', 'Message queues', 'Consistent hashing'] },
  { id: 'youtube', name: 'YouTube', short: 'YouTube', tier: 3, x: 720, y: 355, needs: ['CDN', 'Autoscaling', 'Message queues', 'Caching', 'Adaptive streaming'] },
  { id: 'dropbox', name: 'Dropbox', short: 'Dropbox', tier: 3, x: 920, y: 355, needs: ['Chunking and dedupe', 'CDN', 'Sharding', 'Replication', 'Message queues'] },
  { id: 'whatsapp', name: 'WhatsApp', short: 'WhatsApp', tier: 3, x: 1060, y: 330, needs: ['Real-time messaging', 'Presence', 'Pub/sub', 'Replication', 'Idempotency', 'Sharding'] },
  { id: 'ticketmaster', name: 'Ticketmaster', short: 'Tickets', tier: 3, x: 1110, y: 212, needs: ['Locking and concurrency', 'Idempotency', 'Rate limiting', 'Message queues', 'Sagas'] },
  { id: 'uber', name: 'Uber', short: 'Uber', tier: 3, x: 985, y: 140, needs: ['Geospatial', 'Pub/sub', 'Sharding', 'Consensus', 'Autoscaling'] },
  { id: 'kafka', name: 'Kafka', short: 'Kafka', tier: 3, x: 700, y: 108, needs: ['Replication', 'Consensus', 'Sharding', 'CAP'] },
  { id: 'stripe', name: 'Stripe', short: 'Stripe', tier: 3, x: 530, y: 150, needs: ['Idempotency', 'Sagas', 'Circuit breakers', 'Consensus', 'Ledger design'] },
  { id: 'google-search', name: 'Google Search', short: 'Google', tier: 3, x: 640, y: 255, needs: ['Inverted index', 'Sharding', 'Caching', 'Bloom filters'] },
  { id: 'google-docs', name: 'Google Docs', short: 'Docs', tier: 3, x: 830, y: 232, needs: ['OT / CRDT', 'Real-time messaging', 'Consensus'] },
  { id: 'doc-qa', name: 'Document Q&A', short: 'Doc Q&A', tier: 4, x: 1245, y: 395, needs: ['Embeddings and vector search', 'Chunking and retrieval', 'Caching'] },
  { id: 'semantic-search', name: 'Semantic search', short: 'Vector', tier: 4, x: 1310, y: 465, needs: ['Embeddings and vector search', 'Sharding', 'Caching'] },
  { id: 'llm-gateway', name: 'LLM gateway', short: 'Gateway', tier: 4, x: 1475, y: 460, needs: ['Rate limiting', 'Semantic caching', 'Circuit breakers', 'Message queues', 'Cost and latency budgets'] },
  { id: 'support-agent', name: 'Support agent', short: 'Support', tier: 4, x: 1545, y: 395, needs: ['Agent loop and tools', 'Idempotency', 'Guardrails', 'Evals'] },
  { id: 'coding-assistant', name: 'Coding assistant', short: 'Coder', tier: 4, x: 1470, y: 300, needs: ['Chunking and retrieval', 'Agent loop and tools', 'Sandboxing', 'Streaming'] },
  { id: 'llm-serving', name: 'ChatGPT-style serving', short: 'Serving', tier: 4, x: 1400, y: 350, needs: ['LLM serving', 'Autoscaling', 'Message queues', 'Sharding', 'Streaming'] },
  { id: 'multi-agent', name: 'Multi-agent workflow', short: 'Agents', tier: 4, x: 1320, y: 290, needs: ['Agent loop and tools', 'Sagas', 'Message queues', 'Evals', 'Observability'] },
]

// A project's number: its place on the road, counted apart for the mainland (tiers 0-3) and the AI isles.
export const projectNumber = (p: Project) => PROJECTS.filter((q) => q.tier >= 4 === p.tier >= 4).indexOf(p) + 1

// Projects the learner can open today: the registry has a player for them.
export const isBuilt = (p: Project) => TOPICS.some((t) => t.id === p.id && t.Play)
