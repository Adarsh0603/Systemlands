import type { ComponentType } from 'react'
import type { Level, Reference } from '../core/types'
import { CHAPTERS as ADAPTIVE_STREAMING_CHAPTERS } from './adaptive-streaming/chapters'
import AdaptiveStreamingPlay from './adaptive-streaming/Play'
import { REFERENCE as ADAPTIVE_STREAMING_REFERENCE } from './adaptive-streaming/reference'
import { CHAPTERS as AUTOSCALING_CHAPTERS } from './autoscaling/chapters'
import AutoscalingPlay from './autoscaling/Play'
import { REFERENCE as AUTOSCALING_REFERENCE } from './autoscaling/reference'
import { CHAPTERS as BLOOM_FILTERS_CHAPTERS } from './bloom-filters/chapters'
import BloomFiltersPlay from './bloom-filters/Play'
import { REFERENCE as BLOOM_FILTERS_REFERENCE } from './bloom-filters/reference'
import { CHAPTERS as CACHING_CHAPTERS } from './caching/chapters'
import CachingPlay from './caching/Play'
import { REFERENCE as CACHING_REFERENCE } from './caching/reference'
import { CHAPTERS as CAP_CHAPTERS } from './cap/chapters'
import CapPlay from './cap/Play'
import { REFERENCE as CAP_REFERENCE } from './cap/reference'
import { CHAPTERS as CIRCUIT_BREAKERS_CHAPTERS } from './circuit-breakers/chapters'
import CircuitBreakersPlay from './circuit-breakers/Play'
import { REFERENCE as CIRCUIT_BREAKERS_REFERENCE } from './circuit-breakers/reference'
import { CHAPTERS as CDN_CHAPTERS } from './cdn/chapters'
import CdnPlay from './cdn/Play'
import { REFERENCE as CDN_REFERENCE } from './cdn/reference'
import { CHAPTERS as CONSENSUS_CHAPTERS } from './consensus/chapters'
import ConsensusPlay from './consensus/Play'
import { REFERENCE as CONSENSUS_REFERENCE } from './consensus/reference'
import { CHAPTERS as CONSISTENT_HASHING_CHAPTERS } from './consistent-hashing/chapters'
import ConsistentHashingPlay from './consistent-hashing/Play'
import { REFERENCE as CONSISTENT_HASHING_REFERENCE } from './consistent-hashing/reference'
import { CHAPTERS as FAN_OUT_CHAPTERS } from './fan-out/chapters'
import FanOutPlay from './fan-out/Play'
import { REFERENCE as FAN_OUT_REFERENCE } from './fan-out/reference'
import { CHAPTERS as CHUNKING_DEDUPE_CHAPTERS } from './chunking-dedupe/chapters'
import ChunkingDedupePlay from './chunking-dedupe/Play'
import { REFERENCE as CHUNKING_DEDUPE_REFERENCE } from './chunking-dedupe/reference'
import { CHAPTERS as GEOSPATIAL_CHAPTERS } from './geospatial/chapters'
import GeospatialPlay from './geospatial/Play'
import { REFERENCE as GEOSPATIAL_REFERENCE } from './geospatial/reference'
import { CHAPTERS as IDEMPOTENCY_CHAPTERS } from './idempotency/chapters'
import IdempotencyPlay from './idempotency/Play'
import { REFERENCE as IDEMPOTENCY_REFERENCE } from './idempotency/reference'
import { CHAPTERS as LOAD_BALANCING_CHAPTERS } from './load-balancing/chapters'
import LoadBalancingPlay from './load-balancing/Play'
import { CHAPTERS as PUBSUB_CHAPTERS } from './pubsub/chapters'
import PubsubPlay from './pubsub/Play'
import { REFERENCE as PUBSUB_REFERENCE } from './pubsub/reference'
import { ADVANCED as LOAD_BALANCING_CARDS, INTERVIEW as LOAD_BALANCING_INTERVIEW } from './load-balancing/reference'
import { CHAPTERS as PRESENCE_CHAPTERS } from './presence/chapters'
import PresencePlay from './presence/Play'
import { REFERENCE as PRESENCE_REFERENCE } from './presence/reference'
import { CHAPTERS as REAL_TIME_CHAPTERS } from './real-time/chapters'
import RealTimePlay from './real-time/Play'
import { REFERENCE as REAL_TIME_REFERENCE } from './real-time/reference'
import { CHAPTERS as RATE_LIMITING_CHAPTERS } from './rate-limiting/chapters'
import RateLimitingPlay from './rate-limiting/Play'
import { REFERENCE as RATE_LIMITING_REFERENCE } from './rate-limiting/reference'
import { CHAPTERS as QUEUES_CHAPTERS } from './queues/chapters'
import QueuesPlay from './queues/Play'
import { REFERENCE as QUEUES_REFERENCE } from './queues/reference'
import { CHAPTERS as REPLICATION_CHAPTERS } from './replication/chapters'
import ReplicationPlay from './replication/Play'
import { REFERENCE as REPLICATION_REFERENCE } from './replication/reference'
import { CHAPTERS as TRANSACTIONS_CHAPTERS } from './transactions/chapters'
import TransactionsPlay from './transactions/Play'
import { REFERENCE as TRANSACTIONS_REFERENCE } from './transactions/reference'
import NotificationsPlay from './notifications/Play'
import { NOTIFICATIONS } from './notifications/build'
import { REFERENCE as NOTIFICATIONS_REFERENCE } from './notifications/reference'
import NewsFeedPlay from './news-feed/Play'
import { NEWS_FEED } from './news-feed/build'
import { REFERENCE as NEWS_FEED_REFERENCE } from './news-feed/reference'
import ChatPlay from './chat/Play'
import { CHAT } from './chat/build'
import { REFERENCE as CHAT_REFERENCE } from './chat/reference'
import VideoStreamingPlay from './video-streaming/Play'
import { VIDEO_STREAMING } from './video-streaming/build'
import { REFERENCE as VIDEO_STREAMING_REFERENCE } from './video-streaming/reference'
import KeyValueStorePlay from './key-value-store/Play'
import { KEY_VALUE_STORE } from './key-value-store/build'
import { REFERENCE as KEY_VALUE_STORE_REFERENCE } from './key-value-store/reference'
import RideSharingPlay from './ride-sharing/Play'
import { RIDE_SHARING } from './ride-sharing/build'
import { REFERENCE as RIDE_SHARING_REFERENCE } from './ride-sharing/reference'
import DropboxPlay from './dropbox/Play'
import { DROPBOX } from './dropbox/build'
import WhatsappPlay from './whatsapp/Play'
import { WHATSAPP } from './whatsapp/build'
import { REFERENCE as WHATSAPP_REFERENCE } from './whatsapp/reference'
import { REFERENCE as DROPBOX_REFERENCE } from './dropbox/reference'
import YoutubePlay from './youtube/Play'
import { YOUTUBE } from './youtube/build'
import { REFERENCE as YOUTUBE_REFERENCE } from './youtube/reference'
import TwitterTimelinePlay from './twitter-timeline/Play'
import { TWITTER_TIMELINE } from './twitter-timeline/build'
import { REFERENCE as TWITTER_TIMELINE_REFERENCE } from './twitter-timeline/reference'
import PaymentsPlay from './payments/Play'
import { PAYMENTS } from './payments/build'
import { REFERENCE as PAYMENTS_REFERENCE } from './payments/reference'
import WebCrawlerPlay from './web-crawler/Play'
import { WEB_CRAWLER } from './web-crawler/build'
import { REFERENCE as WEB_CRAWLER_REFERENCE } from './web-crawler/reference'
import UrlShortenerPlay from './url-shortener/Play'
import { URL_SHORTENER } from './url-shortener/build'
import { REFERENCE as URL_SHORTENER_REFERENCE } from './url-shortener/reference'
import { CHAPTERS as SHARDING_CHAPTERS } from './sharding/chapters'
import ShardingPlay from './sharding/Play'
import { REFERENCE as SHARDING_REFERENCE } from './sharding/reference'

