import type { ReactNode } from "react";

/**
 * §6.11 pixel grid: 3×3, cell 4px / gap 1.5px (sm: 3px / 1px), ink.
 * - Drive: wavefront delay (col + |row − 1|) × 90ms, pixel-on 650ms.
 * - Orbit: perimeter cells light up in order over 950ms.
 * - Dots: all cells pulse together.
 * static: animation off, cells stay at rest opacity (.15).
 */
export function PixelGrid({
  mode = "drive",
  size = "md",
  static: staticProp = false,
  className,
}: {
  mode?: "drive" | "dots" | "orbit";
  size?: "md" | "sm";
  static?: boolean;
  className?: string;
}) {
  const cell = size === "sm" ? 3 : 4;
  const gap = size === "sm" ? 1 : 1.5;
  return (
    <span
      className={"pixels inline-grid " + (className ?? "")}
      style={{ gridTemplateColumns: `repeat(3, ${cell}px)`, gap }}
      aria-hidden="true"
    >
      {Array.from({ length: 9 }, (_, i) => {
        const row = Math.floor(i / 3);
        const col = i % 3;
        let animation: string | undefined;
        if (!staticProp) {
          if (mode === "drive") {
            animation = `pixel-on 650ms ease-in-out ${(col + Math.abs(row - 1)) * 90}ms infinite`;
          } else if (mode === "orbit") {
            // perimeter cells light in order; the center cell stays dim
            const idx = [0, 1, 2, 5, 8, 7, 6, 3].indexOf(i);
            if (idx !== -1) animation = `pixel-on 950ms linear ${idx * (950 / 8)}ms infinite`;
          } else {
            animation = "pixel-on 950ms ease-in-out infinite";
          }
        }
        return (
          <span
            key={i}
            className="rounded-[1px] bg-ink opacity-15"
            style={{ width: cell, height: cell, animation }}
          />
        );
      })}
    </span>
  );
}
