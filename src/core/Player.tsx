import { useEffect, useRef, useState } from "react";
import BuildPlayer from "./build/BuildPlayer";
import { shotAt, stateAt } from "./chapters";
import { CHEAT_SHEET, TopBar } from "./chrome";
import { play } from "./sound";
import { useBottomInset } from "./useBottomInset";
import { COMPACT, PHONE, SHORT, useMedia } from "./useMedia";
import type { BaseBeat, Marker, TopicSpec } from "./types";

interface PlayerProps<S, Sim, M, B extends BaseBeat<S, Sim, M>> {
  topic: TopicSpec<S, Sim, M, B>;
  // The topic's registry id: where its Build it chapters are saved.
  topicId: string;
  index: number;
  startStep?: number;
  doneChapters?: number[];
  onChapter: (index: number) => void;
  onCheatSheet?: () => void;
  onStep?: (step: number, isLastStep: boolean) => void;
  onSolved?: (step: number) => void;
  onFinish?: () => void;
}

// Plays one chapter of any topic: a guided lesson, or a "Build it" chapter
// where the learner assembles the system. Remounted per chapter (keyed by the
// caller), so each chapter starts fresh.
export default function Player<S, Sim, M, B extends BaseBeat<S, Sim, M>>(
  props: PlayerProps<S, Sim, M, B>,
) {
  const { topic, index, doneChapters = [] } = props;
  const build = topic.chapters[index].build;
  if (build) {
    return (
      <BuildPlayer
        task={build}
        saveKey={`${props.topicId}:${index}`}
        chapters={topic.chapters}
        index={index}
        doneChapters={doneChapters}
        onChapter={props.onChapter}
        onCheatSheet={props.onCheatSheet}
        onStep={props.onStep}
        onSolved={props.onSolved}
        onFinish={props.onFinish}
      />
    );
  }
  return <LessonPlayer {...props} />;
}

