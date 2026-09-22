import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { appendFileSync, chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as pty from "node-pty";
import { createServer } from "node:http";

const require = createRequire(import.meta.url);
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(dirname(dirname(packageRoot)));
const session = `auto-upgrade-host-${process.pid}`;
const tempRoot = join(tmpdir(), session);
const binDir = join(tempRoot, "bin");
const agentDir = join(tempRoot, "agent");
const sessionFile = join(agentDir, "session.jsonl");
const invocationLog = join(tempRoot, "pi-invocations.log");
const handoffLog = join(tempRoot, "handoff.log");
const restartErrorLog = join(tempRoot, "restart-stderr.log");
const resumedMarker = join(tempRoot, "pi-resumed");
const providerCount = join(tempRoot, "provider-count");

let ptyProcess;
let ptyExited = false;
let ptyExit;
let output = "";
let serverStarted = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function text(path) {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

function hasSessionContent(value) {
	return text(sessionFile).includes(value);
}

function countRequests() {
	return text(providerCount).trim().split("\n").filter(Boolean).length;
}

async function waitFor(predicate, label, timeoutMs = 60_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		if (ptyExited) {
			throw new Error(`PTY exited while waiting for ${label}: ${JSON.stringify(ptyExit)}`);
		}
		await sleep(100);
	}
	throw new Error(`Timed out waiting for ${label}`);
}

function shellQuote(value) {
	return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function windowsQuote(value) {
	if (/^[a-zA-Z0-9_./:\\-]+$/.test(value)) return value;
	return `"${value.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/g, "$1$1")}"`;
}

function ensurePtyHelperExecutable() {
	if (process.platform === "win32") return;
	const ptyRoot = dirname(dirname(require.resolve("node-pty")));
	const helper = join(ptyRoot, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
	try {
		chmodSync(helper, 0o755);
	} catch {
		// The package may already provide an executable helper.
	}
}

function findPiCommand() {
	const configured = process.env.PI_E2E_REAL_PI;
	if (configured) return configured;
	try {
		const locator = process.platform === "win32" ? "where.exe" : "which";
		const result = execFileSync(locator, ["pi"], { encoding: "utf8" });
		const candidates = result.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
		if (candidates[0]) return candidates[0];
	} catch {
		// Let the wrapper report the normal command-not-found failure.
	}
	return "pi";
}

function writeWrapper(realPi) {
	mkdirSync(binDir, { recursive: true });
	mkdirSync(agentDir, { recursive: true });

	if (process.platform === "win32") {
		const wrapper = join(binDir, "pi.cmd");
		writeFileSync(wrapper, `@echo off
set "marker=%PI_AUTO_UPGRADE%"
if not defined marker set "marker=0"
>>"${invocationLog}" echo restart=%marker% args=%*
if "%~1"=="--version" (
  if "%marker%"=="1" (echo 0.87.0) else (echo 0.88.0)
  exit /b 0
)
if "%marker%"=="1" (
  call "${realPi}" %* 2>>"${restartErrorLog}"
  set "status=%ERRORLEVEL%"
  >>"${invocationLog}" echo child-exit=%status%
  exit /b %status%
)
"${realPi}" %*
`);
		return;
	}

	const wrapper = join(binDir, "pi");
	writeFileSync(wrapper, `#!/bin/sh
set -eu
marker=\${PI_AUTO_UPGRADE:-0}
printf 'restart=%s args=%s\\n' "\$marker" "\$*" >> ${shellQuote(invocationLog)}
if [ "\${1:-}" = "--version" ]; then
  if [ "\$marker" = "1" ]; then echo "0.87.0"; else echo "0.88.0"; fi
  exit 0
fi
exec ${shellQuote(realPi)} "\$@"
`);
	chmodSync(wrapper, 0o755);
}

const server = createServer((request, response) => {
	if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
		response.writeHead(404).end();
		return;
	}
	request.resume();
	request.once("end", () => {
		appendFileSync(providerCount, "1\n", "utf8");
		response.writeHead(200, {
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
			"Content-Type": "text/event-stream",
		});
		const id = `host-e2e-${Date.now()}`;
		const chunk = (delta, finishReason = null) => ({
			id,
			object: "chat.completion.chunk",
			created: Math.floor(Date.now() / 1000),
			model: "fake",
			choices: [{ index: 0, delta, finish_reason: finishReason }],
		});
		response.write(`data: ${JSON.stringify(chunk({ role: "assistant", content: "E2E_OK" }))}\n\n`);
		response.write(`data: ${JSON.stringify(chunk({}, "stop"))}\n\n`);
		response.write("data: [DONE]\n\n");
		response.end();
	});
});

try {
	rmSync(tempRoot, { recursive: true, force: true });
	const realPi = findPiCommand();
	writeWrapper(realPi);
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(3210, "127.0.0.1", resolve);
	});
	serverStarted = true;

	const environment = { ...process.env };
	const pathValue = `${binDir}${delimiter}${process.env.PATH ?? process.env.Path ?? ""}`;
	if (process.platform === "win32") {
		environment.Path = pathValue;
	} else {
		environment.PATH = pathValue;
	}
	environment.PI_AGENT_DIR = agentDir;
	environment.PI_AUTO_UPGRADE_DEBUG = "1";
	environment.PI_AUTO_UPGRADE_DEBUG_FILE = handoffLog;
	environment.PI_E2E_RESTART_STDERR = restartErrorLog;
	environment.PI_E2E_RESUMED_MARKER = resumedMarker;
	environment.PI_OFFLINE = "1";
	environment.TERM = "xterm-256color";

	ensurePtyHelperExecutable();
	const shell = process.platform === "win32" ? (environment.ComSpec ?? "cmd.exe") : (environment.SHELL ?? "/bin/sh");
	const shellArgs = process.platform === "win32" ? ["/d"] : ["-i"];
	ptyProcess = pty.spawn(shell, shellArgs, {
		name: "xterm-256color",
		cols: 120,
		rows: 40,
		cwd: repositoryRoot,
		env: environment,
		...(process.platform === "win32" ? { useConpty: true } : {}),
	});
	ptyProcess.onData((data) => {
		output = `${output}${data}`.slice(-100_000);
	});
	ptyProcess.onExit((event) => {
		ptyExited = true;
		ptyExit = event;
	});

	const args = [
		"--extension", packageRoot,
		"--extension", join(packageRoot, "e2e", "fake-provider.ts"),
		"--extension", join(packageRoot, "e2e", "session-marker.ts"),
		"--model", "e2e/fake",
		"--session", sessionFile,
		"--tui-mode", "regular",
		"run the host terminal restart test",
	];
	const quote = process.platform === "win32" ? windowsQuote : shellQuote;
	const command = ["pi", ...args].map(quote).join(" ");
	await sleep(100);
	ptyProcess.write(`${command}\r`);

	await waitFor(() => text(invocationLog).includes("restart=0 args=--version"), "the version probe");
	await waitFor(
		() => text(invocationLog).includes("restart=1 args=") && text(resumedMarker).startsWith(sessionFile),
		"the replacement Pi",
	);
	ptyProcess.write("k");
	ptyProcess.write("eyboard-after-restart");
	ptyProcess.write("\r");
	await waitFor(() => countRequests() >= 2 && hasSessionContent("keyboard-after-restart"), "keyboard input after restart");
	if (ptyExited) throw new Error(`replacement PTY exited: ${JSON.stringify(ptyExit)}`);
	console.log(`Host ${process.platform} PTY: Pi restarted and accepted keyboard input.`);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	console.error(`invocations:\n${text(invocationLog)}`);
	console.error(`handoff:\n${text(handoffLog)}`);
	console.error(`restart-stderr:\n${text(restartErrorLog)}`);
	console.error(`resumed-marker:\n${text(resumedMarker)}`);
	console.error(`session:\n${text(sessionFile)}`);
	console.error(`pty-output:\n${output}`);
	process.exitCode = 1;
} finally {
	if (ptyProcess && !ptyExited) {
		try {
			ptyProcess.kill();
		} catch {
			// The PTY may already have exited during failure cleanup.
		}
	}
	if (serverStarted) server.close();
	rmSync(tempRoot, { recursive: true, force: true });
}
