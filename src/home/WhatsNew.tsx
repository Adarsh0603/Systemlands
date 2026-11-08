import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Tooltip from "../core/Tooltip";
import { NEWS, markNewsSeen, newsPath, useUnseenNews, welcomeSeen } from "./news";

// A rolled parchment scroll: the royal dispatch.
function DispatchIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M19 17V5a2 2 0 0 0-2-2H4" />
      <path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" />
      <path d="M15 8h-5M15 12h-5" />
    </svg>
  );
}

// A scroll in the header that lists what changed lately, with a dot while
// something is unread. On the home page it opens once by itself for a
// returning learner who has unread notes.
export default function WhatsNew({ home }: { home: boolean }) {
  const unseen = useUnseenNews();
  const [open, setOpen] = useState(
    () => home && welcomeSeen() && unseen.length > 0,
  );
  // What was unread when the list opened, so the "New" tags stay put while it is open.
  const [freshNow, setFreshNow] = useState(
    () => new Set(unseen.map((n) => n.id)),
  );

  const show = () => {
    setFreshNow(new Set(unseen.map((n) => n.id)));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    markNewsSeen();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <Tooltip text="Royal Dispatch" className="inline-flex">
        <button
          onClick={show}
          aria-label={
            unseen.length > 0
              ? `Royal Dispatch, ${unseen.length} unread`
              : "Royal Dispatch"
          }
          className="relative inline-flex items-center rounded-full border border-line px-2 py-1.5 text-muted transition hover:text-fg"
        >
          <DispatchIcon />
          {unseen.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-danger ring-2 ring-bg" />
          )}
        </button>
      </Tooltip>
      {/* Rendered at the page root: the header's backdrop blur would otherwise
          pin this fixed overlay to the header instead of the screen. */}
      {open && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="news-title"
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-2xl border border-line bg-bg shadow-xl"
          >
            <div className="px-6 pt-6">
              <div className="font-mono text-xs uppercase tracking-widest text-muted">
                What's new
              </div>
              <h2
                id="news-title"
                className="mt-2 flex items-center gap-2.5 font-mono text-[24px] font-bold"
              >
                <DispatchIcon size={26} />
                Royal Dispatch
              </h2>
            </div>
            <ul className="mt-4 min-h-0 flex-1 divide-y divide-line overflow-y-auto border-y border-line">
              {NEWS.map((n) => (
                <li key={n.id} className="flex items-start gap-3 px-6 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{n.title}</span>
                      {freshNow.has(n.id) && (
                        <span className="rounded-full bg-fg px-1.5 py-px font-mono text-[10px] uppercase tracking-widest text-bg">
                          New
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm leading-snug text-muted">
                      {n.body}
                    </p>
                    {newsPath(n) && (
                      <p className="mt-1 flex flex-wrap items-center font-mono text-xs text-muted">
                        {newsPath(n)!.map((part, i) => (
                          <span key={part} className="flex items-center">
                            {i > 0 && (
                              <span aria-hidden className="mx-1 text-line">
                                /
                              </span>
                            )}
                            {part}
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex justify-center px-6 py-4">
              <button
                autoFocus
                onClick={close}
                className="h-10 rounded-full bg-fg px-6 text-sm font-medium text-bg transition hover:opacity-85"
              >
                Got it
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
