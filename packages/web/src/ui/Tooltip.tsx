import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

/**
 * §6.14 tooltip: dark in both themes (tooltip-bg/-fg, 1px tooltip-border),
 * 11.5px, padding 4/8, radius 6, appears after 400ms, fade-in 150ms, static.
 * Wrap the app in <TooltipProvider> once (done here per-tree with shared delay).
 */
export function Tooltip({
  content,
  kbd,
  children,
  side = "top",
}: {
  content: ReactNode;
  /** shortcut hint rendered in tooltip-muted */
  kbd?: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={400} skipDelayDuration={0}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={4}
            className={
              "z-50 animate-[fade-in_0.15s] rounded-[6px] border border-tooltip-border " +
              "bg-tooltip-bg px-2 py-1 text-[11.5px] text-tooltip-fg"
            }
          >
            <span className="inline-flex items-center gap-1.5">
              {content}
              {kbd !== undefined && (
                <kbd className="font-mono text-[10.5px] text-tooltip-muted">{kbd}</kbd>
              )}
            </span>
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
