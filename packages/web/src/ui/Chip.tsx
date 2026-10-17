import type { ReactNode } from "react";

/** §2.5 / prototype .chip: h22, radius 6, bg-field, hairline, 11.5 ink-2. */
export function Chip({
  icon,
  mono = false,
  className,
  children,
}: {
  icon?: ReactNode;
  mono?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={
        "inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-chip bg-field px-1.5 " +
        "text-[11.5px] whitespace-nowrap text-ink-2 shadow-hairline " +
        (mono ? "font-mono " : "") +
        (className ?? "")
      }
    >
      {icon}
      {children}
    </span>
  );
}

type PillTone = "green" | "red" | "orange" | "accent" | "neutral";

const PILL_TONE: Record<PillTone, string> = {
  green: "bg-green-tint text-green-ink",
  red: "bg-red-tint text-red-ink",
  orange: "bg-orange-tint text-orange-ink",
  accent: "bg-accent-tint text-accent-on-tint",
  neutral: "bg-field text-ink-2 shadow-hairline",
};

/** §2.5 status pill: h22, radius 999, 11.5/500; state text uses *-ink. */
export function Pill({
  tone,
  className,
  children,
}: {
  tone: PillTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={
        "inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-pill px-2 text-[11.5px] font-medium whitespace-nowrap " +
        PILL_TONE[tone] + " " + (className ?? "")
      }
    >
      {children}
    </span>
  );
}

/** §6.14 kbd: min-w 18, h 18, px 4, radius 5, bg-surface, hairline, 10.5 mono ink-2. */
export function Kbd({
  tone = "default",
  className,
  children,
}: {
  /** "tooltip" = on dark tooltip bg (§6.14); "onInk" = inside primary buttons */
  tone?: "default" | "tooltip" | "onInk";
  className?: string;
  children: ReactNode;
}) {
  const toneClass =
    tone === "tooltip"
      ? "bg-transparent text-tooltip-muted shadow-none"
      : tone === "onInk"
        ? "bg-white/15 text-inherit shadow-none dark:bg-black/12"
        : "bg-surface text-ink-2 shadow-hairline";
  return (
    <kbd
      className={
        "inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-[5px] px-1 " +
        "font-mono text-[10.5px] whitespace-nowrap " + toneClass + " " + (className ?? "")
      }
    >
      {children}
    </kbd>
  );
}

/**
 * §6.13 status badge: 22px circle, white glyph on colored fill.
 * success pops in with a drawn check (§4.3: pop-in 300ms, check-draw delayed 80ms).
 */
export function StatusBadge({ status }: { status: "success" | "error" | "aborted" }) {
  const bg = status === "success" ? "bg-green" : status === "error" ? "bg-red" : "bg-ink-3";
  return (
    <span
      className={
        "grid size-[22px] shrink-0 animate-[pop-in_0.3s_var(--ease-out-strong)] place-items-center rounded-full text-white " +
        bg
      }
      aria-hidden="true"
    >
      {status === "success" ? (
        <svg width={12} height={12} viewBox="0 0 24 24" className="i" strokeWidth={3.5}>
          <path
            d="M20 6L9 17l-5-5"
            strokeDasharray={24}
            className="animate-[check-draw_0.3s_var(--ease-out-strong)_80ms_both]"
          />
        </svg>
      ) : status === "error" ? (
        <svg width={11} height={11} viewBox="0 0 24 24" className="i" strokeWidth={3.5}>
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      ) : (
        <svg width={11} height={11} viewBox="0 0 24 24" className="i" strokeWidth={3.5}>
          <path d="M5 12h14" />
        </svg>
      )}
    </span>
  );
}
