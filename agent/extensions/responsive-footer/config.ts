/**
 * Config loading for ~/.pi/agent/footer.json.
 *
 * Every field is optional and independently validated: a malformed or hostile
 * config degrades to defaults instead of taking the footer (and the TUI) down.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_HIDDEN } from "./segments.ts";

export interface FooterConfig {
	hide: string[];
	ctxWarn: number;
	ctxDanger: number;
	separator: string;
	maxGap: number;
	minBar: number;
	maxBar: number;
	/** Use Nerd Font glyphs for folder, branch and cache. */
	icons: boolean;
}

export const DEFAULT_CONFIG: FooterConfig = {
	// Replaced wholesale by a user config, so `"hide": []` shows everything.
	hide: DEFAULT_HIDDEN,
	ctxWarn: 65,
	ctxDanger: 85,
	separator: "  ",
	// Left-aligned by default: justified gaps make every field shift as values
	// change, which wrecks scanning. Set >0 to opt into spreading.
	maxGap: 0,
	minBar: 6,
	maxBar: 14,
	icons: true,
};

const num = (v: unknown, fallback: number, lo: number, hi: number): number =>
	typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;

/** Validate an arbitrary parsed value into a usable config. */
export function normalizeConfig(raw: unknown): FooterConfig {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_CONFIG };
	const r = raw as Record<string, unknown>;

	const hide = Array.isArray(r.hide) ? r.hide.filter((x): x is string => typeof x === "string") : DEFAULT_CONFIG.hide;


	const minBar = num(r.minBar, DEFAULT_CONFIG.minBar, 0, 40);
	return {
		hide,
		ctxWarn: num(r.ctxWarn, DEFAULT_CONFIG.ctxWarn, 0, 100),
		ctxDanger: num(r.ctxDanger, DEFAULT_CONFIG.ctxDanger, 0, 100),
		separator: typeof r.separator === "string" && r.separator.length > 0 ? r.separator : DEFAULT_CONFIG.separator,
		maxGap: Math.floor(num(r.maxGap, DEFAULT_CONFIG.maxGap, 0, 20)),
		minBar: Math.floor(minBar),
		maxBar: Math.floor(num(r.maxBar, DEFAULT_CONFIG.maxBar, minBar, 60)),
		icons: typeof r.icons === "boolean" ? r.icons : DEFAULT_CONFIG.icons,
	};
}

export function configPath(): string {
	const dir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
	return join(dir, "footer.json");
}

export function loadConfig(path = configPath()): FooterConfig {
	try {
		if (!existsSync(path)) return { ...DEFAULT_CONFIG };
		return normalizeConfig(JSON.parse(readFileSync(path, "utf-8")));
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

/**
 * Persist a single key, preserving anything else already in the file.
 *
 * Nerd Font support cannot be detected: a missing glyph renders as a box that
 * still occupies one cell, so a cursor-position probe cannot tell it apart
 * from a glyph that is present. Starship and Oh My Posh both punt on this and
 * ask the user to pick a preset. We ask once and remember the answer.
 */
export function saveConfigKey<K extends keyof FooterConfig>(key: K, value: FooterConfig[K], path = configPath()): void {
	let raw: Record<string, unknown> = {};
	try {
		if (existsSync(path)) {
			const parsed = JSON.parse(readFileSync(path, "utf-8"));
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed;
		}
	} catch {
		// Unreadable config: start clean rather than refuse to save.
	}
	raw[key] = value;
	writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`, "utf-8");
}
