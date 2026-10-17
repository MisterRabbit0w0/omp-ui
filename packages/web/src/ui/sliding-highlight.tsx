import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/**
 * Sliding hover highlight (§4.3): one absolutely-positioned bg block that
 * follows the hovered/focused row (top/height, 220ms); rows draw no own hover
 * background. Shared by sidebar lists, menus and the command palette.
 */

export interface HighlightTarget {
  offsetTop: number;
  offsetHeight: number;
}

/** Pure: target geometry → highlight block style (null target = hidden). */
export function highlightStyle(target: HighlightTarget | null): CSSProperties {
  if (!target) return { opacity: 0 };
  return { opacity: 1, top: target.offsetTop, height: target.offsetHeight };
}

const ITEM_ATTR = "data-hl-item";
const ACTIVE_ATTR = "data-hl-active";

/**
 * Hook: attach `containerRef` to a relatively-positioned list; rows carry
 * `data-hl-item`, the sticky row (e.g. current session) `data-hl-active`.
 * Render the returned `<span>` block as the first child.
 */
export function useSlidingHighlight<T extends HTMLElement>({
  variant = "menu",
  activeKey,
  restOnActive = false,
}: {
  /** menu: inset-x 4px radius 6 bg-hover; list: full-width radius 7 bg-hover-2 */
  variant?: "menu" | "list";
  /** Changes whenever the active row may have changed (current session, list contents). */
  activeKey?: unknown;
  /** When true (keyboard-driven comboboxes), rests on `[data-hl-active]`; default false so mouse leave hides the highlight in place. */
  restOnActive?: boolean;
} = {}) {
  const containerRef = useRef<T | null>(null);
  const hoveringRef = useRef(false);
  const visibleRef = useRef(false);
  const [style, setStyle] = useState<CSSProperties>(() => highlightStyle(null));

  const moveTo = useCallback((el: Element | null) => {
    if (el instanceof HTMLElement) {
      const wasVisible = visibleRef.current;
      visibleRef.current = true;
      setStyle({
        ...highlightStyle({ offsetTop: el.offsetTop, offsetHeight: el.offsetHeight }),
        transitionProperty: wasVisible ? "top, height, opacity" : "opacity",
      });
    } else {
      visibleRef.current = false;
      setStyle(prev =>
        prev.top !== undefined
          ? { ...prev, opacity: 0, transitionProperty: "opacity" }
          : highlightStyle(null),
      );
    }
  }, []);

  const onPointerOver = useCallback(
    (e: React.PointerEvent<T>) => {
      hoveringRef.current = true;
      const item = (e.target as Element).closest(`[${ITEM_ATTR}]`);
      if (
        item instanceof HTMLElement &&
        !item.hasAttribute("data-disabled") &&
        !item.hasAttribute("disabled")
      ) {
        moveTo(item);
      } else if (!restOnActive) {
        moveTo(null);
      }
    },
    [moveTo, restOnActive],
  );

  const onFocus = useCallback(
    (e: React.FocusEvent<T>) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (!restOnActive && typeof target.matches === "function" && !target.matches(":focus-visible")) {
        return;
      }
      const item = target.closest(`[${ITEM_ATTR}]`);
      if (
        item instanceof HTMLElement &&
        !item.hasAttribute("data-disabled") &&
        !item.hasAttribute("disabled")
      ) {
        moveTo(item);
      }
    },
    [moveTo, restOnActive],
  );

  const onPointerLeave = useCallback(() => {
    hoveringRef.current = false;
    if (restOnActive) {
      moveTo(containerRef.current?.querySelector(`[${ACTIVE_ATTR}]`) ?? null);
    } else {
      moveTo(null);
    }
  }, [moveTo, restOnActive]);

  useLayoutEffect(() => {
    if (hoveringRef.current) return;
    if (restOnActive) {
      moveTo(containerRef.current?.querySelector(`[${ACTIVE_ATTR}]`) ?? null);
    } else {
      moveTo(null);
    }
  }, [activeKey, moveTo, restOnActive]);

  const highlightBlock = (
    <span
      aria-hidden="true"
      className={
        "hl pointer-events-none absolute transition-[top,height,opacity] duration-[180ms] ease-out-strong " +
        (variant === "menu" ? "inset-x-1 rounded-[6px] bg-hover" : "inset-x-0 rounded-[7px] bg-hover-2")
      }
      style={style}
    />
  );

  return { containerRef, highlightBlock, onPointerOver, onFocus, onPointerLeave };
}
