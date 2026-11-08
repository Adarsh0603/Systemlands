import { askConfirm } from "../ConfirmDialog";
import { markSeen, useSeenTips } from "../tips";
import Tip from "../../home/Tip";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { CHEAT_SHEET, TopBar } from "../chrome";
import { Segmented, Select, Slider, Stepper } from "../controls";
import { HINT_AFTER } from "./day";
import { ArrowIcon, Chip, ClockIcon, CrossIcon, GaugeIcon } from "../hud";
import { play } from "../sound";
import type { Level } from "../types";
import { useBottomInset } from "../useBottomInset";
import { COMPACT, SHORT, SIDE, useMedia } from "../useMedia";
import BuildScene from "./BuildScene";
import { PieceIcon } from "./pieces";
import { canDrop, drop, fit, lift, remaining } from "./placement";
import {
  clearBuild,
  getBuild,
  saveBuild,
  useBuildsLoaded,
  type SavedBuild,
} from "./saved";
import { Source } from "../flow/nodes";
import Tooltip from "../Tooltip";
import { MS_PER_TICK, TICKS_PER_SECOND, startRun, type Running } from "./run";
import {
  PIECE_NAMES,
  type BuildTask,
  type Diagnosis,
  type PieceKind,
  type Placement,
  type Settings,
} from "./types";

interface Drag {
  kind: PieceKind;
  fromPad?: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
}

const PROBLEM_DELAY_MS = 2500;

// The pad under a screen point, if any (pads carry a data-pad attribute).
const padAt = (x: number, y: number) =>
  document
    .elementFromPoint(x, y)
    ?.closest("[data-pad]")
    ?.getAttribute("data-pad") ?? null;

interface BuildPlayerProps {
  task: BuildTask;
  chapters: { title: string; level: Level; locked?: boolean }[];
  index: number;
  doneChapters: number[];
  onChapter: (index: number) => void;
  onCheatSheet?: () => void;
  onStep?: (step: number, isLastStep: boolean) => void;
  onSolved?: (step: number) => void;
  onFinish?: () => void;
  // Where this build is saved between visits.
  saveKey: string;
  // Replaces what "Next" does and says, e.g. to go on to the next stage.
  onContinue?: () => void;
  continueText?: string;
  // The last build of a capstone: a bigger sound and word when it holds.
  finale?: boolean;
  // Stop the requests the moment the goal holds, and leave the board as it ended.
  stopWhenBuilt?: boolean;
}

// A "Build it" chapter: drag pieces onto the floor while live traffic runs
// through whatever has been built, until the goal holds. The build is saved
// as it changes. `fallbackKey` names the saved build it starts from when its
// own is empty (and where Reset returns to), e.g. a capstone's earlier stage.
export default function BuildPlayer({
  fallbackKey,
  ...props
}: BuildPlayerProps & { fallbackKey?: string }) {
  const ready = useBuildsLoaded();
  const [round, setRound] = useState(0);
  if (!ready) return null;
  return (
    <Builder
      key={round}
      {...props}
      start={fit(
        props.task,
        getBuild(props.saveKey) ?? (fallbackKey ? getBuild(fallbackKey) : undefined),
      )}
      onReset={() => {
        clearBuild(props.saveKey);
        setRound((r) => r + 1);
      }}
    />
  );
}

