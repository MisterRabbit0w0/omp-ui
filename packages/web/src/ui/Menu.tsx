import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import type { ComponentProps, ReactNode } from "react";
import { Kbd } from "./Chip";
import { useSlidingHighlight } from "./sliding-highlight";

/**
 * §6.14 menus: bg-surface, shadow-raised, radius 10, padding 4, pop-in 180ms
 * with transform-origin toward the trigger; hover/keyboard selection is a
 * sliding highlight block, rows draw no own hover background.
 */

export const Menu = DropdownMenuPrimitive.Root;
export const MenuTrigger = DropdownMenuPrimitive.Trigger;
export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

interface MenuContentProps {
  children: ReactNode;
  className?: string;
  /** e.g. 220 for ⋯ menus, 280 for the model menu (§6.14) */
  width?: number;
  sideOffset?: number;
  align?: ComponentProps<typeof DropdownMenuPrimitive.Content>["align"];
  footer?: ReactNode;
}

function contentClass(originVar: string, className?: string) {
  return (
    "relative z-50 rounded-card bg-surface p-1 shadow-raised " +
    "focus-visible:rounded-card focus-visible:shadow-raised " +
    `origin-[var(${originVar})] ` +
    "data-[state=open]:animate-[pop-in_0.16s_var(--ease-out-strong)] " +
    (className ?? "")
  );
}

function DropdownMenuContentBody({
  children,
  className,
  width = 220,
  sideOffset = 4,
  align = "start",
  footer,
}: MenuContentProps) {
  const hl = useSlidingHighlight<HTMLDivElement>({ variant: "menu" });
  return (
    <DropdownMenuPrimitive.Content
      ref={hl.containerRef}
      onPointerOver={hl.onPointerOver}
      onFocus={hl.onFocus}
      onPointerLeave={hl.onPointerLeave}
      sideOffset={sideOffset}
      align={align}
      style={{ width }}
      className={contentClass("--radix-dropdown-menu-content-transform-origin", className)}
    >
      {hl.highlightBlock}
      {children}
      {footer !== undefined && (
        <div className="mt-1 border-t border-line px-2 pt-1.5 pb-1 text-[11px] text-ink-2">
          {footer}
        </div>
      )}
    </DropdownMenuPrimitive.Content>
  );
}

export function MenuContent(props: MenuContentProps) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuContentBody {...props} />
    </DropdownMenuPrimitive.Portal>
  );
}

function ContextMenuContentBody({ children, className, width = 220 }: MenuContentProps) {
  const hl = useSlidingHighlight<HTMLDivElement>({ variant: "menu" });
  return (
    <ContextMenuPrimitive.Content
      ref={hl.containerRef}
      onPointerOver={hl.onPointerOver}
      onFocus={hl.onFocus}
      onPointerLeave={hl.onPointerLeave}
      style={{ width }}
      className={contentClass("--radix-context-menu-content-transform-origin", className)}
    >
      {hl.highlightBlock}
      {children}
    </ContextMenuPrimitive.Content>
  );
}

export function ContextMenuContent(props: MenuContentProps) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuContentBody {...props} />
    </ContextMenuPrimitive.Portal>
  );
}

interface MenuItemProps {
  icon?: ReactNode;
  /** right-aligned shortcut hint */
  kbd?: ReactNode;
  /** danger rows: red text, hover bg-red-tint (§6.14) */
  danger?: boolean;
  /** when set the row becomes the 36px slash-menu layout (icon + name + description + source) */
  description?: ReactNode;
  source?: ReactNode;
  disabled?: boolean;
  onSelect?: () => void;
  children: ReactNode;
}

function itemBody({ icon, kbd, danger, description, source, children }: MenuItemProps) {
  if (description !== undefined || source !== undefined) {
    return (
      <>
        <span className="grid w-[22px] shrink-0 place-items-center text-ink-2">{icon}</span>
        <span className="text-[12.5px] font-medium text-ink">{children}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{description}</span>
        {source !== undefined && <span className="shrink-0 text-[11px] text-ink-2">{source}</span>}
      </>
    );
  }
  return (
    <>
      {icon !== undefined && <span className="grid shrink-0 place-items-center">{icon}</span>}
      <span className={"min-w-0 flex-1 truncate text-[12.5px] " + (danger ? "text-red-ink" : "text-ink")}>
        {children}
      </span>
      {kbd !== undefined && <Kbd>{kbd}</Kbd>}
    </>
  );
}

const itemClass = (danger: boolean, rich: boolean) =>
  "relative z-10 flex w-full cursor-default items-center gap-2.5 rounded-[6px] px-2 text-left outline-none " +
  (rich ? "h-9 " : "h-[30px] ") +
  (danger ? "data-[highlighted]:bg-red-tint " : "") +
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-35";

export function MenuItem(props: MenuItemProps) {
  const rich = props.description !== undefined || props.source !== undefined;
  return (
    <DropdownMenuPrimitive.Item
      data-hl-item=""
      disabled={props.disabled}
      onSelect={props.onSelect}
      className={itemClass(props.danger === true, rich)}
    >
      {itemBody(props)}
    </DropdownMenuPrimitive.Item>
  );
}

export function ContextMenuItem(props: MenuItemProps) {
  const rich = props.description !== undefined || props.source !== undefined;
  return (
    <ContextMenuPrimitive.Item
      data-hl-item=""
      disabled={props.disabled}
      onSelect={props.onSelect}
      className={itemClass(props.danger === true, rich)}
    >
      {itemBody(props)}
    </ContextMenuPrimitive.Item>
  );
}

/** §6.14 separator: 1px line, 4px above and below. */
export function MenuSeparator() {
  return <DropdownMenuPrimitive.Separator className="my-1 h-px bg-line" />;
}

/** §6.14 group label: 10.5 uppercase ink-3. */
export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <DropdownMenuPrimitive.Label className="px-2 pt-1.5 pb-0.5 text-[10.5px] font-medium tracking-[0.08em] text-ink-3 uppercase">
      {children}
    </DropdownMenuPrimitive.Label>
  );
}
