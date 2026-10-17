import { describe, expect, test } from "bun:test";
import {
  MAX_VISIBLE,
  autoDismissMs,
  markLeaving,
  pushToast,
  removeToast,
  stackStyle,
  type ToastItem,
} from "../ui/toast-store";

const mk = (id: number): ToastItem => ({ id, kind: "info", message: `t${id}`, leaving: false });

describe("pushToast", () => {
  test("appends new toasts at the end (bottom of stack)", () => {
    const s = pushToast([mk(1)], mk(2));
    expect(s.map((t) => t.id)).toEqual([1, 2]);
  });

  test(`caps the stack at ${MAX_VISIBLE}, dropping the oldest`, () => {
    let s: ToastItem[] = [];
    for (let i = 1; i <= 5; i++) s = pushToast(s, mk(i));
    expect(s.map((t) => t.id)).toEqual([3, 4, 5]);
  });
});

describe("autoDismissMs", () => {
  test("info/success dismiss after 4s, error persists", () => {
    expect(autoDismissMs("info")).toBe(4000);
    expect(autoDismissMs("success")).toBe(4000);
    expect(autoDismissMs("error")).toBeNull();
  });
});

describe("removeToast / markLeaving", () => {
  test("removeToast drops by id", () => {
    expect(removeToast([mk(1), mk(2)], 1).map((t) => t.id)).toEqual([2]);
  });

  test("markLeaving flags only the target", () => {
    const s = markLeaving([mk(1), mk(2)], 2);
    expect(s[0]?.leaving).toBe(false);
    expect(s[1]?.leaving).toBe(true);
  });
});

describe("stackStyle", () => {
  test("newest toast is unscaled; older ones shrink and fade", () => {
    expect(stackStyle(0)).toEqual({});
    expect(stackStyle(1)).toEqual({ transform: "scale(0.96)", opacity: 0.7 });
    expect(stackStyle(2)).toEqual({ transform: "scale(0.96)", opacity: 0.7 });
  });
});
