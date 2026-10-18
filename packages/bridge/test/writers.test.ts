import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { ConfigStore } from "../src/config";
import { modelConfigFingerprint } from "../src/models";
import { tempDir } from "./helpers";

describe("ConfigStore with two bridges on one config dir", () => {
	test("an update from one store is not overwritten by the other's stale cache", () => {
		const dir = tempDir("cfg-writers");
		const a = new ConfigStore(dir);
		const b = new ConfigStore(dir);
		a.archive("s1");
		b.archive("s2");
		expect(a.config.archived.sort()).toEqual(["s1", "s2"]);
		expect(new ConfigStore(dir).config.archived.sort()).toEqual(["s1", "s2"]);
		a.update({ defaultModel: "p/m" });
		b.unarchive("s1");
		expect(b.config.defaultModel).toBe("p/m");
		expect(a.config.archived).toEqual(["s2"]);
	});

	test("a corrupt config file keeps the last good config instead of resetting to empty", () => {
		const dir = tempDir("cfg-corrupt");
		const store = new ConfigStore(dir);
		store.archive("s1");
		fs.writeFileSync(path.join(dir, "config.json"), "{ not json");
		expect(store.config.archived).toEqual(["s1"]);
	});

	test("concurrent writers in separate processes never drop each other's archive", async () => {
		const dir = tempDir("cfg-procs");
		new ConfigStore(dir).update({});
		const configModule = path.resolve(import.meta.dir, "../src/config.ts");
		const script = (id: string) =>
			`import { ConfigStore } from ${JSON.stringify(configModule)};
			const s = new ConfigStore(${JSON.stringify(dir)});
			for (let i = 0; i < 20; i++) s.archive(${JSON.stringify(id)} + "-" + i);`;
		const procs = ["a", "b", "c", "d"].map(id =>
			Bun.spawn([process.execPath, "-e", script(id)], { stdout: "ignore", stderr: "inherit" }),
		);
		expect(await Promise.all(procs.map(p => p.exited))).toEqual([0, 0, 0, 0]);
		const archived = new ConfigStore(dir).config.archived;
		expect(archived).toHaveLength(80);
		expect(fs.existsSync(path.join(dir, "config.json.lock"))).toBe(false);
	});

	test("a stale lock left by a crashed writer is taken over", () => {
		const dir = tempDir("cfg-stale");
		const store = new ConfigStore(dir);
		const lock = path.join(dir, "config.json.lock");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(lock, "999999");
		const old = new Date(Date.now() - 60_000);
		fs.utimesSync(lock, old, old);
		store.archive("s1");
		expect(store.config.archived).toEqual(["s1"]);
	});

	test("saves leave no temp files behind", () => {
		const dir = tempDir("cfg-tmp");
		const store = new ConfigStore(dir);
		store.archive("s1");
		store.archive("s2");
		expect(fs.readdirSync(dir).filter(name => name.endsWith(".tmp"))).toEqual([]);
	});
});

describe("modelConfigFingerprint", () => {
	test("changes when omp's config.yml or models.yml is rewritten by another process", () => {
		const dir = tempDir("fp");
		const empty = modelConfigFingerprint(dir);
		fs.writeFileSync(path.join(dir, "config.yml"), "modelRoles:\n  default: a/b\n");
		const afterConfig = modelConfigFingerprint(dir);
		expect(afterConfig).not.toBe(empty);
		fs.writeFileSync(path.join(dir, "models.yml"), "providers: {}\n");
		expect(modelConfigFingerprint(dir)).not.toBe(afterConfig);
	});

	test("ignores agent.db churn from ordinary session activity", () => {
		const dir = tempDir("fp-agentdb");
		const before = modelConfigFingerprint(dir);
		fs.writeFileSync(path.join(dir, "agent.db"), "x");
		fs.writeFileSync(path.join(dir, "agent.db-wal"), "y");
		expect(modelConfigFingerprint(dir)).toBe(before);
	});
});
