import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function sessionMarker(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (process.env.PI_AUTO_UPGRADE === "1") {
			const marker = process.env.PI_E2E_RESUMED_MARKER ?? "/tmp/pi-resumed";
			appendFileSync(marker, `${ctx.sessionManager.getSessionFile() ?? "none"}\n`);
		}
	});
}
