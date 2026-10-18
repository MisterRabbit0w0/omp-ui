import { describe, expect, test } from "bun:test";
import type { SessionListItem } from "@omp-ui/protocol";
import { createSessionView } from "@/store/session-reducer";
import {
	cwdGroupLabel,
	filterSessions,
	formatRelativeTime,
	fuzzyScore,
	getAdjacentSessionId,
	getSessionRowStatus,
	groupSessionsByCwd,
	previewGroupSessions,
	SESSION_GROUP_PREVIEW_LIMIT,
} from "./sidebar-utils";

const SAMPLE_SESSIONS: SessionListItem[] = [
	{
		id: "s1",
		file: "/tmp/s1.jsonl",
		cwd: "/Users/chengqi/Desktop/code/omp-ui",
		title: "实现侧边栏",
		createdAt: "2026-10-16T10:00:00Z",
		updatedAt: "2026-10-16T11:59:30Z",
		sizeBytes: 1024,
		live: true,
		running: false,
		archived: false,
	},
	{
		id: "s2",
		file: "/tmp/s2.jsonl",
		cwd: "/Users/chengqi/Desktop/code/omp-ui",
		title: "Bridge 联调",
		createdAt: "2026-10-16T09:00:00Z",
		updatedAt: "2026-10-16T11:45:00Z",
		sizeBytes: 2048,
		live: false,
		running: false,
		archived: false,
	},
	{
		id: "s3",
		file: "/tmp/s3.jsonl",
		cwd: "C:\\Users\\chengqi\\projects\\oh-my-pi",
		title: "修复 Windows 路径",
		createdAt: "2026-10-15T09:00:00Z",
		updatedAt: "2026-10-15T10:00:00Z",
		sizeBytes: 4096,
		live: false,
		running: false,
		archived: true,
	},
];

describe("sidebar-utils", () => {
	test("cwdGroupLabel extracts last path segment across POSIX and Windows", () => {
		expect(cwdGroupLabel("/Users/chengqi/Desktop/code/omp-ui")).toBe("omp-ui");
		expect(cwdGroupLabel("C:\\Users\\chengqi\\projects\\oh-my-pi\\")).toBe("oh-my-pi");
	});

	test("fuzzyScore and filterSessions match title and cwd and respect archived", () => {
		expect(fuzzyScore("侧边", "实现侧边栏")).toBeGreaterThan(0);
		expect(fuzzyScore("bgl", "Bridge 联调")).toBe(0);
		expect(fuzzyScore("omp", "/Users/chengqi/Desktop/code/omp-ui")).toBeGreaterThan(0);

		const visible = filterSessions(SAMPLE_SESSIONS, "");
		expect(visible.map(s => s.id)).toEqual(["s1", "s2"]);

		const withArchived = filterSessions(SAMPLE_SESSIONS, "Windows", { includeArchived: true });
		expect(withArchived.map(s => s.id)).toEqual(["s3"]);
	});

	test("groupSessionsByCwd groups by cwd and sorts by updatedAt desc", () => {
		const groups = groupSessionsByCwd(SAMPLE_SESSIONS);
		expect(groups.length).toBe(2);
		expect(groups[0]?.label).toBe("omp-ui");
		expect(groups[0]?.sessions.map(s => s.id)).toEqual(["s1", "s2"]);
		expect(groups[1]?.label).toBe("oh-my-pi");
	});

	test("previewGroupSessions keeps the default list short, expands, and resets", () => {
		const many = Array.from({ length: 9 }, (_, i) => ({ ...SAMPLE_SESSIONS[0]!, id: `m${i}` }));
		const short = previewGroupSessions(many);
		expect(short.sessions).toHaveLength(SESSION_GROUP_PREVIEW_LIMIT);
		expect(short.hiddenCount).toBe(9 - SESSION_GROUP_PREVIEW_LIMIT);
		expect(short.hasMore).toBe(true);

		const expanded = previewGroupSessions(many, { expanded: true });
		expect(expanded.sessions).toHaveLength(9);
		expect(expanded.hiddenCount).toBe(0);
		expect(expanded.hasMore).toBe(false);

		// Reopening a workspace calls this again without `expanded`, so it starts short.
		expect(previewGroupSessions(many).sessions.map(s => s.id)).toEqual(short.sessions.map(s => s.id));
	});

	test("previewGroupSessions always keeps the current session visible", () => {
		const many = Array.from({ length: 8 }, (_, i) => ({ ...SAMPLE_SESSIONS[0]!, id: `m${i}` }));
		const preview = previewGroupSessions(many, { currentSessionId: "m7" });
		expect(preview.sessions.map(s => s.id)).toContain("m7");
		expect(preview.sessions).toHaveLength(SESSION_GROUP_PREVIEW_LIMIT + 1);
		expect(preview.hiddenCount).toBe(8 - SESSION_GROUP_PREVIEW_LIMIT - 1);
	});

	test("getSessionRowStatus prioritizes waiting > running > error > unread > idle", () => {
		const base = createSessionView("s1");
		expect(getSessionRowStatus(base, undefined, undefined, false)).toBe("idle");
		expect(getSessionRowStatus(base, 500, 100, false)).toBe("unread");
		expect(getSessionRowStatus(base, 500, 100, true)).toBe("idle");

		const running = { ...base, run: { kind: "running" as const } };
		expect(getSessionRowStatus(running, 500, 100, false)).toBe("running");

		const waiting = {
			...running,
			pendingUi: [
				{
					type: "extension_ui_request" as const,
					id: "r1",
					method: "confirm" as const,
					title: "t",
					message: "m",
				},
			],
		};
		expect(getSessionRowStatus(waiting, 500, 100, false)).toBe("waiting");

		const errView = {
			...base,
			run: { kind: "dead" as const, crashed: true, code: 1 },
		};
		expect(getSessionRowStatus(errView, undefined, undefined, true)).toBe("error");
	});

	test("formatRelativeTime formats Chinese relative timestamps", () => {
		const now = Date.parse("2026-10-16T12:00:00Z");
		expect(formatRelativeTime(now - 15_000, now)).toBe("刚刚");
		expect(formatRelativeTime(now - 12 * 60_000, now)).toBe("12 分钟");
		expect(formatRelativeTime(now - 3 * 3600_000, now)).toBe("3 小时");
		expect(formatRelativeTime(now - 26 * 3600_000, now)).toBe("昨天");
		expect(formatRelativeTime("2026-09-28T10:00:00Z", now)).toBe("9月28日");
	});

	test("getAdjacentSessionId navigates visible sessions", () => {
		const groups = groupSessionsByCwd(SAMPLE_SESSIONS);
		expect(getAdjacentSessionId(groups, {}, "s1", 1)).toBe("s2");
		expect(getAdjacentSessionId(groups, {}, "s2", 1)).toBe("s3");
		expect(getAdjacentSessionId(groups, {}, "s1", -1)).toBe("s3");
	});
});
