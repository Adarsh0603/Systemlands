import { Piece } from "../core/build/pieces";
import { project } from "../core/iso/geometry";
import type { PieceKind } from "../core/build/types";

// A card thumbnail: a few of the Build pieces standing on a small tile.
// u runs across the tile and v toward the viewer, in scene units.
type Spot = [kind: PieceKind, u: number, v: number];

const THUMBS: Record<string, Spot[]> = {
  "load-balancing": [["balancer", 0, -0.6], ["server", -1.2, 0.7], ["server", 1.2, 0.7]],
  caching: [["cache", -1, 0], ["database", 1.1, 0]],
  cdn: [["server", 0, -0.6], ["cache", -1.2, 0.7], ["cache", 1.2, 0.7]],
  autoscaling: [["autoscaler", 0, -0.6], ["server", -1.2, 0.7], ["server", 1.2, 0.7]],
  replication: [["database", -1, 0], ["replica", 1.1, 0]],
  sharding: [["database", 0, -0.6], ["database", -1.2, 0.7], ["database", 1.2, 0.7]],
  "consistent-hashing": [["ring", 0, 0]],
  cap: [["replica", -1.2, 0], ["replica", 1.2, 0]],
  queues: [["server", -1.3, 0], ["queue", 1.1, 0]],
  pubsub: [["topic", 0, -0.5], ["server", -1.2, 0.7], ["server", 1.2, 0.7]],
  "rate-limiting": [["limiter", 0, 0]],
  "circuit-breakers": [["breaker", -1, 0], ["app", 1.1, 0]],
  consensus: [["server", 0, -0.7], ["server", -1.2, 0.7], ["server", 1.2, 0.7]],
  idempotency: [["app", -1.1, 0], ["dedupe", 1.1, 0]],
  sagas: [["app", -1.4, 0.9], ["app", 0, 0], ["app", 1.4, -0.9]],
  "bloom-filters": [["dedupe", 0, 0]],
  "url-shortener": [["app", 0, 0]],
  notifications: [["queue", -1.1, 0], ["provider", 1.1, 0]],
  "web-crawler": [["app", -1.1, 0], ["stream", 1.1, 0]],
  "news-feed": [["database", 0, -0.6], ["queue", -1.2, 0.7], ["cache", 1.2, 0.7]],
  chat: [["app", -1.2, 0], ["topic", 0.2, 0], ["app", 1.4, 0]],
  "video-streaming": [["queue", -1.3, -0.6], ["cache", 1.2, 0.7], ["app", 0, 0]],
  "key-value-store": [["ring", -1.2, 0], ["database", 1, -0.8], ["database", 1, 0.8]],
  payments: [["app", -1.3, 0], ["dedupe", 0, 0], ["provider", 1.4, 0]],
  "ride-sharing": [["users", -1.3, 0.6], ["cache", 0.1, -0.6], ["app", 1.3, 0.5]],
  "twitter-timeline": [["cache", -1.2, 0.7], ["queue", 0.1, -0.7], ["database", 1.3, 0.5]],
  youtube: [["queue", -1.3, -0.6], ["cache", 0.1, 0.7], ["database", 1.3, -0.4]],
  dropbox: [["app", -1.3, -0.5], ["queue", 0.1, 0.7], ["database", 1.3, -0.4]],
  whatsapp: [["app", -1.3, -0.5], ["cache", 0.1, 0.7], ["database", 1.3, -0.4]],
  // Topics still to build.
  estimation: [["users", 0, 0]],
  "api-design": [["app", 0, 0]],
  authentication: [["app", -1.1, 0], ["database", 1.1, 0]],
  "data-modeling": [["database", 0, 0]],
  geospatial: [["users", -1.2, 0], ["cache", 1.1, 0]],
  "chunking-dedupe": [["database", -1.3, 0.5], ["database", 0, -0.6], ["database", 1.3, 0.5]],
  "blob-storage": [["database", -1.2, 0], ["database", 1.2, 0]],
  search: [["database", -1.1, 0], ["cache", 1.1, 0]],
  availability: [["balancer", 0, -0.6], ["server", -1.2, 0.7], ["replica", 1.2, 0.7]],
  "real-time": [["topic", 0, 0]],
  presence: [["app", -1.2, 0], ["users", 1.1, 0]],
  "adaptive-streaming": [["server", -1.2, 0], ["cache", 1.1, 0]],
  "fan-out": [["topic", 0, -0.6], ["queue", -1.2, 0.7], ["queue", 1.2, 0.7]],
  observability: [["stream", 0, 0]],
  consistency: [["replica", -1.2, 0], ["database", 1.2, 0]],
};

// The ink mixed toward the page, so a face reads in both themes.
const mix = (pct: number) => `color-mix(in srgb, var(--fg) ${pct}%, var(--bg))`;

const HALF = 1.9; // half the tile's side
const THICK = 0.3;

export default function Thumb({ id, muted = false }: { id: string; muted?: boolean }) {
  const spots = THUMBS[id] ?? [["server", 0, 0] as Spot];
  // Back to front: what is nearer the viewer paints over what is behind it.
  const ordered = [...spots].sort((a, b) => a[2] - b[2]);
  const corner = (x: number, z: number, y = 0) => project([x, y, z]).join(",");
  const [l, t, r, b] = [[-HALF, -HALF], [HALF, -HALF], [HALF, HALF], [-HALF, HALF]];
  const top = [l, t, r, b].map(([x, z]) => corner(x, z)).join(" ");
  const left = [l, b].map(([x, z]) => corner(x, z)).concat([b, l].map(([x, z]) => corner(x, z, -THICK))).join(" ");
  const right = [b, r].map(([x, z]) => corner(x, z)).concat([r, b].map(([x, z]) => corner(x, z, -THICK))).join(" ");
  return (
    <svg viewBox="-125 -150 250 230" aria-hidden className={`block h-full w-full ${muted ? "opacity-45" : ""}`}>
      <polygon points={left} style={{ fill: mix(12), stroke: mix(12) }} strokeWidth={0.8} />
      <polygon points={right} style={{ fill: mix(22), stroke: mix(22) }} strokeWidth={0.8} />
      <polygon points={top} style={{ fill: "var(--subtle)", stroke: "var(--line)" }} strokeWidth={1} strokeDasharray={muted ? "5 4" : undefined} strokeLinejoin="round" />
      {ordered.map(([kind, u, v], i) => (
        <Piece key={i} kind={kind} x={(u - v) / 2} z={(u + v) / 2} active={kind === "users" ? 6 : 0} />
      ))}
    </svg>
  );
}
