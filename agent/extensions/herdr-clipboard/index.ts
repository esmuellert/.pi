import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installHerdrClipboardRelay, shouldRelayClipboard, type TextClipboard } from "./bridge.ts";

export function loadRuntimeClipboard(entrypoint = process.argv[1]): TextClipboard | undefined {
	if (!entrypoint) return undefined;
	try {
		const runtimeRequire = createRequire(pathToFileURL(realpathSync(entrypoint)));
		return runtimeRequire("@mariozechner/clipboard") as TextClipboard;
	} catch {
		return undefined;
	}
}

export default function (pi: ExtensionAPI) {
	if (!shouldRelayClipboard(process.env)) return;
	const clipboard = loadRuntimeClipboard();
	if (!clipboard) return;

	const restore = installHerdrClipboardRelay(clipboard, (sequence) => process.stdout.write(sequence));
	pi.on("session_shutdown", restore);
}
