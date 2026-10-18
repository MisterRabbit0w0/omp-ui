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
});
