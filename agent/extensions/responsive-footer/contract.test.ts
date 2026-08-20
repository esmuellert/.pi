/**
 * Contracts with pi that the type system cannot express.
 *
 * Run: pnpm test
 *
 * layout.test.ts covers our own logic against stubs and would keep passing if
 * pi changed underneath it. `tsc` covers API shape. What is left is behaviour:
 * concrete return values, and data that lives in JSON rather than in types.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { getPackageDir } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ICON } from "./segments.ts";

describe("pi-tui measurement", () => {
	it("counts ascii, wide characters and ANSI the way the layout assumes", () => {
		assert.equal(visibleWidth("abc"), 3);
		assert.equal(visibleWidth("中"), 2, "wide characters must cost two columns");
		assert.equal(visibleWidth("\u001b[31mred\u001b[0m"), 3, "ANSI must not be counted");
	});

	it("measures every icon we actually render as one column", () => {
		// Read the real constants, not a copy: layout.test.ts compares rendered
		// text against this same map, so a glyph swapped for a double-width
		// character would satisfy it while overflowing every line.
		for (const [name, glyph] of Object.entries(ICON)) {
			assert.equal(visibleWidth(glyph), 1, `icon '${name}' must fit the one column the layout budgets`);
		}
	});
});

describe("pi theme", () => {
	it("still defines every colour key the footer paints with", () => {
		// Themes are JSON, so nothing type-checks these names.
		const theme = JSON.parse(readFileSync(join(getPackageDir(), "dist/modes/interactive/theme/dark.json"), "utf-8"));
		const colors = theme.colors ?? theme;
		for (const key of ["accent", "dim", "muted", "success", "warning", "error"]) {
			assert.ok(key in colors, `theme no longer defines '${key}'`);
		}
	});
});
