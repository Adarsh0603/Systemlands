import { useState } from "react";
import { askConfirm } from "../core/ConfirmDialog";
import { openSignIn, useSession } from "../core/cloud/session";
import { clearAllBuilds } from "../core/build/saved";
import { resetProgress, useProgress } from "../core/progress";
import { resetTips } from "../core/tips";
import { PLANNED, TOPICS, TRACKS, type TopicEntry } from "../topics/registry";
import { Credit, SwordsIcon } from "./parts";
import Thumb from "./thumbs";
import {
  actionLabel,
  nextTopic,
  openTopic,
  statusOf,
  topicNumber,
} from "./shared";

// The page header's height: the search bar sticks right under it.
const BAR_TOP = 57;

const has = (text: string, q: string) => text.toLowerCase().includes(q);

// The chapters of a topic that the search words land in.
const chapterHits = (t: TopicEntry, q: string) =>
  q ? (t.chapters ?? []).filter((c) => has(c, q)) : [];

const matches = (t: { title: string; pitch: string; chapters?: string[] }, q: string) =>
  !q || has(t.title, q) || has(t.pitch, q) || (t.chapters ?? []).some((c) => has(c, q));

// Every concept, by track. Open any of them whenever you like.
export default function Toolbox() {
  const progress = useProgress();
  const next = nextTopic(progress);
  const { user } = useSession();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const tracks = TRACKS.filter((track) => track.id !== "capstones")
    .map((track) => ({
      track,
      topics: TOPICS.filter((t) => t.track === track.id && matches(t, q)),
      planned: PLANNED.filter((t) => t.track === track.id && matches(t, q)),
    }))
    .filter((g) => g.topics.length + g.planned.length > 0);

  return (
    <div className="mt-14">
      <div className="max-w-[2200px] pt-10  sm:pt-14 ">
        <div className="font-mono text-xs uppercase tracking-widest text-muted">
          MASTER ANY TACTIC
        </div>
        <h1 className="mt-3 font-mono text-[24px]">
          <b className="flex items-center gap-2.5">
            <SwordsIcon />
            The Arsenal
          </b>
          <span className="block text-lg leading-snug tracking-tighter text-muted">
            From single server to distributed consensus, learn the tactics that
            make systems work at scale
          </span>
        </h1>
      </div>

      {/* Stays under the page header while the tracks scroll past: search topics and their chapters. */}
      <div
        className="sticky z-20 -mx-6 mt-6 border-b border-line bg-bg/90 px-6 py-2 backdrop-blur-md sm:-mx-10 sm:px-10 lg:-mx-16 lg:px-16"
        style={{ top: BAR_TOP }}
      >
        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-3">
          <div className="relative w-full sm:w-72 sm:shrink-0">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              placeholder="Search topics and chapters"
              aria-label="Search topics and chapters"
              className="w-full rounded-full border border-line bg-bg px-4 py-1.5 text-sm outline-none transition focus:border-fg [&::-webkit-search-cancel-button]:appearance-none"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-2 font-mono text-xs text-muted transition hover:text-fg"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {q && tracks.length === 0 && (
        <p className="mt-12 text-center text-sm text-muted">
          Nothing matches “{query.trim()}”. Try another word.
        </p>
      )}

      {/* The projects live on the map, so their track is left out here. */}
      {tracks.map(({ track, topics, planned }) => {
        return (
          <section
            key={track.id}
            className="mt-12"
          >
            <div className="mb-4 flex items-baseline gap-3">
              <h2 className="text-lg font-semibold tracking-tight">
                {track.title}
              </h2>
              <span className="rounded-full border border-line bg-bg px-2 py-0.5 font-mono text-xs uppercase tracking-widest text-muted">
                {track.level}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {topics.map((t) => (
                <TopicCard
                  key={t.id}
                  topic={t}
                  isNext={t === next}
                  hits={chapterHits(t, q)}
                  onOpen={() => openTopic(t)}
                />
              ))}
              {planned.map((t) => (
                <div
                  key={t.id}
                  className="flex gap-3 rounded-2xl border border-dashed border-line bg-bg p-4"
                >
                  <div className="h-20 w-20 shrink-0 sm:h-24 sm:w-24">
                    <Thumb id={t.id} muted />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between font-mono text-xs text-muted">
                      <span>Planned</span>
                      <span className="rounded-full border border-line px-2 py-0.5 text-xs uppercase tracking-widest">
                        Soon
                      </span>
                    </div>
                    <h3 className="mt-2 font-medium text-muted">{t.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted">
                      {t.pitch}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <footer className="mt-16 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-xs text-muted">
        <Credit />
        <span className="flex flex-wrap items-center gap-3">
          {user ? (
            <span>Progress is saved to your account.</span>
          ) : (
            <span>
              Progress is saved in this browser only.{" "}
              <button
                onClick={openSignIn}
                className="font-mono underline underline-offset-4 transition hover:text-fg"
              >
                Sign in to sync across devices
              </button>
            </span>
          )}
          {Object.keys(progress).length > 0 && (
            <button
              onClick={async () => {
                const ok = await askConfirm({
                  title: "Reset all progress?",
                  body: user
                    ? "You are signed in, so the progress saved in your account will be reset too. This can’t be undone."
                    : "This can’t be undone.",
                  confirm: "Reset progress",
                });
                if (ok) {
                  resetProgress();
                  resetTips();
                  clearAllBuilds();
                }
              }}
              className="font-mono underline-offset-4 transition hover:text-fg hover:underline"
            >
              Reset progress
            </button>
          )}
        </span>
      </footer>
    </div>
  );
}

function TopicCard({
  topic,
  isNext,
  hits,
  onOpen,
}: {
  topic: TopicEntry;
  isNext: boolean;
  hits: string[];
  onOpen: () => void;
}) {
  const progress = useProgress();
  const status = statusOf(progress, topic);
  const label = topicNumber(topic);

  if (status === "soon" || !topic.chapters) {
    return (
      <div className="flex gap-3 rounded-2xl border border-dashed border-line bg-bg p-4">
        <div className="h-20 w-20 shrink-0 sm:h-24 sm:w-24">
          <Thumb id={topic.id} muted />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between font-mono text-xs text-muted">
            <span>{label}</span>
            <span className="rounded-full border border-line px-2 py-0.5 text-xs uppercase tracking-widest">
              Soon
            </span>
          </div>
          <h3 className="mt-2 font-medium text-muted">{topic.title}</h3>
          <p className="mt-1 text-sm leading-6 text-muted">{topic.pitch}</p>
        </div>
      </div>
    );
  }

  // Rows inside a <button> don't stretch to its width on their own, so each
  // row is made full width explicitly.
  return (
    <button
      onClick={onOpen}
      className={`group flex gap-3 rounded-2xl border cursor-pointer bg-bg p-4 text-left transition hover:border-fg ${
        isNext ? "border-fg" : "border-line"
      }`}
    >
      <div className="h-20 w-20 shrink-0 sm:h-24 sm:w-24">
        <Thumb id={topic.id} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex w-full items-center justify-between font-mono text-xs text-muted">
          <span>{label}</span>
          {status === "done" ? (
            <span className="rounded-full bg-fg px-2 py-0.5 text-xs uppercase tracking-widest text-bg">
              ✓ Completed
            </span>
          ) : isNext ? (
            <span className="rounded-full bg-fg px-2 py-0.5 text-xs uppercase tracking-widest text-bg">
              Next
            </span>
          ) : status === "started" ? (
            <span className="rounded-full border border-fg px-2 py-0.5 text-xs uppercase tracking-widest text-fg">
              In progress
            </span>
          ) : null}
        </div>
        <h3 className="mt-2 font-medium">{topic.title}</h3>
        <p className="mt-1 flex-1 text-sm leading-6 text-muted">
          {topic.pitch}
        </p>
        {hits.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {hits.map((c) => (
              <span
                key={c}
                className="rounded-full border border-line px-2 py-0.5 font-mono text-xs"
              >
                {c}
              </span>
            ))}
          </div>
        )}

        <div className="mt-3 w-full text-right font-mono text-xs text-muted transition group-hover:text-fg">
          {actionLabel(status)} →
        </div>
      </div>
    </button>
  );
}