// A guided lesson: the scene, captions, live stats, controls, predictions,
// practice challenges, sound and navigation.
function LessonPlayer<S, Sim, M, B extends BaseBeat<S, Sim, M>>({
  topic,
  index,
  startStep = 0,
  doneChapters = [],
  onChapter,
  onCheatSheet,
  onStep,
  onSolved,
  onFinish,
}: PlayerProps<S, Sim, M, B>) {
  const chapters = topic.chapters;
  const chapter = chapters[index];
  const first = Math.min(Math.max(0, startStep), chapter.beats.length - 1);
  const firstAsks = !!chapter.beats[first].predict;
  const [beatIdx, setBeatIdx] = useState(first);
  // A beat with a prediction shows its setup frozen until the learner taps
  // an answer in the scene (or skips); then it plays.
  const [asking, setAsking] = useState(firstAsks);
  const [guess, setGuess] = useState<number | null>(null);
  const [st, setSt] = useState(() => stateAt(chapter, first));
  const [ramping, setRamping] = useState(
    !firstAsks && !!chapter.beats[first].ramp,
  );
  const [shake, setShake] = useState(0);
  const [solvedBeat, setSolvedBeat] = useState(-1);
  // Small screens get a sideways-scrolling stats row; short ones (a phone on
  // its side) also get tighter spacing and smaller text.
  const compact = useMedia(COMPACT);
  const short = useMedia(SHORT);

  const stRef = useRef(st);
  stRef.current = st;
  const runtime = topic.useRuntime(stRef, asking);
  const { sim, metrics, tick } = runtime;
  const { sync, feedback, dropCount } = topic;

  const beat = chapter.beats[beatIdx];
  const challenge = beat.challenge;
  const solved = solvedBeat === beatIdx;
  const lastBeat = beatIdx === chapter.beats.length - 1;
  const lastChapter = index === chapters.length - 1;

  const holdStart = useRef<number | null>(null);

  const go = (i: number) => {
    if (i >= chapter.beats.length)
      return onChapter(Math.min(index + 1, chapters.length - 1));
    if (i < 0) return onChapter(Math.max(index - 1, 0));
    const asks = !!chapter.beats[i].predict;
    setBeatIdx(i);
    setAsking(asks);
    setGuess(null);
    setSt(stateAt(chapter, i));
    setRamping(!asks && !!chapter.beats[i].ramp);
    holdStart.current = null;
  };

  // The learner tapped an answer, or skipped (null): play the beat.
  const answer = (choice: number | null) => {
    if (choice !== null)
      play(choice === beat.predict?.answer ? "right" : "wrong");
    setGuess(choice);
    setAsking(false);
    setRamping(!!beat.ramp);
  };

  useEffect(() => {
    sync(sim, st);
  }, [sync, sim, st]);

  // Report each step reached, for saved progress and the address bar. Kept in
  // a ref so a new callback each render doesn't re-report the same step.
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;
  const stepCount = chapter.beats.length;
  useEffect(() => {
    onStepRef.current?.(beatIdx, beatIdx === stepCount - 1);
  }, [beatIdx, stepCount]);

  // Shake and sound when something breaks; a rising tone when something arrives.
  const prev = useRef(st);
  useEffect(() => {
    const p = prev.current;
    prev.current = st;
    const f = feedback(p, st);
    if (f.crash) {
      setShake((k) => k + 1);
      play("crash");
    }
    if (f.rise) play("rise");
  }, [feedback, st]);

  // Beats that change state on a timer, e.g. traffic climbing.
  const ramp = beat.ramp;
  useEffect(() => {
    if (!ramping || !ramp) return;
    if (!ramp.next(st)) {
      setRamping(false);
      return;
    }
    const id = setTimeout(() => setSt((p) => ramp.next(p) ?? p), ramp.everyMs);
    return () => clearTimeout(id);
  }, [ramping, ramp, st]);

  // Runs after every tick: drop sounds, and checking the challenge goal is
  // held long enough.
  const lastDrops = useRef(0);
  const lastDropSound = useRef(0);
  const onSolvedRef = useRef(onSolved);
  onSolvedRef.current = onSolved;
  useEffect(() => {
    const now = performance.now();
    const drops = dropCount(sim);
    if (drops > lastDrops.current && now - lastDropSound.current > 220) {
      play("drop");
      lastDropSound.current = now;
    }
    lastDrops.current = drops;

    if (!challenge || solved || asking || tick === 0) return;
    if (challenge.check({ m: metrics, st, sim })) {
      holdStart.current ??= now;
      if (now - holdStart.current >= challenge.holdSeconds * 1000) {
        setSolvedBeat(beatIdx);
        onSolvedRef.current?.(beatIdx);
        play("success");
      }
    } else {
      holdStart.current = null;
    }
  }, [dropCount, sim, tick, challenge, solved, asking, st, beatIdx, metrics]);

  const holdProgress =
    challenge && holdStart.current !== null
      ? Math.min(
          1,
          (performance.now() - holdStart.current) /
            (challenge.holdSeconds * 1000),
        )
      : 0;

  const parts = challenge?.parts?.({ m: metrics, st, sim });

  const barProgress = challenge?.progress
    ? Math.min(1, Math.max(0, challenge.progress({ m: metrics, st, sim })))
    : holdProgress;

  // A question's options are tap targets in the scene. Once answered, the
  // right one stays marked for the rest of the beat.
  const predict = beat.predict;
  const markers: Marker[] = !predict
    ? []
    : asking
      ? predict.options.map((o, i) => ({
          at: o.at,
          label: o.label,
          tone: "ask" as const,
          onPick: () => answer(i),
        }))
      : guess !== null
        ? [
            {
              at: predict.options[predict.answer].at,
              label: guess === predict.answer ? "✓ Correct" : "✓ This one",
              tone: "answer" as const,
            },
          ]
        : [];

  // The answer label shows for a moment, then gets out of the way.
  const answered = guess !== null;
  useEffect(() => {
    if (!answered) return;
    const id = setTimeout(() => setGuess(null), 1000);
    return () => clearTimeout(id);
  }, [answered]);

  const update = (change: (p: S) => Partial<S>) =>
    setSt((p) => ({ ...p, ...change(p) }));
  const panel = {
    st,
    sim,
    m: metrics,
    beat,
    update,
    stopRamp: () => setRamping(false),
  };
  const { Scene, Stats, Controls } = topic;
  const inset = useBottomInset<HTMLDivElement, HTMLDivElement>();

  // On a phone the text and controls sit in a sheet that starts as a short
  // strip. Steps with controls, and open questions, start expanded.
  const phone = useMedia(PHONE);
  const beatKey = `${index}-${beatIdx}`;
  const hasControls = ((beat as { controls?: unknown[] }).controls?.length ?? 0) > 0;
  const [sheet, setSheet] = useState<{ key: string; open: boolean } | null>(null);
  const sheetOpen = !phone || (sheet?.key === beatKey ? sheet.open : hasControls || asking);
  const dragFrom = useRef<number | null>(null);
  return (
    <div ref={inset.root} className="relative h-[calc(100svh-57px)] min-h-[260px] w-full overflow-hidden">
      <div className="absolute inset-0">
        <Scene
          simRef={runtime.simRef}
          lastTickAt={runtime.lastTickAt}
          st={st}
          beat={beat}
          shot={shotAt(chapter, beatIdx)}
          shake={shake}
          update={update}
          quiet={asking}
          markers={markers}
        />
      </div>

      {/* Top: chapter menu, sound and live numbers. */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 ${short ? "space-y-1.5 p-2" : "space-y-2 p-3 sm:space-y-3 sm:p-4"}`}
      >
        <TopBar
          chapters={chapters}
          index={index}
          doneChapters={doneChapters}
          onChapter={onChapter}
          extra={onCheatSheet && { title: CHEAT_SHEET, onOpen: onCheatSheet }}
        />

        {/* Small screens: one row that scrolls sideways (short ones drop the
            labels too). Larger screens: wraps. */}
        <div
          className={`flex gap-2 ${
            compact
              ? `no-scrollbar pointer-events-auto -mx-3 overflow-x-auto px-3 ${short ? "[&_.chip-title]:hidden" : ""}`
              : "flex-wrap"
          }`}
        >
          <Stats {...panel} />
        </div>
      </div>

      {/* Bottom: question or challenge, caption, controls and navigation. */}
      <div
        ref={inset.bottom}
        className={`pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-bg via-bg/90 to-transparent ${
          short ? "px-3 pb-2 pt-6" : "px-3 pb-4 pt-10 sm:px-4 sm:pb-6 sm:pt-16"
        }`}
      >
        {phone && (
          <button
            aria-label={sheetOpen ? "Collapse panel" : "Expand panel"}
            aria-expanded={sheetOpen}
            onClick={(e) => e.detail === 0 && setSheet({ key: beatKey, open: !sheetOpen })}
            onPointerDown={(e) => (dragFrom.current = e.clientY)}
            onPointerUp={(e) => {
              if (dragFrom.current === null) return;
              const dy = e.clientY - dragFrom.current;
              dragFrom.current = null;
              setSheet({ key: beatKey, open: Math.abs(dy) < 10 ? !sheetOpen : dy < 0 });
            }}
            className="pointer-events-auto -mt-4 mb-1 flex h-6 w-full touch-none items-center justify-center"
          >
            <span className="h-1 w-10 rounded-full bg-muted/50" />
          </button>
        )}
        <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-5">
          <div
            key={`${index}-${beatIdx}-${asking}`}
            className="caption-in pointer-events-auto min-w-0"
          >
            {asking && predict ? (
              <>
                <div className="font-mono text-xs uppercase tracking-widest text-muted">
                  Paused · tap your guess
                </div>
                <h2
                  className={`mt-1 font-semibold tracking-tight ${short ? "text-lg" : "text-xl sm:text-3xl"}`}
                >
                  {predict.question}
                </h2>
                <p className="mt-1 text-sm text-muted sm:text-base">
                  {predict.clue}
                </p>
                <button
                  onClick={() => answer(null)}
                  className="mt-2 font-mono text-xs text-muted underline-offset-4 transition hover:text-fg hover:underline"
                >
                  Skip
                </button>
              </>
            ) : (
              <>
                {challenge && (
                  <div
                    className={`max-w-md rounded-xl border transition ${short ? "mb-2 px-3 py-2" : "mb-3 px-3 py-2.5 sm:mb-4"} ${
                      solved
                        ? "border-fg bg-fg text-bg"
                        : "border-line bg-bg/80 backdrop-blur"
                    }`}
                  >
                    <div className="text-sm font-medium">
                      {solved ? `✓ ${challenge.win}` : challenge.goal}
                    </div>
                    {!solved && parts && (
                      <ul className="mt-1.5 space-y-0.5 text-xs">
                        {parts.map((p) => (
                          <li
                            key={p.label}
                            className={`flex gap-1.5 ${p.state === "todo" ? "text-muted" : ""}`}
                          >
                            <span aria-hidden className="w-3 shrink-0 text-center font-mono">
                              {p.state === "pass" ? "✓" : p.state === "fail" ? "✗" : "·"}
                            </span>
                            <span>
                              {p.label}
                              <span className="sr-only">
                                {p.state === "pass" ? " (done)" : p.state === "fail" ? " (failed)" : " (to do)"}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {!solved && (
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
                        <div
                          className="h-full rounded-full bg-fg transition-[width]"
                          style={{ width: `${barProgress * 100}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}
                {beat.caption && (
                  <h2
                    className={`font-semibold tracking-tight ${short ? "text-lg" : "text-xl sm:text-3xl"}`}
                  >
                    {beat.caption}
                  </h2>
                )}
                {beat.sub && (
                  <p
                    className={`text-sm text-muted sm:text-base ${beat.caption ? "mt-1" : ""} ${sheetOpen ? "" : "line-clamp-2"}`}
                  >
                    {beat.sub}
                  </p>
                )}
                {sheetOpen && <Controls {...panel} />}
              </>
            )}
          </div>

          <div className="pointer-events-auto flex shrink-0 items-center gap-2">
            <button
              onClick={() => go(beatIdx - 1)}
              disabled={beatIdx === 0 && index === 0}
              className="h-10 w-10 shrink-0 rounded-full border border-line bg-bg/80 text-muted backdrop-blur transition hover:text-fg disabled:opacity-30"
              aria-label="Previous step"
            >
              ←
            </button>
            {asking ? (
              <button
                disabled
                className="h-10 flex-1 rounded-full border border-line bg-bg/80 px-6 text-sm text-muted backdrop-blur sm:flex-none"
              >
                Tap your guess
              </button>
            ) : lastBeat && lastChapter ? (
              <button
                onClick={onFinish}
                disabled={!onFinish}
                className="h-10 flex-1 rounded-full bg-fg px-6 text-sm font-medium text-bg transition hover:opacity-85 disabled:opacity-30 sm:flex-none"
              >
                Finish ✓
              </button>
            ) : (
              <button
                onClick={() => go(beatIdx + 1)}
                className={`h-10 flex-1 truncate rounded-full px-6 text-sm font-medium transition sm:flex-none ${
                  challenge && !solved
                    ? "border border-line bg-bg/80 text-muted backdrop-blur hover:text-fg"
                    : "bg-fg text-bg hover:opacity-85"
                } ${solved ? "animate-pulse" : ""}`}
              >
                {challenge && !solved
                  ? "Skip →"
                  : lastBeat
                    ? `Next: ${chapters[index + 1].title} →`
                    : "Next →"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
