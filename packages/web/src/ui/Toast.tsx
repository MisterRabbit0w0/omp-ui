import { useSyncExternalStore } from "react";
import {
  getToasts,
  subscribeToast,
  dismissToast,
  stackStyle,
  type ToastItem,
} from "./toast-store";

const DOT: Record<ToastItem["kind"], string> = {
  info: "bg-accent",
  success: "bg-green",
  error: "bg-red",
};

/**
 * §6.17 Toaster: bottom-right, 16px from edges, width 340; newest at the
 * bottom, older ones shift up at scale(.96)/opacity .7. Render once at root.
 */
export function Toaster() {
  const toasts = useSyncExternalStore(subscribeToast, getToasts);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[340px] flex-col-reverse gap-2">
      {toasts.map((t, i) => (
        <button
          key={t.id}
          type="button"
          data-toast-kind={t.kind}
          onClick={() => dismissToast(t.id)}
          className={
            "pointer-events-auto flex w-full items-center gap-2.5 rounded-card bg-surface " +
            "px-3 py-2.5 text-left text-[12.5px] text-ink shadow-raised " +
            (t.leaving
              ? "translate-x-2 opacity-0 transition-[opacity,transform] duration-150"
              : "animate-[fade-up_0.3s_var(--ease-out-strong)] transition-[opacity,transform] duration-150")
          }
          style={stackStyle(i)}
        >
          <span className={"size-1.5 shrink-0 rounded-full " + DOT[t.kind]} aria-hidden="true" />
          <span className="min-w-0 flex-1">{t.message}</span>
        </button>
      ))}
    </div>
  );
}

export { toast, dismissToast } from "./toast-store";
export type { ToastKind, ToastItem } from "./toast-store";
