import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ReactNode } from "react";

/** Raised popover (§2.2 level 3), pop-in 180ms toward the anchor. */
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({
  children,
  className,
  side = "top",
  align = "center",
  padding = "normal",
}: {
  children: ReactNode;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** `tight` = 4px menus (FRONTEND §6.14); `normal` = 8px info popovers. */
  padding?: "tight" | "normal";
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        side={side}
        align={align}
        sideOffset={6}
        className={
          `z-50 rounded-card bg-surface ${padding === "tight" ? "p-1" : "p-2"} shadow-raised ` +
          "focus-visible:rounded-card focus-visible:shadow-raised " +
          "origin-[var(--radix-popover-content-transform-origin)] " +
          "data-[state=open]:animate-[pop-in_0.18s_var(--ease-out-strong)] " +
          (className ?? "")
        }
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}
