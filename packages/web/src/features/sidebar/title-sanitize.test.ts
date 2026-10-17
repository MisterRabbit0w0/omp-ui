import { describe, expect, test } from "bun:test";
import { stripPrivateUse } from "./sidebar-utils";

describe("stripPrivateUse (m11)", () => {
	test("removes BMP and supplementary private-use glyphs, keeps text", () => {
		expect(stripPrivateUse("\u{F08AE} LIC: Simplify copyright")).toBe("LIC: Simplify copyright");
		expect(stripPrivateUse("\uE0A0 branch \uF8FF")).toBe("branch");
		expect(stripPrivateUse("中文标题 ok")).toBe("中文标题 ok");
		expect(stripPrivateUse("\u{F08AE}")).toBe("");
	});
});
