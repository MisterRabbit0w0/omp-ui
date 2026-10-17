import { describe, expect, test } from "bun:test";
import { highlightStyle } from "../ui/sliding-highlight";

describe("highlightStyle", () => {
  test("null target hides the block", () => {
    expect(highlightStyle(null)).toEqual({ opacity: 0 });
  });

  test("target geometry maps to top/height", () => {
    expect(highlightStyle({ offsetTop: 40, offsetHeight: 32 })).toEqual({
      opacity: 1,
      top: 40,
      height: 32,
    });
  });
});
