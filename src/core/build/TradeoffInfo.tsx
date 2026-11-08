import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { InfoIcon } from "../hud";

const DELAY = 300; // ms the pointer rests on the icon before the popover shows
const EDGE = 8; // px kept clear of the screen edge
const WIDTH = 240; // px, the popover's width

interface Spot {
  x: number;
  y: number;
  below: boolean;
}

// A small (i) beside a setting. Hover, focus or tap it to see what the chosen
// option gains and what it costs, so the trade stays out of the way until asked for.
export default function TradeoffInfo({
  label,
  gain,
  cost,
}: {
  label: string;
  gain: string;
  cost: string;
}) {
  const [spot, setSpot] = useState<Spot | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const timer = useRef<number>(0);

  const hide = () => {
    window.clearTimeout(timer.current);
    setSpot(null);
  };
  const show = (wait: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const r = button.current?.getBoundingClientRect();
      if (!r) return;
      const half = WIDTH / 2;
      const x = Math.min(
        window.innerWidth - EDGE - half,
        Math.max(EDGE + half, r.left + r.width / 2),
      );
      const below = r.top < 140;
      setSpot({ x, y: below ? r.bottom + 6 : r.top - 6, below });
    }, wait);
  };

  useEffect(() => {
    if (!spot) return;
    const off = (e: Event) => {
      if (
        e.type === "pointerdown" &&
        button.current?.contains(e.target as Node)
      )
        return;
      setSpot(null);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setSpot(null);
    window.addEventListener("scroll", off, true);
    window.addEventListener("pointerdown", off);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("scroll", off, true);
      window.removeEventListener("pointerdown", off);
      window.removeEventListener("keydown", escape);
    };
  }, [spot]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={`Tradeoffs of this ${label}`}
        aria-expanded={!!spot}
        className="inline-flex shrink-0 items-center justify-center rounded-full p-1 text-muted transition hover:text-fg focus-visible:text-fg"
        onPointerEnter={(e) => e.pointerType === "mouse" && show(DELAY)}
        onPointerLeave={(e) => e.pointerType === "mouse" && hide()}
        onClick={() => (spot ? hide() : show(0))}
        onFocus={(e) => e.target.matches(":focus-visible") && show(0)}
        onBlur={hide}
      >
        <InfoIcon />
      </button>
      {spot &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-[100] rounded-lg border border-line bg-bg p-3 text-left shadow-lg"
            style={{
              width: WIDTH,
              maxWidth: `calc(100vw - ${EDGE * 2}px)`,
              left: spot.x,
              top: spot.y,
              transform: `translate(-50%, ${spot.below ? "0" : "-100%"})`,
            }}
          >
            <p className="font-mono text-xs uppercase tracking-widest text-muted">
              Current Tradeoffs
            </p>
            <div className="mt-1.5 space-y-1 text-xs leading-snug text-fg">
              <p>
                <span className="font-medium">+ </span>
                {gain}
              </p>
              <p>
                <span className="font-medium">− </span>
                {cost}
              </p>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