// Every concept Systemlands teaches, in the recommended order. A topic with no
// `Play` yet isn't built and shows as "Soon".

export type TrackId = 'scaling' | 'data' | 'async' | 'distributed' | 'capstones'

export const TRACKS: { id: TrackId; title: string; level: Level }[] = [
  { id: 'scaling', title: 'Scaling basics', level: 'Beginner' },
  { id: 'data', title: 'Data', level: 'Intermediate' },
  { id: 'async', title: 'Async & reliability', level: 'Intermediate' },
  { id: 'distributed', title: 'Distributed systems', level: 'Advanced' },
  { id: 'capstones', title: 'Design a real system', level: 'Advanced' },
]

export interface PlayProps {
  topicId: string
  chapter: number
  step: number
  doneChapters: number[]
  onChapter: (index: number) => void
  onStep: (step: number, isLastStep: boolean) => void
  onSolved: (step: number) => void
  onFinish: () => void
  // Opens the interview cheat sheet, when the topic has one.
  onCheatSheet?: () => void
}

export interface TopicEntry {
  id: string
  title: string
  short?: string // a shorter name for tight spots, like the map
  track: TrackId
  pitch: string
  chapters?: string[]
  challenges?: string[] // "chapter:step" of every practice challenge
  Play?: ComponentType<PlayProps>
  // Interview notes, opened from the chapter menu after the last chapter.
  reference?: Reference
}

