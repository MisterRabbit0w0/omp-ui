import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

/**
 * §6.16 segmented tabs (side panel): 44px bar, buttons padding 3/8 radius 6,
 * 13px; selected bg-field ink, unselected opacity .5 (hover .75); new content
 * shows a 6px accent dot at the top right.
 */
export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

export function TabsList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <TabsPrimitive.List
      className={"flex h-11 shrink-0 items-center gap-0.5 px-1.5 " + (className ?? "")}
    >
      {children}
    </TabsPrimitive.List>
  );
}

export function TabsTrigger({
  value,
  dot = false,
  children,
}: {
  value: string;
  /** 6px accent dot: tab has unseen content */
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className={
        "relative shrink-0 whitespace-nowrap rounded-[6px] px-2 py-[3px] text-[13px] text-ink " +
        "opacity-50 transition-opacity duration-100 hover:opacity-75 " +
        "data-[state=active]:bg-field data-[state=active]:opacity-100"
      }
    >
      {children}
      {dot && (
        <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-accent" aria-hidden="true" />
      )}
    </TabsPrimitive.Trigger>
  );
}
