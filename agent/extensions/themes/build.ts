// Turn a palette plus a mapping into a pi theme file.
//
// The generated JSON mirrors how pi's own dark.json is written: every colour
// lives once in `vars` under its upstream role name, and `colors` refers to it.
// That keeps the provenance visible in the output, not just in this repo — you
// can open rose-pine.json and see that mdLink is iris.
//
//   node --experimental-strip-types build.ts [--out <dir>] [--check]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { composite } from "./color.ts";
import { mappingFor, STATE_TINT, type Ref, type ThemeMapping } from "./mapping.ts";
import { PALETTES, type Palette } from "./palettes.ts";

export const DEFAULT_OUT = join(homedir(), ".pi", "agent", "themes");

export type Theme = {
	$schema: string;
	name: string;
	vars: Record<string, string>;
	colors: Record<string, string>;
	export: Record<string, string>;
};

const SCHEMA =
	"https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json";

/** Look up a role, failing loudly rather than emitting `undefined`. */
function roleValue(palette: Palette, name: string): string {
	const value = palette.roles[name];
	if (!value) throw new Error(`${palette.name} has no role "${name}"`);
	return value;
}

/** The variable name a ref is stored under in the theme's `vars` block. */
export function varName(ref: Ref): string {
	return "role" in ref ? ref.role : `${ref.tint}On${ref.over[0]!.toUpperCase()}${ref.over.slice(1)}`;
}

export function resolve(palette: Palette, ref: Ref): string {
	if ("role" in ref) return roleValue(palette, ref.role);
	return composite(roleValue(palette, ref.over), roleValue(palette, ref.tint), STATE_TINT);
}

export function buildTheme(palette: Palette, mapping: ThemeMapping = mappingFor(palette.name)): Theme {
	const vars: Record<string, string> = {};
	const colors: Record<string, string> = {};
	for (const [token, ref] of Object.entries(mapping.colors)) {
		const name = varName(ref);
		vars[name] = resolve(palette, ref);
		colors[token] = name;
	}
	// The export block takes hex directly: pi resolves vars for colors only.
	const exported: Record<string, string> = {};
	for (const [token, ref] of Object.entries(mapping.export)) {
		exported[token] = resolve(palette, ref);
	}
	return { $schema: SCHEMA, name: palette.name, vars, colors, export: exported };
}

export const render = (theme: Theme): string => `${JSON.stringify(theme, null, "\t")}\n`;

function main(argv: readonly string[]): number {
	const outIndex = argv.indexOf("--out");
	const out = outIndex === -1 ? DEFAULT_OUT : argv[outIndex + 1];
	if (!out) {
		console.error("--out needs a directory");
		return 1;
	}
	const check = argv.includes("--check");
	if (!check) mkdirSync(out, { recursive: true });

	let stale = 0;
	for (const palette of PALETTES) {
		const path = join(out, `${palette.name}.json`);
		const wanted = render(buildTheme(palette));
		let current: string | undefined;
		try {
			current = readFileSync(path, "utf-8");
		} catch {
			current = undefined;
		}
		if (current === wanted) {
			console.log(`  up to date  ${palette.name}`);
			continue;
		}
		stale += 1;
		if (check) {
			console.log(`  ${current === undefined ? "missing" : "stale"}     ${palette.name}`);
			continue;
		}
		writeFileSync(path, wanted, "utf-8");
		console.log(`  written     ${palette.name}`);
	}
	if (check && stale > 0) {
		console.error(`\n${stale} theme(s) differ from the generator. Run: pnpm build`);
		return 1;
	}
	if (!check) console.log(`\n${PALETTES.length} themes in ${out}`);
	return 0;
}

if (import.meta.filename === process.argv[1]) process.exit(main(process.argv.slice(2)));
