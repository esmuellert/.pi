/**
 * What this terminal actually sends for a key combination.
 *
 * Keybindings are only worth what the terminal delivers. ctrl+shift+arrow is
 * pi's default for jumping between turns and arrives as nothing at all here --
 * terminals commonly keep that range for themselves, or fold shift away, or
 * lose it crossing tmux or ssh.
 *
 *   node --experimental-strip-types probe/keys.ts
 *
 * Press each combination it lists. Anything that prints arrived; anything
 * silent did not and cannot be bound. q quits.
 */

const inp = process.stdin;

/** What pi wants for each, so an arriving sequence can be recognised. */
const KNOWN: Record<string, string> = {
	"\u001b[1;6A": "ctrl+shift+up",
	"\u001b[1;6B": "ctrl+shift+down",
	"\u001b[1;5A": "ctrl+up",
	"\u001b[1;5B": "ctrl+down",
	"\u001b[1;3A": "alt+up",
	"\u001b[1;3B": "alt+down",
	"\u001b[1;2A": "shift+up",
	"\u001b[1;2B": "shift+down",
	"\u001b[5~": "pageUp",
	"\u001b[6~": "pageDown",
	"\u001b[1;5H": "ctrl+home",
	"\u001b[1;5F": "ctrl+end",
};

const TRY = [
	"ctrl+shift+up / down      pi's default for jumping between turns",
	"ctrl+up / ctrl+down       one modifier, usually survives",
	"alt+up / alt+down         often free in a terminal",
	"shift+up / shift+down     conflicts with selection in some terminals",
	"ctrl+shift+f              pi's default for search",
	"ctrl+g                    a plain control character, always arrives",
];

console.log("Press each of these. What prints, arrived. What stays silent, cannot be bound.\n");
for (const line of TRY) console.log(`  ${line}`);
console.log("\n  q to quit\n");

inp.setRawMode?.(true);
inp.resume();
inp.on("data", (chunk: Buffer) => {
	const data = chunk.toString();
	if (data === "q" || data === "\u0003") {
		inp.setRawMode?.(false);
		process.exit(0);
	}
	const escaped = JSON.stringify(data).replace(/\\u001b/g, "ESC");
	const bytes = [...data].map((c) => c.codePointAt(0)!.toString(16).padStart(2, "0")).join(" ");
	const known = KNOWN[data];
	console.log(`  ${escaped.padEnd(24)} ${bytes.padEnd(26)} ${known ? `= ${known}` : ""}`);
});
