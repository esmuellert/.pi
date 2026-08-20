/**
 * Config loading for ~/.pi/agent/tool-icons.json.
 *
 * Whether the terminal's font has Nerd Font glyphs cannot be detected: a
 * missing one still measures a single column, so it renders as a box that the
 * layout is perfectly happy with. The same question the footer asks, asked once
 * here and remembered.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type MarkStyle = "glyphs" | "letters" | "off";

export type Config = {
	readonly style: MarkStyle;
};

export const DEFAULT_CONFIG: Config = { style: "glyphs" };

const STYLES: readonly MarkStyle[] = ["glyphs", "letters", "off"];

/** Accept only what we wrote, so a hand-edited file degrades rather than throws. */
export function parseConfig(raw: unknown): Config {
	if (typeof raw !== "object" || raw === null) return DEFAULT_CONFIG;
	const style = (raw as { style?: unknown }).style;
	return STYLES.includes(style as MarkStyle) ? { style: style as MarkStyle } : DEFAULT_CONFIG;
}

export function configPath(): string {
	// PI_CODING_AGENT_DIR is how pi itself finds this directory.
	const dir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
	return join(dir, "tool-icons.json");
}

export function loadConfig(path = configPath()): Config {
	try {
		return parseConfig(JSON.parse(readFileSync(path, "utf-8")));
	} catch {
		return DEFAULT_CONFIG;
	}
}

export function saveConfig(config: Config, path = configPath()): void {
	writeFileSync(path, `${JSON.stringify(config, null, "\t")}\n`, "utf-8");
}