function Builder({
  task,
  chapters,
  index,
  doneChapters,
  onChapter,
  onCheatSheet,
  onStep,
  onSolved,
  onFinish,
  saveKey,
  start,
  onReset,
  onContinue,
  continueText,
  finale,
  stopWhenBuilt,
}: BuildPlayerProps & { start: SavedBuild; onReset: () => void }) {
  const [placed, setPlaced] = useState<Placement>(start.placed);
  const [selected, setSelected] = useState<PieceKind | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hoverPad, setHoverPad] = useState<string | null>(null);
  const [solved, setSolved] = useState(false);
  // The victory card stays up until the learner moves on or closes it to look around.
  const [victoryOpen, setVictoryOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(!!task.brief);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // The folded one-line goal can be closed too; the Goal button brings it back.
  const [goalHidden, setGoalHidden] = useState(false);
  const [openSetting, setOpenSetting] = useState<string | null>(null);
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [running, setRunning] = useState(!task.manualStart);
  // Set the moment a fail-fast task's requirement breaks: the run freezes there.
  const [failure, setFailure] = useState<{ title: string; text: string; at: number; hint?: string; diag?: Diagnosis } | null>(null);
  // Failed runs since the last hint (or the start of the stage); on the fifth the card also says why.
  const [fails, setFails] = useState(0);
  // The problem text the learner closed; it stays hidden until the text changes.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [, setFrame] = useState(0);
  const compact = useMedia(COMPACT);
  const short = useMedia(SHORT);
  // Wide screens get the controls in a side panel instead of over the floor.
  const side = useMedia(SIDE);
  const inset = useBottomInset<HTMLDivElement, HTMLDivElement>(side);
  const lastChapter = index === chapters.length - 1;

  const seenTips = useSeenTips();
  const [settings, setSettings] = useState<Settings>(() => ({
    ...Object.fromEntries((task.settings ?? []).map((s) => [s.id, s.initial])),
    ...start.settings,
  }));
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // The live system, rebuilt from scratch whenever the placement or a setting changes.
  const runRef = useRef<Running | null>(null);
  if (!runRef.current)
    runRef.current = startRun(task, placed, settings);
  const run = runRef.current;
  const lastTickAt = useRef(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      runRef.current!.step();
      lastTickAt.current = performance.now();
      setFrame((f) => f + 1);
    }, MS_PER_TICK);
    return () => clearInterval(id);
  }, [running]);
  // Stopping puts the run back at the start, ready to build again.
  const stop = () => {
    runRef.current = startRun(task, placedRef.current, settingsRef.current);
    holdStart.current = null;
    setFailure(null);
    setDismissed(null);
    setRunning(false);
  };

  const holdStart = useRef<number | null>(null);
  const problemSeen = useRef<{ text: string | null; since: number }>({
    text: null,
    since: 0,
  });
  const placedRef = useRef(placed);
  placedRef.current = placed;
  // Any change starts the run over, so nothing from the old build (numbers,
  // errors, a goal already reached) carries into the new one.
  const restart = (nextPlaced: Placement, nextSettings: Settings) => {
    runRef.current = startRun(task, nextPlaced, nextSettings);
    holdStart.current = null;
    setFailure(null);
    setDismissed(null);
    setSolved(false);
    setVictoryOpen(false);
    // Tasks with a Start button wait for it again, so the new build starts from zero.
    if (task.manualStart) setRunning(false);
  };
  const rebuild = (next: Placement) => {
    const current = placedRef.current;
    if (next === current) return;
    play(
      Object.keys(next).length < Object.keys(current).length
        ? "remove"
        : "place",
    );
    if (Object.keys(next).length > Object.keys(current).length) markSeen("pieces");
    placedRef.current = next;
    setPlaced(next);
    restart(next, settingsRef.current);
    saveBuild(saveKey, { placed: next, settings: settingsRef.current });
  };
  const changeSetting = (id: string, value: number) => {
    markSeen("tune");
    const next = { ...settingsRef.current, [id]: value };
    const wasRunning = running;
    settingsRef.current = next;
    setSettings(next);
    restart(placedRef.current, next);
    saveBuild(saveKey, { placed: placedRef.current, settings: next });
    // A run in progress carries on with the new setting; one that has not started waits for Start.
    if (task.manualStart && wasRunning) setRunning(true);
  };
  const rebuildRef = useRef(rebuild);
  rebuildRef.current = rebuild;

  // Opening this chapter counts as reaching it; solving it completes it.
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;
  const onSolvedRef = useRef(onSolved);
  onSolvedRef.current = onSolved;
  useEffect(() => {
    onStepRef.current?.(0, false);
  }, []);

  const m = run.metrics();
  const tick = run.flow.tick;
  useEffect(() => {
    if (solved || tick === 0) return;
    const now = performance.now();
    if (task.check(m, placed, settings, run.flow)) {
      holdStart.current ??= now;
      if (now - holdStart.current >= task.holdSeconds * 1000) {
        setSolved(true);
        if (finale || stopWhenBuilt) setRunning(false);
        setFails(0);
        setVictoryOpen(true);
        onSolvedRef.current?.(0);
        onStepRef.current?.(0, true);
        play(finale ? "conquered" : "built");
      }
    } else {
      holdStart.current = null;
    }
  }, [solved, tick, task, m, placed, settings, run, finale, stopWhenBuilt]);
  // Fail fast: the first requirement to break stops the run on the spot, with the reason.
  useEffect(() => {
    if (!task.failFast || !running || solved || failure || tick === 0) return;
    const broken = task.requirements?.find((r) => !r.read(run.flow, m).ok);
    if (!broken) return;
    const { text } = broken.read(run.flow, m);
    const diag = task.diagnose?.(m, placed, settings, run.flow) ?? undefined;
    const why = diag?.because ?? task.problem?.(m, placed, settings, run.flow) ?? broken.says;
    const hint = fails >= HINT_AFTER ? task.hint?.(m, placed, settings, run.flow) : null;
    setFailure({
      title: broken.label,
      text: diag ? why : `${text}. ${why}`,
      at: tick,
      hint: hint ?? undefined,
      diag,
    });
    // A hint shows once. The next one needs four more failed runs, for whatever breaks next.
    setFails(hint ? 0 : fails + 1);
    setRunning(false);
    play("drum");
  }, [task, running, solved, failure, fails, tick, m, placed, settings, run]);
  // Traffic right now: it can rise and fall during a build.
  const rps = !running
    ? 0
    : (run.flow.traffic?.() ??
      run.flow
        .all()
        .reduce(
          (sum, n) =>
            sum + (n instanceof Source ? n.rate * TICKS_PER_SECOND : 0),
          0,
        ));
  // A task with a diagnosis speaks only when the build fails, never while it runs.
  const raw =
    solved || tick === 0 || task.diagnose
      ? null
      : (task.problem?.(m, placed, settings, run.flow) ?? null);
  // A problem only shows once it has lasted a moment, and never while the goal
  // holds: a brief blip on a build that works would make the learner doubt it.
  if (raw !== problemSeen.current.text)
    problemSeen.current = { text: raw, since: performance.now() };
  const found =
    raw &&
    holdStart.current === null &&
    performance.now() - problemSeen.current.since >= PROBLEM_DELAY_MS
      ? raw
      : null;
  const problem = failure ? failure.text : found;
  const shownDiag = failure?.diag;
  // On a small screen the goal and title can be folded away to show more floor.
  const focus = compact && !detailsOpen && !solved;
  // After "Keep looking" on a solved build the panel folds down to a toggle row.
  const browse = compact && solved && !victoryOpen && !detailsOpen;
  // On a phone a started run clears the panel down to the goal and the
  // transport row; stopping or failing brings everything back, goal folded.
  const playing = compact && !!task.manualStart && running && !failure && !solved;
  useEffect(() => {
    setDetailsOpen(playing);
    if (playing) setGoalHidden(false);
  }, [playing]);
  // A failure puts the build-failed card on screen, so the goal steps aside,
  // unless the goal shows the day and where in it the build failed.
  useEffect(() => {
    if (failure && !task.timeline) setGoalHidden(true);
  }, [failure, task.timeline]);
  const holdProgress =
    holdStart.current === null
      ? 0
      : Math.min(
          1,
          (performance.now() - holdStart.current) / (task.holdSeconds * 1000),
        );

  // Dragging: from the toolbox or off a pad. A press that doesn't move is a
  // tap: in the toolbox it picks the piece for tap-to-place.
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const startDrag = (
    kind: PieceKind,
    fromPad: string | undefined,
    e: ReactPointerEvent,
  ) => {
    e.preventDefault();
    setDrag({
      kind,
      fromPad,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      moved: false,
    });
  };
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const moved =
        d.moved || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 6;
      if (moved && !d.moved) play("pickup");
      setDrag({ ...d, x: e.clientX, y: e.clientY, moved });
      setHoverPad(moved ? padAt(e.clientX, e.clientY) : null);
    };
    const up = (e: PointerEvent) => {
      const d = dragRef.current;
      setDrag(null);
      setHoverPad(null);
      if (!d) return;
      if (!d.moved) {
        if (d.fromPad === undefined) {
          if (selectedRef.current !== d.kind) play("pickup");
          setSelected((s) => (s === d.kind ? null : d.kind));
        } else {
          // Tapping a placed piece with another one picked swaps it in.
          tapPadRef.current(d.fromPad);
        }
        return;
      }
      const pad = padAt(e.clientX, e.clientY);
      const current = placedRef.current;
      if (pad && canDrop(task, current, pad, d.kind, d.fromPad))
        rebuildRef.current(drop(task, current, pad, d.kind, d.fromPad));
      else if (d.fromPad !== undefined)
        rebuildRef.current(lift(current, d.fromPad)); // dragged off: back to the toolbox
    };
    const cancel = () => {
      setDrag(null);
      setHoverPad(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [dragging, task]);

  // Tap-to-place: with a piece picked in the toolbox, tapping a pad drops it.
  const tapPad = (padId: string) => {
    if (!selected || !canDrop(task, placed, padId, selected)) return;
    const next = drop(task, placed, padId, selected);
    rebuild(next);
    if ((remaining(task, next)[selected] ?? 0) <= 0) setSelected(null);
  };
  const tapPadRef = useRef(tapPad);
  tapPadRef.current = tapPad;

  const nameOf = (kind: PieceKind) => task.names?.[kind] ?? PIECE_NAMES[kind];
  // Under the name: the standard name when the piece is renamed here, then what it does.
  const sub = (kind: PieceKind) => [task.names?.[kind] && PIECE_NAMES[kind], task.hints?.[kind]].filter(Boolean).join(" · ");
  const left = remaining(task, placed);
  const activeKind = drag?.moved ? drag.kind : selected;

  // Portrait phone: the toolbox is one row you swipe sideways. A swipe along
  // the row scrolls it; a drag up or down still carries the piece.
  const rail = compact && !short;
  const toolboxButtons = task.toolbox.map(({ kind }) => {
    const count = left[kind] ?? 0;
    return (
      <button
        key={kind}
        disabled={count <= 0}
        onPointerDown={(e) => count > 0 && startDrag(kind, undefined, e)}
        aria-pressed={selected === kind}
        aria-label={`${nameOf(kind)}, ${count} left. Drag onto a pad, or tap then tap a pad.`}
        className={`relative flex ${rail ? "shrink-0 touch-pan-x" : "touch-none"} flex-col items-stretch justify-start gap-1 rounded-xl border bg-bg/90 py-1.5 pl-1.5 pr-3 text-left text-sm backdrop-blur transition disabled:opacity-35 ${
          selected === kind
            ? "border-fg ring-1 ring-fg"
            : "border-line hover:border-fg"
        } ${count > 0 ? "cursor-grab active:cursor-grabbing" : ""}`}
      >
        <span className="absolute right-2 top-1.5 font-mono text-xs text-muted">×{count}</span>
        <span className="flex items-center gap-2 pr-7">
          <PieceIcon kind={kind} size={compact ? 26 : 34} />
          <span className="min-w-0">{nameOf(kind)}</span>
        </span>
        {/* A phone has no room for the description under each name. It spans the whole card. */}
        {!compact && sub(kind) && <span className="block pl-1 text-xs leading-tight text-muted">{sub(kind)}</span>}
      </button>
    );
  });
  // Settings appear once the piece they adjust is on the floor.
  const shownSettings = (task.settings ?? []).filter(
    (s) =>
      Object.values(placed).includes(s.when) ||
      task.fixed.some((f) => f.kind === s.when),
  );
  // A first-time visitor is walked through the board: place a piece, test it, then tune it.
  const piecesTip = !seenTips.includes("pieces") && Object.keys(placed).length === 0;
  const startTip = task.manualStart && !solved && !running && !seenTips.includes("start") && Object.keys(placed).length > 0;
  const tuneTip =
    shownSettings.length > 0 &&
    !seenTips.includes("tune") &&
    seenTips.includes("pieces") &&
    (seenTips.includes("start") || !task.manualStart);
  const settingStepper = (s: (typeof shownSettings)[number]) =>
    s.slider ? (
      <Slider
        label={s.label}
        unit={s.slider.unit}
        value={settings[s.id]}
        min={s.min}
        max={s.max}
        step={s.step}
        onChange={(v) => changeSetting(s.id, v)}
      />
    ) : (
    <Stepper
      value={settings[s.id]}
      min={s.min}
      max={s.max}
      label={s.label}
      onChange={(v) =>
        changeSetting(
          s.id,
          settings[s.id] + (v > settings[s.id] ? s.step : -s.step),
        )
      }
    />
  );
  const settingRow = (s: (typeof shownSettings)[number]) => (
    <div key={s.id} className="flex min-w-0 items-center gap-2">
      <PieceIcon kind={s.when} size={28} />
      {s.options ? (
        <>
          <span className="shrink-0 text-sm font-medium">{s.label}</span>
          <Segmented
            scroll
            value={settings[s.id]}
            options={s.options.map((label, i) => ({
              value: s.min + i * s.step,
              label,
            }))}
            onChange={(v) => changeSetting(s.id, v)}
          />
        </>
      ) : (
        settingStepper(s)
      )}
    </div>
  );
  // On a phone each setting is a chip showing its value; tapping one opens
  // just that control, so the floor is never buried under a long list.
  const chipValue = (s: (typeof shownSettings)[number]) =>
    s.options
      ? s.options[(settings[s.id] - s.min) / s.step]
      : s.slider
        ? `${settings[s.id].toLocaleString()} ${s.slider.unit}`
        : `${settings[s.id]} ${s.label}${settings[s.id] === 1 ? "" : "s"}`;
  const activeSetting = shownSettings.find((s) => s.id === openSetting);
  const settingChips = compact && shownSettings.length > 0 && (
    <div className="no-scrollbar pointer-events-auto -mx-3 mt-3 flex gap-2 overflow-x-auto px-3">
      {shownSettings.map((s) => (
        <button
          key={s.id}
          onClick={() => setOpenSetting(openSetting === s.id ? null : s.id)}
          aria-expanded={openSetting === s.id}
          className={`flex max-w-56 shrink-0 items-center gap-1.5 rounded-full border bg-bg/90 py-1 pl-1.5 pr-3 text-sm backdrop-blur transition hover:border-fg ${openSetting === s.id ? "border-fg" : "border-line"}`}
        >
          <PieceIcon kind={s.when} size={20} />
          <span className="truncate">
            {s.options && <span className="text-muted">{s.label} · </span>}
            {chipValue(s)}
          </span>
        </button>
      ))}
    </div>
  );
  const settingPopover = compact && activeSetting && (
    <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-line bg-bg p-2 shadow-lg">
      {settingRow(activeSetting)}
      <button
        onClick={() => setOpenSetting(null)}
        aria-label="Close"
        className="shrink-0 rounded-full px-2 font-mono text-xs text-muted transition hover:text-fg"
      >
        ✕
      </button>
    </div>
  );
  const transportBtn =
    "grid h-11 w-11 place-items-center rounded-full transition hover:bg-subtle sm:h-10 sm:w-10";
  const svg = {
    width: 20,
    height: 20,
    viewBox: "0 0 20 20",
    fill: "currentColor",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinejoin: "round" as const,
  };
  const startLabel = running ? "Stop and edit" : failure ? "Try again" : "Start requests";
  const startButton = task.manualStart && !solved && (
    <span className="relative inline-flex">
    {startTip && (
      <span className="pointer-events-none absolute bottom-full right-0 z-30 mb-2">
        <Tip nudge={false}>Now test it</Tip>
      </span>
    )}
    <Tooltip text={startLabel} className="inline-flex">
    <button
      onClick={
        running
          ? stop
          : failure
            ? () => {
                restart(placedRef.current, settingsRef.current);
                setRunning(true);
              }
            : () => {
                markSeen("start");
                setRunning(true);
              }
      }
      aria-label={startLabel}
      className={`${transportBtn} ${running ? "" : "bg-fg text-bg hover:bg-fg hover:opacity-85"} ${startTip ? "tip-ring" : ""}`}
    >
      <svg {...svg}>
        {running ? <rect x="5" y="5" width="10" height="10" rx="1.5" /> : <path d="M6 4l10 6-10 6z" />}
      </svg>
    </button>
    </Tooltip>
    </span>
  );
  const resetButton = (
    <Tooltip text="Reset build" className="inline-flex">
    <button
      onClick={async () => {
        const ok = await askConfirm({
          title: "Reset this build?",
          body: "Your pieces and settings here will be cleared.",
          confirm: "Reset build",
        });
        if (ok) onReset();
      }}
      aria-label="Reset build"
      className={transportBtn}
    >
      <svg {...svg} fill="none">
        <path d="M4 6h12M8 6V4h4v2M5.5 6l.7 10h7.6l.7-10M8.5 9v4.5M11.5 9v4.5" />
      </svg>
    </button>
    </Tooltip>
  );
  const situationButton = task.brief && (!briefOpen || side) && (
    <button
      onClick={() => setBriefOpen((o) => !o)}
      aria-expanded={briefOpen}
      className="rounded-xl border border-line bg-bg/90 px-3 py-1.5 text-sm backdrop-blur transition hover:border-fg"
    >
      Situation
    </button>
  );
  // The situation pops up in the middle of the floor.
  const briefCard = briefOpen && task.brief && (
    <div
      className={`pointer-events-none absolute inset-y-0 left-0 z-30 flex items-center justify-center p-4 ${side ? "right-88" : "right-0"}`}
    >
      <div className="pointer-events-auto flex max-h-full w-full max-w-lg flex-col rounded-2xl border border-line bg-bg p-5 shadow-xl">
        <div className="font-mono text-xs uppercase tracking-widest text-muted">
          The situation
        </div>
        <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto text-base">
          {task.brief.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <button
          onClick={() => setBriefOpen(false)}
          className="mt-4 h-10 shrink-0 self-start rounded-full bg-fg px-6 text-sm font-medium text-bg transition hover:opacity-85"
        >
          Start building
        </button>
      </div>
    </div>
  );
  const problemCard = problem && problem !== dismissed && !briefOpen && (
    <div
      className={`relative max-w-md rounded-xl border border-danger bg-bg/90 p-3 text-sm backdrop-blur ${side ? "" : "mb-3"}`}
      role="status"
    >
      <button
        onClick={() => setDismissed(problem)}
        aria-label="Close"
        className="absolute right-1.5 top-1.5 rounded-full px-2 font-mono text-xs text-muted transition hover:text-fg"
      >
        ✕
      </button>
      <div className="pr-6 font-mono text-xs uppercase tracking-widest text-danger">
        {failure ? `Build failed: ${failure.title}` : "What’s going wrong"}
      </div>
      {shownDiag ? (
        <div className="mt-1 space-y-1">
          <p>{shownDiag.because}</p>
          {shownDiag.look && <p className="font-medium">{shownDiag.look}</p>}
        </div>
      ) : (
        <p className="mt-1">{problem}</p>
      )}
      {failure?.hint && (
        <p className="mt-1.5 border-t border-danger/30 pt-1.5">
          <span className="font-medium">Hint: </span>
          {failure.hint}
        </p>
      )}
      {failure && (
        <p className="mt-1 text-xs opacity-70">
          Change something, or tap Try again to rerun it.
        </p>
      )}
    </div>
  );
  const continueLabel = continueText ?? (lastChapter ? "Finish ✓" : "Next →");
  const goOn = onContinue ?? (lastChapter ? onFinish : () => onChapter(index + 1));
  // Solving it pops a card up in the middle of the floor.
  const winText = (solved && task.result?.(m, placed, settings, run.flow)) || task.win;
  const victoryCard = solved && victoryOpen && (
    <div
      className={`pointer-events-none absolute inset-y-0 left-0 z-30 flex items-center justify-center p-4 ${side ? "right-88" : "right-0"}`}
    >
      <div
        role="status"
        className="pointer-events-auto flex max-h-full w-full max-w-md flex-col items-center rounded-2xl border border-line bg-bg p-6 text-center shadow-xl"
      >
        <svg
          viewBox="0 0 24 24"
          width={44}
          height={44}
          aria-hidden
          fill="none"
          stroke="#16a34a"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="0" fill="#16a34a" stroke="none">
            <animate
              attributeName="r"
              from="0"
              to="10"
              dur="1.2s"
              fill="freeze"
            />
          </circle>
          <circle cx="12" cy="12" r="10" />
          <g stroke="#fff" opacity="0">
            <animate
              attributeName="opacity"
              from="0"
              to="1"
              begin="0.9s"
              dur="0.3s"
              fill="freeze"
            />
            {finale ? (
              <>
                <path d="M9.5 6.5v11" />
                <path d="M9.5 7h6l-1.5 2.5 1.5 2.5h-6" fill="#fff" strokeWidth={1.5} />
              </>
            ) : (
              <path d="M7.5 12.5l3 3 6-7" />
            )}
          </g>
        </svg>
        <div className="mt-3 font-mono text-xs uppercase tracking-widest text-muted">
          {finale ? "Conquered!" : "Built"}
        </div>
        {task.lesson ? (
          <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto text-base">
            <p>{task.lesson.without}</p>
            <p className="font-medium">{task.lesson.choice}</p>
            <p>{task.lesson.cost}</p>
            {task.lesson.next && <p className="text-muted">{task.lesson.next}</p>}
            {winText !== task.win && <p className="border-t border-line pt-2 text-xs text-muted">{winText}</p>}
          </div>
        ) : (
          <p className="mt-2 min-h-0 flex-1 overflow-y-auto text-base">
            {winText}
          </p>
        )}
        <div className="mt-5 flex shrink-0 flex-wrap justify-center gap-2">
          <button
            onClick={goOn}
            className="h-10 rounded-full bg-fg px-6 text-sm font-medium text-bg transition hover:opacity-85"
          >
            {continueLabel}
          </button>
          <button
            onClick={() => setVictoryOpen(false)}
            className="h-10 rounded-full border border-line px-5 text-sm transition hover:border-fg"
          >
            Keep looking
          </button>
        </div>
      </div>
    </div>
  );
  const hint = selected
    ? `Now tap a pad to place the ${nameOf(selected).toLowerCase()}.`
    : !running
      ? "Place your pieces, then press Start requests. Changing anything restarts the run."
      : task.sub;
  // The way on only appears once the goal holds.
  const finishButton = solved && !victoryOpen && (
    <button
      onClick={goOn}
      className="pointer-events-auto h-10 shrink-0 animate-pulse rounded-full bg-fg px-6 text-sm font-medium text-bg transition hover:opacity-85"
    >
      {continueLabel}
    </button>
  );
  // Tells the learner a run takes a while to judge, and that any change starts it over.
  const elapsed = Math.floor(tick / TICKS_PER_SECOND);
  const testNote =
    task.statusNote?.(run.flow) ??
    (task.testSeconds
      ? elapsed < task.testSeconds
        ? `Testing your build: ${elapsed}s of about ${task.testSeconds}s. Any change restarts the test.`
        : "Almost done. The goal has to hold until the bar fills."
      : `The goal has to hold for ${task.holdSeconds}s. Any change restarts the test.`);
  const timeline = task.timeline;
  const phaseNow = timeline
    ? timeline.phases.reduce((at, p, i) => (tick >= p.from ? i : at), 0)
    : 0;
  // Where in the day a failed build gave out.
  const failedPhase =
    failure && timeline
      ? timeline.phases.reduce((at, p, i) => (failure.at >= p.from ? i : at), 0)
      : -1;
  const shownPhase = failure ? failedPhase : phaseNow;
  const goalCard = (
    <div
      className={`relative max-w-md rounded-xl border transition ${side ? "w-full p-3" : short || focus ? "mb-2 px-3 py-2" : "mb-3 p-3"} ${
        solved
          ? "border-fg bg-fg text-bg"
          : "border-line bg-bg/80 backdrop-blur"
      }`}
    >
      <div
        className={`font-mono text-xs uppercase tracking-widest opacity-70 ${!side && (short || focus) ? "hidden" : ""}`}
      >
        {solved ? "Built" : "Goal"}
      </div>
      <div
        className={
          focus ? "truncate pr-5 text-xs font-medium" : "mt-1 text-sm font-medium"
        }
      >
        {solved ? winText : focus ? (task.goalShort ?? task.goal) : task.goal}
      </div>
      {focus && !side && (
        <button
          onClick={() => setGoalHidden(true)}
          aria-label="Hide goal"
          className="absolute right-1 top-1 rounded-full px-2 font-mono text-xs text-muted transition hover:text-fg"
        >
          ✕
        </button>
      )}
      {!solved && running && !focus && (
        <div className="mt-1 text-xs opacity-70">{testNote}</div>
      )}
      {failure && !solved && (
        <div className="mt-1 text-xs font-medium text-danger">
          {timeline
            ? `Failed at ${Math.floor(failure.at / TICKS_PER_SECOND)}s, during “${timeline.phases[failedPhase].name}”.`
            : `Failed at ${Math.floor(failure.at / TICKS_PER_SECOND)}s.`}
        </div>
      )}
      {!solved && (running || failure) && !focus && timeline && (
        <div className="mt-2" aria-label="The day, phase by phase">
          <div className="relative flex h-1.5 gap-px overflow-hidden rounded-full">
            {timeline.phases.map((p, i) => {
              const to = timeline.phases[i + 1]?.from ?? timeline.end;
              return (
                <div
                  key={p.from}
                  className={
                    i < shownPhase
                      ? "bg-fg"
                      : i === shownPhase
                        ? failure
                          ? "bg-danger"
                          : "bg-fg animate-pulse"
                        : "bg-line"
                  }
                  style={{ flex: to - p.from }}
                />
              );
            })}
          </div>
          <div className="mt-1 flex gap-px text-xs leading-tight">
            {timeline.phases.map((p, i) => {
              const to = timeline.phases[i + 1]?.from ?? timeline.end;
              return (
                <Tooltip
                  as="div"
                  key={p.from}
                  text={p.name}
                  tap
                  className={`min-w-0 overflow-hidden ${i === shownPhase ? (failure ? "font-medium text-danger" : "font-medium") : "opacity-50"}`}
                  style={{ flex: to - p.from }}
                >
                  <span className="block truncate">{p.name}</span>
                </Tooltip>
              );
            })}
          </div>
        </div>
      )}
      {!solved && (
        <div
          className={`${focus ? "mt-1.5" : "mt-2"} h-1 overflow-hidden rounded-full bg-line`}
        >
          <div
            className="h-full rounded-full bg-fg transition-[width]"
            style={{ width: `${holdProgress * 100}%` }}
          />
        </div>
      )}
    </div>
  );

  return (
    <div
      ref={inset.root}
      className="relative h-[calc(100svh-57px)] min-h-[260px] w-full select-none overflow-hidden bg-black/[0.03] dark:bg-transparent"
    >
      <div
        className={`absolute inset-y-0 left-0 ${side ? "right-88" : "right-0"}`}
        onPointerDownCapture={() => {
          if (!compact) return;
          if (!playing) setDetailsOpen(false);
          setOpenSetting(null);
          setPinnedOpen(false);
          setBriefOpen(false);
        }}
      >
        <BuildScene
          task={task}
          run={run}
          placed={placed}
          settings={settings}
          lastTickAt={lastTickAt}
          dragKind={activeKind}
          hoverPad={hoverPad}
          onPadClick={tapPad}
          onPieceDown={(padId, e) => startDrag(placed[padId], padId, e)}
        />
      </div>

      {/* Right edge: start/stop and reset, above the zoom controls. On a
          phone they sit in the row with Situation instead, to spare the floor. */}
      {!compact && (
        <div
          style={{ bottom: "calc(50% + 4.75rem)" }}
          className={`absolute z-20 flex flex-col gap-1 rounded-full border border-line bg-bg/80 p-1 backdrop-blur ${side ? "right-[23rem]" : "right-3"}`}
        >
          {startButton}
          {resetButton}
        </div>
      )}

      {/* Top: chapter menu, sound and live numbers. */}
      <div
        className={`pointer-events-none absolute left-0 top-0 z-20 ${side ? "right-88" : "right-0"} ${short ? "space-y-1.5 p-2" : "space-y-2 p-3 sm:space-y-3 sm:p-4"}`}
      >
        <TopBar
          title={task.title}
          chapters={chapters}
          index={index}
          doneChapters={doneChapters}
          onChapter={onChapter}
          extra={onCheatSheet && { title: CHEAT_SHEET, onOpen: onCheatSheet }}
        />
        <div
          className={`flex gap-2 ${compact ? "no-scrollbar pointer-events-auto -mx-3 overflow-x-auto px-3" : "flex-wrap"}`}
        >
          <Chip
            icon={<ArrowIcon />}
            title="Traffic"
            value={`${Math.round(rps)} req/s`}
          />
          <Chip
            icon={<CrossIcon />}
            title="Errors"
            value={`${m.dropRate.toFixed(0)}%`}
            bad={m.dropRate > 1}
          />
          {(
            task.watch ?? [
              { kind: "busy", key: "", label: "Busiest server" } as const,
            ]
          ).map((w) => {
            if (w.kind === "note") {
              const { text, bad } = w.read(run.flow);
              return (
                <Chip
                  key={w.label}
                  icon={<ClockIcon />}
                  title={w.label}
                  value={text}
                  bad={bad}
                />
              );
            }
            if (w.kind === "latency") {
              const ms = m.latency[w.key] ?? 0;
              return (
                <Chip
                  key={w.key}
                  icon={<ClockIcon />}
                  title={w.label}
                  value={`${(ms / 1000).toFixed(2)}s`}
                  bad={ms > w.limitMs}
                />
              );
            }
            const busy = w.key ? (m.busy[w.key] ?? 0) : m.busiest;
            return (
              <Chip
                key={w.key || "busiest"}
                icon={<GaugeIcon />}
                title={w.label}
                value={`${Math.round(busy * 100)}%`}
                bad={busy >= 0.9}
              />
            );
          })}
        </div>
        {task.pinned && (
          <div className="pointer-events-auto max-w-xs rounded-xl border border-line bg-bg/85 backdrop-blur">
            <button
              onClick={() => setPinnedOpen((o) => !o)}
              aria-expanded={pinnedOpen}
              className="flex w-full items-center justify-between gap-3 px-3 py-1.5 font-mono text-xs uppercase tracking-widest text-muted"
            >
              {task.pinned.title}
              <span>{pinnedOpen ? "▴" : "▾"}</span>
            </button>
            {pinnedOpen && (
              <div
                className={`space-y-1.5 px-3 pb-2.5 text-xs leading-snug ${compact ? "h-[28svh] overflow-y-auto overscroll-contain" : ""}`}
              >
                {task.pinned.lines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
                {task.requirements && (
                  <>
                    <div className="pt-1 font-mono text-xs uppercase tracking-widest text-muted">It must</div>
                    <ul className="space-y-1.5">
                      {task.requirements.map((r) => {
                        const { text, ok } = running ? r.read(run.flow, m) : { text: "", ok: true };
                        return (
                          <li key={r.label} className="flex gap-2">
                            <span className={`mt-px font-mono ${running && !ok ? "text-danger" : ""}`}>
                              {running ? (ok ? "✓" : "✕") : "·"}
                            </span>
                            <span>
                              {r.says}
                              {running && text && (
                                <span className={`block font-mono text-xs ${ok ? "text-muted" : "text-danger"}`}>{text}</span>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        {side && task.brief && (
          <div className="pointer-events-auto flex flex-col items-start gap-2">
            {situationButton}
          </div>
        )}
      </div>

      {side ? (
        <>
          {/* Desktop: the side panel is the inventory and the settings. */}
          <aside className="absolute inset-y-0 right-0 z-20 flex w-88 flex-col gap-5 overflow-y-auto border-l border-line bg-bg p-4">
            <section>
              <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted">
                Pieces
                {piecesTip && <Tip>Drag one onto the board</Tip>}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {toolboxButtons}
              </div>
            </section>
            {[...new Set(shownSettings.map((s) => s.when))].map((when, i) => (
              <section key={when}>
                <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted">
                  <PieceIcon kind={when} size={22} />
                  {nameOf(when)}
                  {i === 0 && tuneTip && <Tip>Tune it</Tip>}
                </div>
                <div className="mt-2 space-y-2">
                  {shownSettings
                    .filter((s) => s.when === when)
                    .map((s) => (
                      <div
                        key={s.id}
                        className={
                          s.options
                            ? "flex flex-col items-stretch gap-1.5"
                            : "flex items-center justify-between gap-3"
                        }
                      >
                        {s.options ? (
                          <>
                            <span className="text-sm font-medium capitalize">
                              {s.label}
                            </span>
                            <Select
                              fill
                              label={s.label}
                              value={settings[s.id]}
                              options={s.options.map((label, i) => ({
                                value: s.min + i * s.step,
                                label,
                              }))}
                              onChange={(v) => changeSetting(s.id, v)}
                            />
                          </>
                        ) : (
                          settingStepper(s)
                        )}
                      </div>
                    ))}
                </div>
              </section>
            ))}
          </aside>

          {/* Canvas: goal, hint, situation and what's going wrong. */}
          <div
            ref={inset.bottom}
            className="pointer-events-none absolute bottom-0 left-0 right-88 z-20 px-4 pb-4 pt-10"
          >
            <div className="pointer-events-auto mx-auto flex max-w-md flex-col items-center gap-2 text-center">
              {problemCard}
              {!victoryOpen && goalCard}
              {finishButton}
            </div>
          </div>
        </>
      ) : (
        <div
          ref={inset.bottom}
          className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-linear-to-t from-bg via-bg/90 to-transparent ${
            short
              ? "px-3 pb-2 pt-6"
              : "px-3 pb-4 pt-10 sm:px-4 sm:pb-6 sm:pt-16"
          }`}
        >
          <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-5">
            <div className="pointer-events-auto min-w-0">
              {!playing && problemCard}
              {!victoryOpen && !browse && !(focus && goalHidden) && goalCard}
              <h2
                className={`font-semibold tracking-tight ${focus || browse || short || playing ? "hidden" : ""} text-xl sm:text-2xl`}
              >
                {task.title}
              </h2>
              <p className={`mt-1 text-sm text-muted ${focus || browse || short || playing ? "hidden" : ""}`}>
                {hint}
              </p>

              {!playing && !browse && (piecesTip || tuneTip) && (
                <div className="mt-2">
                  <Tip>{piecesTip ? "Drag a piece onto the board" : "Tune it: change a setting"}</Tip>
                </div>
              )}
              {!playing && !browse && settingChips}
              {!playing && !browse && settingPopover}

              {/* The toolbox. touch-none so a finger drag moves the piece
                  instead of scrolling the page. */}
              {rail && !playing && !browse && (
                <>
                  <div className="no-scrollbar -mx-3 mt-3 flex gap-2 overflow-x-auto px-3">
                    {toolboxButtons}
                  </div>
                  {selected && sub(selected) && (
                    <p className="mt-2 rounded-xl border border-line bg-bg/90 px-3 py-2 text-xs leading-snug text-muted backdrop-blur">
                      <span className="font-medium text-fg">{nameOf(selected)}</span> · {sub(selected)}
                    </p>
                  )}
                </>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {!rail && !playing && !browse && toolboxButtons}
                {compact && (!solved || !victoryOpen) && (
                  <button
                    onClick={() => {
                      if (focus && goalHidden) setDetailsOpen(true);
                      else setDetailsOpen((o) => !o);
                      setGoalHidden(false);
                    }}
                    aria-expanded={detailsOpen}
                    className="rounded-xl border border-line bg-bg/90 px-3 py-1.5 text-sm backdrop-blur transition hover:border-fg"
                  >
                    {solved ? (detailsOpen ? "Hide panel ▾" : "Panel ▴") : detailsOpen ? "Hide goal ▾" : "Goal ▴"}
                  </button>
                )}
                {!playing && situationButton}
                {compact && (
                  <div className="ml-auto flex rounded-full border border-line bg-bg/80 p-0.5 backdrop-blur">
                    {startButton}
                    {resetButton}
                  </div>
                )}
                {!compact && shownSettings.map(settingRow)}
              </div>
            </div>

            {finishButton}
          </div>
        </div>
      )}

      {briefCard}
      {victoryCard}

      {/* The piece following the pointer while dragging. */}
      {drag?.moved && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 opacity-90"
          style={{ left: drag.x, top: drag.y }}
        >
          <PieceIcon kind={drag.kind} size={64} />
        </div>
      )}
    </div>
  );
}
