import type { ReactNode } from "react";

/** §2.2 level 2 card: bg-surface, radius 10, shadow-card. */
export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={"overflow-hidden rounded-card bg-surface shadow-card " + (className ?? "")}>
      {children}
    </div>
  );
}

/** §2.5 card-bar: padding 10/12, border-b line. */
export function CardBar({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={
        "flex items-center justify-between gap-2 border-b border-line px-3 py-2.5 " + (className ?? "")
      }
    >
      {children}
    </div>
  );
}

/** §2.5 card footer: padding 10, border-t line. */
export function CardFooter({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={
        "flex items-center justify-between gap-2 border-t border-line p-2.5 " + (className ?? "")
      }
    >
      {children}
    </div>
  );
}
