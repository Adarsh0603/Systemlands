import { continueTarget, useProgress } from "../core/progress";
import { navigate } from "../core/router";
import { TOPICS } from "../topics/registry";
import { chapterCounts } from "./shared";

// "Continue · Load balancing →", shown once something is started. It opens
// the topic from its first chapter.
export function ContinueButton({ className = "" }: { className?: string }) {
  const progress = useProgress();
  const resume = continueTarget(progress, chapterCounts);
  const topic = resume && TOPICS.find((t) => t.id === resume.topic);
  if (!resume || !topic) return null;

  return (
    <button
      onClick={() =>
        navigate({
          page: "topic",
          topic: resume.topic,
          chapter: 0,
          step: 0,
        })
      }
      className={`flex w-full max-w-md items-center justify-between gap-4 rounded-2xl bg-fg px-5 py-4 text-left text-bg transition hover:opacity-90 ${className}`}
    >
      <span>
        <span className="block font-mono text-xs uppercase tracking-widest opacity-70">
          Continue
        </span>
        <span className="mt-0.5 block font-medium">{topic.title}</span>
      </span>
      <span aria-hidden>→</span>
    </button>
  );
}

export function Credit({ className = "" }: { className?: string }) {
  const link = "underline-offset-4 transition hover:text-fg hover:underline";
  return (
    <span className={className}>
      Created by{" "}
      <a
        href="https://www.linkedin.com/in/adarsh-verma-5b308322b/"
        target="_blank"
        rel="noreferrer"
        className={`text-fg ${link}`}
      >
        Adarsh Verma
      </a>
      <span className="mx-1.5" aria-hidden>
        ·
      </span>
      <a
        href="https://github.com/Adarsh0603/Systemlands"
        target="_blank"
        rel="noreferrer"
        className={link}
      >
        Source on GitHub
      </a>
    </span>
  );
}

const headingIcon = {
  width: 26,
  height: 26,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  className: "shrink-0",
};

// A folded map, before "The Realm of Systems".
export function MapIcon() {
  return (
    <svg {...headingIcon}>
      <path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20Z" />
      <path d="M9 4v13.5M15 6.5V20" />
    </svg>
  );
}

// Two crossed swords, before "The Arsenal".
export function SwordsIcon() {
  return (
    <svg {...headingIcon}>
      <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
      <path d="m13 19 6-6M16 16l4 4M19 21l2-2" />
      <path d="M14.5 6.5 18 3h3v3l-3.5 3.5" />
      <path d="m5 14 4 4M7 17l-3 3M3 19l2 2" />
    </svg>
  );
}
