import type { ReactNode } from "react";

/** §4.3 "进行中" shimmer label; swap to static ink-2 text when done. */
export function ShimmerText({
  children,
  active = true,
  className,
}: {
  children: ReactNode;
  /** false renders a static ink-2 label with fade-in (350ms) */
  active?: boolean;
  className?: string;
}) {
  if (!active) {
    return <span className={"animate-[fade-in_0.35s] text-ink-2 " + (className ?? "")}>{children}</span>;
  }
  return <span className={"shimmer-text " + (className ?? "")}>{children}</span>;
}
