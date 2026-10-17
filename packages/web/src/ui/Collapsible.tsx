import type { ReactNode } from "react";

/**
 * §4.3 expand/collapse: grid-rows 0fr ↔ 1fr + opacity, 300–400ms ease-out-strong.
 * Never animates height. Markup: outer grid, single inner overflow-hidden child.
 */
export function Collapsible({
  open,
  duration = 300,
  className,
  children,
}: {
  open: boolean;
  /** ms, 300–400 per §4.3 */
  duration?: 300 | 400;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={"grid-collapse " + (open ? "open " : "") + (className ?? "")}
      style={{ transitionDuration: `${duration}ms` }}
    >
      <div>{children}</div>
    </div>
  );
}
