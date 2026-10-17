/**
 * Copy omp's generated wire types into this package. Run after upgrading omp:
 *   bun run sync:wire
 */
import { $ } from "bun";
import { dirname, join } from "node:path";

const bin = (process.env.OMP_UI_OMP_BIN ?? Bun.which("omp"));
if (!bin) throw new Error("omp not found on PATH (or set OMP_UI_OMP_BIN)");
const version = (await $`${bin} --version`.text()).trim();
const globalRoot = (await $`bun pm -g bin`.text().catch(() => "")).trim();
const candidates = [
	process.env.OMP_UI_OMP_PKG,
	globalRoot && join(dirname(globalRoot), "install/global/node_modules/@oh-my-pi/pi-coding-agent"),
	join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".bun/install/global/node_modules/@oh-my-pi/pi-coding-agent"),
].filter(Boolean) as string[];
let src: string | undefined;
for (const c of candidates) {
	const f = join(c, "src/modes/rpc/wire/rpc-wire.generated.ts");
	if (await Bun.file(f).exists()) { src = f; break; }
}
if (!src) throw new Error(`rpc-wire.generated.ts not found; set OMP_UI_OMP_PKG. Tried: ${candidates.join(", ")}`);
const body = await Bun.file(src).text();
const out = join(import.meta.dir, "../src/rpc-wire.ts");
await Bun.write(out, `// Synced from ${version} by scripts/sync-wire.ts\n${body}`);
console.log(`wrote ${out} from ${src} (${version})`);
