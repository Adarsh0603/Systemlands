import { useEffect, useState } from "react";
import { ConfirmHost } from "./core/ConfirmDialog";
import AccountButton from "./core/cloud/AccountButton";
import SignInDialog from "./core/cloud/SignInDialog";
import {
  recordSolved,
  recordStep,
  topicProgress,
  useProgress,
} from "./core/progress";
import { navigate, replaceRoute, useRoute } from "./core/router";
import Home from "./home/Home";
import WelcomeDialog from "./home/WelcomeDialog";
import WhatsNew from "./home/WhatsNew";
import CheatSheetPage from "./core/CheatSheetPage";
import TopicComplete from "./TopicComplete";
import { TOPICS, type TopicEntry } from "./topics/registry";

function useTheme() {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // Storage can be blocked; the toggle still works for this visit.
    }
  };
  return { dark, toggle };
}

export default function App() {
  const { dark, toggle } = useTheme();
  const route = useRoute();

  // Unknown or not-yet-built topics fall back to the home page.
  const topic =
    route.page === "topic"
      ? TOPICS.find((t) => t.id === route.topic && t.Play)
      : undefined;

  useEffect(() => {
    document.title = topic
      ? `${topic.title} · Systemlands`
      : "Systemlands · See why systems break at scale, then build ones that don't";
  }, [topic]);

  // Open every page at the top, not at the scroll position of the page before
  // (like a long topic list scrolled halfway down).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [topic?.id]);

  return (
    // svh, not vh: on phones vh is the height with the address bar hidden,
    // which made full-screen pages a little taller than the screen and let
    // them scroll the chapter menu under the header.
    <div className="min-h-svh">
      <header className="sticky top-0 z-30 h-[57px] border-b border-line bg-bg/70 backdrop-blur-md">
        <div className="flex h-full items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <a
              href="#/"
              className="flex shrink-0 items-center gap-2"
              aria-label="Systemlands home"
            >
              <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-6 w-6" />
              {/* On a phone the topic name needs the room, so the logo stands alone there. */}
              <span className={`font-semibold tracking-tight ${topic ? "hidden sm:inline" : ""}`}>
                Systemlands
              </span>
            </a>
            {topic && (
              <>
                <span className="text-line">/</span>
                <span className="truncate text-sm text-muted">
                  {topic.title}
                </span>
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <WhatsNew home={!topic} />
            <AccountButton />
            <button
              onClick={toggle}
              className="rounded-full border border-line px-3 py-1 font-mono text-xs text-muted transition hover:text-fg"
              aria-label="Toggle theme"
            >
              {dark ? "Light" : "Dark"}
            </button>
          </div>
        </div>
      </header>
      <SignInDialog />
      <ConfirmHost />
      <WelcomeDialog />
      {topic && route.page === "topic" ? (
        <TopicView topic={topic} chapter={route.chapter} step={route.step} />
      ) : (
        <Home />
      )}
    </div>
  );
}

function TopicView({
  topic,
  chapter,
  step,
}: {
  topic: TopicEntry;
  chapter: number;
  step: number;
}) {
  const Play = topic.Play!;
  // One past the last chapter is the interview cheat sheet.
  const count = topic.chapters?.length ?? 1;
  const ch = Math.min(chapter, topic.reference ? count : count - 1);
  const progress = useProgress();
  // Where "Finish" was pressed. The completion card shows only while we're
  // still there, so going on to the next topic (or back to a chapter) closes it.
  const here = `${topic.id}/${ch}/${step}`;
  const [finishedAt, setFinishedAt] = useState<string | null>(null);
  const finished = finishedAt === here;

  if (topic.reference && ch === count) {
    return (
      <CheatSheetPage
        topic={topic}
        doneChapters={topicProgress(progress, topic.id).done}
        onChapter={(i) =>
          navigate({ page: "topic", topic: topic.id, chapter: i, step: 0 })
        }
      />
    );
  }

  return (
    <>
      <Play
        key={`${topic.id}-${ch}-${step}`}
        topicId={topic.id}
        chapter={ch}
        step={step}
        doneChapters={topicProgress(progress, topic.id).done}
        onChapter={(i) =>
          navigate({ page: "topic", topic: topic.id, chapter: i, step: 0 })
        }
        onStep={(s, isLast) => {
          recordStep(topic.id, ch, s, isLast);
          replaceRoute({
            page: "topic",
            topic: topic.id,
            chapter: ch,
            step: s,
          });
        }}
        onSolved={(s) => recordSolved(topic.id, ch, s)}
        onFinish={() => setFinishedAt(here)}
        onCheatSheet={
          topic.reference
            ? () =>
                navigate({
                  page: "topic",
                  topic: topic.id,
                  chapter: count,
                  step: 0,
                })
            : undefined
        }
      />
      {finished && (
        <TopicComplete topic={topic} onClose={() => setFinishedAt(null)} />
      )}
    </>
  );
}
