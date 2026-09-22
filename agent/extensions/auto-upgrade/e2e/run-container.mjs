import { createServer } from "node:http";
import { spawn } from "node:child_process";

const RESPONSE_TEXT = "E2E_OK";

const server = createServer((request, response) => {
	if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
		response.writeHead(404).end();
		return;
	}

	request.resume();
	request.once("end", () => {
		response.writeHead(200, {
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
			"Content-Type": "text/event-stream",
		});
		const id = `e2e-${Date.now()}`;
		const chunk = (delta, finishReason = null) => ({
			id,
			object: "chat.completion.chunk",
			created: Math.floor(Date.now() / 1000),
			model: "fake",
			choices: [{ index: 0, delta, finish_reason: finishReason }],
		});
		response.write(`data: ${JSON.stringify(chunk({ role: "assistant", content: RESPONSE_TEXT }))}\n\n`);
		response.write(`data: ${JSON.stringify(chunk({}, "stop"))}\n\n`);
		response.write("data: [DONE]\n\n");
		response.end();
	});
});

await new Promise((resolve, reject) => {
	server.once("error", reject);
	server.listen(3210, "127.0.0.1", resolve);
});

const environment = {
	...process.env,
	PATH: `/app/bin:${process.env.PATH ?? ""}`,
	PI_AGENT_DIR: "/tmp/pi-agent",
	PI_OFFLINE: "1",
	TERM: "xterm-256color",
};
const child = spawn("expect", ["/app/e2e/drive.expect"], {
	env: environment,
	stdio: "inherit",
});

const exitCode = await new Promise((resolve) => {
	child.once("error", (error) => {
		console.error(error);
		resolve(1);
	});
	child.once("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
});

server.close();
process.exit(exitCode);
