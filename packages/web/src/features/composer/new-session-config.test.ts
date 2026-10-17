import { describe, expect, test } from "bun:test";
import type { ProjectItem, UiConfig } from "@omp-ui/protocol";
import {
	NEW_SESSION_CONFIG_KEY,
	filterRecentProjects,
	loadPendingConfig,
	normalizeThinking,
	projectDisplayName,
	resolveSessionConfig,
	savePendingConfig,
	thinkingStartArg,
} from "./new-session-config";

function memoryStorage(initial?: string) {
	const data = new Map<string, string>();
	if (initial !== undefined) data.set(NEW_SESSION_CONFIG_KEY, initial);
	return {
		getItem: (k: string) => data.get(k) ?? null,
		setItem: (k: string, v: string) => void data.set(k, v),
		data,
	};
}

const project = (cwd: string, name: string, lastUsedAt: string): ProjectItem => ({ cwd, name, lastUsedAt, sessionCount: 1 });

describe("pending new-session config persistence", () => {
	test("round-trips through storage", () => {
		const storage = memoryStorage();
		savePendingConfig({ cwd: "/work/a", model: "p/m", thinking: "high", approvalMode: "yolo" }, storage);
		expect(loadPendingConfig(storage)).toEqual({ cwd: "/work/a", model: "p/m", thinking: "high", approvalMode: "yolo" });
	});

	test("drops unknown values and survives corrupt JSON", () => {
		expect(loadPendingConfig(memoryStorage('{"cwd":"/x","thinking":"galaxy","approvalMode":"root","model":3}'))).toEqual({ cwd: "/x" });
		expect(loadPendingConfig(memoryStorage("{not json"))).toEqual({});
		expect(loadPendingConfig(memoryStorage("null"))).toEqual({});
		expect(loadPendingConfig(null)).toEqual({});
	});
});

describe("resolveSessionConfig", () => {
	const config: UiConfig = {
		archived: [],
		recentProjects: ["/recent"],
		defaultModel: "anthropic/opus",
		defaultThinking: "auto",
		defaultApprovalMode: "always-ask",
	};

	test("config supplies defaults, the project falls back to the most recent one", () => {
		expect(resolveSessionConfig({}, config, [])).toEqual({
			cwd: "/recent",
			model: "anthropic/opus",
			thinking: "inherit",
			approvalMode: "always-ask",
		});
		expect(resolveSessionConfig({}, { archived: [], recentProjects: [] }, [project("/p", "p", "2026-01-01")]).cwd).toBe("/p");
		expect(resolveSessionConfig({}, null, [])).toEqual({ cwd: null, model: undefined, thinking: "inherit", approvalMode: "write" });
	});

	test("pending choices win over config", () => {
		expect(
			resolveSessionConfig({ cwd: "/mine", model: "x/y", thinking: "low", approvalMode: "yolo" }, config, []),
		).toEqual({ cwd: "/mine", model: "x/y", thinking: "low", approvalMode: "yolo" });
	});
});

describe("thinking start argument", () => {
	test("auto / inherit / unset omit --thinking; real levels pass through", () => {
		expect(thinkingStartArg(undefined)).toBeUndefined();
		expect(thinkingStartArg("auto")).toBeUndefined();
		expect(thinkingStartArg("inherit")).toBeUndefined();
		expect(thinkingStartArg("high")).toBe("high");
		expect(thinkingStartArg("nonsense")).toBeUndefined();
		expect(normalizeThinking("auto")).toBe("inherit");
	});
});

describe("project list", () => {
	test("display name handles both separators and trailing slashes", () => {
		expect(projectDisplayName("C:\\Users\\me\\omp-ui\\")).toBe("omp-ui");
		expect(projectDisplayName("/a/b/c/")).toBe("c");
		expect(projectDisplayName(null)).toBe("");
	});

	test("recent projects are most-recent-first, fuzzy filtered and capped at 8", () => {
		const many = Array.from({ length: 12 }, (_, i) => project(`/w/p${i}`, `p${i}`, `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`));
		const rows = filterRecentProjects(many, "");
		expect(rows).toHaveLength(8);
		expect(rows[0]!.cwd).toBe("/w/p11");
		const omp = [project("/code/omp-ui", "omp-ui", "2026-02-01"), project("/code/other", "other", "2026-03-01")];
		expect(filterRecentProjects(omp, "ompui").map(p => p.name)).toEqual(["omp-ui"]);
		expect(filterRecentProjects(omp, "/code/oth").map(p => p.name)).toEqual(["other"]);
		expect(filterRecentProjects(omp, "zzz")).toEqual([]);
	});

	test("a typed folder without sessions is listed first so it can carry the check mark", () => {
		const rows = filterRecentProjects([project("/code/a", "a", "2026-01-01")], "", "/fresh/dir");
		expect(rows[0]).toMatchObject({ cwd: "/fresh/dir", name: "dir" });
		expect(filterRecentProjects([project("/code/a", "a", "2026-01-01")], "", "/code/a")).toHaveLength(1);
	});
});
