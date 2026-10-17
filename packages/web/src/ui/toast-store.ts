/**
 * §6.17 toast queue (pure logic, framework-free so `bun test` covers it):
 * bottom-right stack of at most 3; new toasts arrive below, older ones move
 * up; info/success auto-dismiss after 4s, error stays until dismissed;
 * exit = 150ms fade + translateX(8px) before removal.
 */

export type ToastKind = "info" | "success" | "error";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  /** true while playing the 150ms exit animation */
  leaving: boolean;
}

export const MAX_VISIBLE = 3;
export const EXIT_MS = 150;

/** ms before auto-dismiss; null = stays until dismissed (error). */
export function autoDismissMs(kind: ToastKind): number | null {
  return kind === "error" ? null : 4000;
}

/** Push a toast; when the stack is full the oldest toast is dropped. */
export function pushToast(stack: readonly ToastItem[], item: ToastItem): ToastItem[] {
  const next = [...stack, item];
  return next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next;
}

export function removeToast(stack: readonly ToastItem[], id: number): ToastItem[] {
  return stack.filter((t) => t.id !== id);
}

export function markLeaving(stack: readonly ToastItem[], id: number): ToastItem[] {
  return stack.map((t) => (t.id === id ? { ...t, leaving: true } : t));
}

/** Offset from the bottom (0 = newest) → stacked style (§6.17). */
export function stackStyle(indexFromBottom: number): { transform?: string; opacity?: number } {
  if (indexFromBottom === 0) return {};
  return { transform: "scale(0.96)", opacity: 0.7 };
}

// ── store ──

type Listener = () => void;

let stack: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

export function subscribeToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getToasts(): readonly ToastItem[] {
  return stack;
}

export function dismissToast(id: number): void {
  stack = markLeaving(stack, id);
  emit();
  setTimeout(() => {
    stack = removeToast(stack, id);
    emit();
  }, EXIT_MS);
}

export function toast(message: string, kind: ToastKind = "info"): void {
  const item: ToastItem = { id: nextId++, kind, message, leaving: false };
  stack = pushToast(stack, item);
  emit();
  const ms = autoDismissMs(kind);
  if (ms !== null) setTimeout(() => dismissToast(item.id), ms);
}
