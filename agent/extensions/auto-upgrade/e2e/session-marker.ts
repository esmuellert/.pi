import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function sessionMarker(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (process.env.PI_AUTO_UPGRADE === "1") {
			appendFileSync("/tmp/pi-resumed", `${ctx.sessionManager.getSessionFile() ?? "none"}\n`);
		}
	});
}