// Every practice challenge, including a "Build it" chapter's goal.
const challengeIds = (chapters: { build?: unknown; beats: { challenge?: unknown }[] }[]) =>
  chapters.flatMap((c, ci) => (c.build ? [`${ci}:0`] : c.beats.flatMap((b, bi) => (b.challenge ? [`${ci}:${bi}`] : []))))

export const TOPICS: TopicEntry[] = [
  {
    id: 'load-balancing',
    title: 'Load balancing',
    track: 'scaling',
    pitch: 'Spread traffic across servers, and survive when they fail.',
    chapters: LOAD_BALANCING_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(LOAD_BALANCING_CHAPTERS),
    Play: LoadBalancingPlay,
    reference: { interview: LOAD_BALANCING_INTERVIEW, cards: LOAD_BALANCING_CARDS },
  },
  {
    id: 'caching',
    title: 'Caching',
    track: 'scaling',
    pitch: 'Stop the database drowning by remembering answers.',
    chapters: CACHING_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(CACHING_CHAPTERS),
    Play: CachingPlay,
    reference: CACHING_REFERENCE,
  },
  {
    id: 'cdn',
    title: 'CDN',
    track: 'scaling',
    pitch: 'Serve users from a box near them, not across the world.',
    chapters: CDN_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(CDN_CHAPTERS),
    Play: CdnPlay,
    reference: CDN_REFERENCE,
  },
  {
    id: 'autoscaling',
    title: 'Autoscaling',
    track: 'scaling',
    pitch: 'Add and remove servers as traffic rises and falls.',
    chapters: AUTOSCALING_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(AUTOSCALING_CHAPTERS),
    Play: AutoscalingPlay,
    reference: AUTOSCALING_REFERENCE,
  },

  {
    id: 'replication',
    title: 'Database replication',
    short: 'Replication',
    track: 'data',
    pitch: 'Copy data to replicas for reads, and live with lag.',
    chapters: REPLICATION_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(REPLICATION_CHAPTERS),
    Play: ReplicationPlay,
    reference: REPLICATION_REFERENCE,
  },
  {
    id: 'sharding',
    title: 'Sharding',
    track: 'data',
    pitch: 'Split one database into many by key.',
    chapters: SHARDING_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(SHARDING_CHAPTERS),
    Play: ShardingPlay,
    reference: SHARDING_REFERENCE,
  },
  {
    id: 'consistent-hashing',
    title: 'Consistent hashing',
    track: 'data',
    pitch: 'Add a node without reshuffling every key.',
    chapters: CONSISTENT_HASHING_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(CONSISTENT_HASHING_CHAPTERS),
    Play: ConsistentHashingPlay,
    reference: CONSISTENT_HASHING_REFERENCE,
  },
  {
    id: 'cap',
    title: 'CAP & consistency',
    track: 'data',
    pitch: 'When the network splits, choose: correct or available.',
    chapters: CAP_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(CAP_CHAPTERS),
    Play: CapPlay,
    reference: CAP_REFERENCE,
  },
  {
    id: 'geospatial',
    title: 'Geospatial indexing',
    short: 'Geospatial',
    track: 'data',
    pitch: 'Find what is near a point, fast.',
    chapters: GEOSPATIAL_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(GEOSPATIAL_CHAPTERS),
    Play: GeospatialPlay,
    reference: GEOSPATIAL_REFERENCE,
  },
  {
    id: 'chunking-dedupe',
    title: 'Chunking and dedupe',
    short: 'Chunking',
    track: 'data',
    pitch: 'Send only what changed, and store each piece once.',
    chapters: CHUNKING_DEDUPE_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(CHUNKING_DEDUPE_CHAPTERS),
    Play: ChunkingDedupePlay,
    reference: CHUNKING_DEDUPE_REFERENCE,
  },

  {
    id: 'queues',
    title: 'Message queues',
    track: 'async',
    pitch: 'Absorb bursts and do slow work in the background.',
    chapters: QUEUES_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(QUEUES_CHAPTERS),
    Play: QueuesPlay,
    reference: QUEUES_REFERENCE,
  },
  {
    id: 'pubsub',
    title: 'Pub/sub & streams',
    short: 'Pub/sub',
    track: 'async',
    pitch: 'One event, many listeners, in order.',
    chapters: PUBSUB_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(PUBSUB_CHAPTERS),
    Play: PubsubPlay,
    reference: PUBSUB_REFERENCE,
  },
  {
    id: 'rate-limiting',
    title: 'Rate limiting',
    track: 'async',
    pitch: 'Protect everyone from one noisy client.',
    chapters: RATE_LIMITING_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(RATE_LIMITING_CHAPTERS),
    Play: RateLimitingPlay,
    reference: RATE_LIMITING_REFERENCE,
  },
  {
    id: 'circuit-breakers',
    title: 'Timeouts, retries & circuit breakers',
    short: 'Circuit breakers',
    track: 'async',
    pitch: 'Stop one slow dependency taking the site down.',
    chapters: CIRCUIT_BREAKERS_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(CIRCUIT_BREAKERS_CHAPTERS),
    Play: CircuitBreakersPlay,
    reference: CIRCUIT_BREAKERS_REFERENCE,
  },
  {
    id: 'fan-out',
    title: 'Fan-out',
    track: 'async',
    pitch: 'Write once, deliver to millions of followers.',
    chapters: FAN_OUT_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(FAN_OUT_CHAPTERS),
    Play: FanOutPlay,
    reference: FAN_OUT_REFERENCE,
  },
  {
    id: 'real-time',
    title: 'Real-time messaging',
    short: 'Real-time',
    track: 'async',
    pitch: 'Push updates over WebSockets, polling or SSE.',
    chapters: REAL_TIME_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(REAL_TIME_CHAPTERS),
    Play: RealTimePlay,
    reference: REAL_TIME_REFERENCE,
  },
  {
    id: 'presence',
    title: 'Presence',
    short: 'Presence',
    track: 'async',
    pitch: 'Show who is online without flooding the server.',
    chapters: PRESENCE_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(PRESENCE_CHAPTERS),
    Play: PresencePlay,
    reference: PRESENCE_REFERENCE,
  },
  {
    id: 'adaptive-streaming',
    title: 'Adaptive streaming',
    short: 'Streaming',
    track: 'async',
    pitch: 'Play video on any connection, without the spinner.',
    chapters: ADAPTIVE_STREAMING_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(ADAPTIVE_STREAMING_CHAPTERS),
    Play: AdaptiveStreamingPlay,
    reference: ADAPTIVE_STREAMING_REFERENCE,
  },

  {
    id: 'consensus',
    title: 'Leader election & consensus',
    short: 'Consensus',
    track: 'distributed',
    pitch: 'Agree on one leader, even when nodes die.',
    chapters: CONSENSUS_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(CONSENSUS_CHAPTERS),
    Play: ConsensusPlay,
    reference: CONSENSUS_REFERENCE,
  },
  {
    id: 'idempotency',
    title: 'Idempotency & exactly-once',
    short: 'Idempotency',
    track: 'distributed',
    pitch: 'Retry safely without charging twice.',
    chapters: IDEMPOTENCY_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(IDEMPOTENCY_CHAPTERS),
    Play: IdempotencyPlay,
    reference: IDEMPOTENCY_REFERENCE,
  },
  {
    id: 'sagas',
    title: 'Distributed transactions',
    short: 'Transactions',
    track: 'distributed',
    pitch: 'Finish or cleanly undo work across services.',
    chapters: TRANSACTIONS_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(TRANSACTIONS_CHAPTERS),
    Play: TransactionsPlay,
    reference: TRANSACTIONS_REFERENCE,
  },
  {
    id: 'bloom-filters',
    title: 'Bloom filters',
    track: 'distributed',
    pitch: 'Answer “have I seen this?” in a few bits.',
    chapters: BLOOM_FILTERS_CHAPTERS.map((c) => c.title),
    challenges: challengeIds(BLOOM_FILTERS_CHAPTERS),
    Play: BloomFiltersPlay,
    reference: BLOOM_FILTERS_REFERENCE,
  },

  {
    id: 'url-shortener',
    title: 'URL shortener',
    track: 'capstones',
    pitch: 'Billions of redirects, mostly reads.',
    chapters: [...URL_SHORTENER.stages],
    challenges: ['0:0', '1:0', '2:0'],
    Play: UrlShortenerPlay,
    reference: URL_SHORTENER_REFERENCE,
  },
  {
    id: 'notifications',
    title: 'Notification system',
    track: 'capstones',
    pitch: 'Millions of messages, none lost, none twice.',
    chapters: [...NOTIFICATIONS.stages],
    challenges: ['0:0', '1:0', '2:0'],
    Play: NotificationsPlay,
    reference: NOTIFICATIONS_REFERENCE,
  },
  {
    id: 'web-crawler',
    title: 'Web crawler',
    track: 'capstones',
    pitch: 'Read a billion pages without being banned.',
    chapters: [...WEB_CRAWLER.stages],
    challenges: ['0:0', '1:0', '2:0'],
    Play: WebCrawlerPlay,
    reference: WEB_CRAWLER_REFERENCE,
  },
  {
    id: 'news-feed',
    title: 'Social feed',
    track: 'capstones',
    pitch: 'Fan out posts to millions of followers.',
    chapters: [...NEWS_FEED.stages],
    challenges: ['0:0', '1:0', '2:0'],
    Play: NewsFeedPlay,
    reference: NEWS_FEED_REFERENCE,
  },
  {
    id: 'chat',
    title: 'Chat app',
    track: 'capstones',
    pitch: 'Real-time messages to millions of phones.',
    chapters: [...CHAT.stages],
    challenges: ['0:0', '1:0', '2:0'],
    Play: ChatPlay,
    reference: CHAT_REFERENCE,
  },
  {
    id: 'video-streaming',
    title: 'Video streaming',
    track: 'capstones',
    pitch: 'Upload, transcode, and stream worldwide.',
    chapters: [...VIDEO_STREAMING.stages],
    challenges: ['0:0', '1:0', '2:0'],
    Play: VideoStreamingPlay,
    reference: VIDEO_STREAMING_REFERENCE,
  },
  {
    id: 'key-value-store',
    title: 'Key-value store',
    track: 'capstones',
    pitch: 'Find any key fast, even as machines fail.',
    chapters: [...KEY_VALUE_STORE.stages],
    challenges: ['0:0', '1:0', '2:0'],
    Play: KeyValueStorePlay,
    reference: KEY_VALUE_STORE_REFERENCE,
  },
  {
    id: 'payments',
    title: 'Payments',
    track: 'capstones',
    pitch: 'Charge once, even when everything fails.',
    chapters: [...PAYMENTS.stages],
    challenges: ['0:0', '1:0', '2:0'],
    Play: PaymentsPlay,
    reference: PAYMENTS_REFERENCE,
  },
  {
    id: 'ride-sharing',
    title: 'Ride sharing',
    track: 'capstones',
    pitch: 'Match riders and drivers by location, live.',
    chapters: [...RIDE_SHARING.stages],
    challenges: ['0:0', '1:0', '2:0'],
    Play: RideSharingPlay,
    reference: RIDE_SHARING_REFERENCE,
  },
  {
    id: 'twitter-timeline',
    title: 'Twitter timeline',
    track: 'capstones',
    pitch: 'Show every follower the latest tweets, even after a delete.',
    chapters: [...TWITTER_TIMELINE.stages],
    challenges: ['0:0', '1:0', '2:0'],
    Play: TwitterTimelinePlay,
    reference: TWITTER_TIMELINE_REFERENCE,
  },
  {
    id: 'youtube',
    title: 'YouTube',
    track: 'capstones',
    pitch: 'Upload, transcode and stream to a billion hours a day.',
    chapters: [...YOUTUBE.stages],
    challenges: ['0:0', '1:0', '2:0'],
    Play: YoutubePlay,
    reference: YOUTUBE_REFERENCE,
  },
  {
    id: 'dropbox',
    title: 'Dropbox',
    track: 'capstones',
    pitch: 'Sync every file to every device, sending only what changed.',
    chapters: [...DROPBOX.stages],
    challenges: ['0:0', '1:0', '2:0'],
    Play: DropboxPlay,
    reference: DROPBOX_REFERENCE,
  },
  {
    id: 'whatsapp',
    title: 'WhatsApp',
    track: 'capstones',
    pitch: 'Deliver a hundred billion messages a day, even to phones that are off.',
    chapters: [...WHATSAPP.stages],
    challenges: ['0:0', '1:0', '2:0'],
    Play: WhatsappPlay,
    reference: WHATSAPP_REFERENCE,
  },
]

// Topics still to build, shown in the list under their track. They are not in
// TOPICS: the map has a fixed number of spots per district.
export interface PlannedTopic {
  id: string
  title: string
  track: TrackId
  pitch: string
}

export const PLANNED: PlannedTopic[] = [
  { id: 'estimation', title: 'Back-of-envelope estimation', track: 'scaling', pitch: 'Turn users into requests, storage and bandwidth.' },
  { id: 'api-design', title: 'API design', track: 'scaling', pitch: 'Pagination, versioning and safe retries.' },
  { id: 'authentication', title: 'Authentication', track: 'scaling', pitch: 'Sessions, tokens and who may do what.' },
  { id: 'data-modeling', title: 'Data modeling', track: 'data', pitch: 'Pick the right database for the access pattern.' },
  { id: 'blob-storage', title: 'Blob storage', track: 'data', pitch: 'Keep big files cheaply and serve them fast.' },
  { id: 'search', title: 'Search', track: 'data', pitch: 'Find text across millions of documents.' },
  { id: 'availability', title: 'Availability & failover', track: 'async', pitch: 'Stay up when machines and regions fail.' },
  { id: 'observability', title: 'Observability', track: 'async', pitch: 'Metrics, logs and traces to see what broke.' },
  { id: 'consistency', title: 'Consistency models', track: 'distributed', pitch: 'Strong, eventual and causal: what readers see.' },
]
