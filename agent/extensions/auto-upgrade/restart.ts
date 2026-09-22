import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const RESTART_POLL_INTERVAL_MS = 250;

const CORE_PACKAGE_NAME = "@earendil-works/pi-coding-agent";
const CORE_PACKAGE_PATH = /@earendil-works\+pi-coding-agent@([^/\\_]+)/;

function packageVersionFromExecutable(executablePath: string | undefined): string | undefined {
	if (!executablePath) return undefined;
	let directory = dirname(executablePath);
	for (let depth = 0; depth < 8; depth += 1) {
		try {
			const packageJson = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
				name?: unknown;
				version?: unknown;
			};
			if (packageJson.name === CORE_PACKAGE_NAME && typeof packageJson.version === "string") {
				return packageJson.version;
			}
		} catch {
			// The executable may be inside a pruned pnpm package directory.
		}
		const parent = dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}
	return CORE_PACKAGE_PATH.exec(executablePath)?.[1];
}

export function detectLoadedPiVersion(executablePath: string | undefined, fallback: string): string {
	return packageVersionFromExecutable(executablePath) ?? fallback;
}

const VALUE_OPTIONS = new Set([
	"--provider",
	"--model",
	"--api-key",
	"--thinking",
	"--models",
	"--session-dir",
	"--name",
	"-n",
	"--tools",
	"-t",
	"--exclude-tools",
	"-xt",
	"--extension",
	"-e",
	"--skill",
	"--prompt-template",
	"--theme",
	"--system-prompt",
	"--append-system-prompt",
	"--tui-mode",
	"--use-theme",
	"--mode",
	"--export",
]);

const SESSION_OPTIONS_WITHOUT_VALUE = new Set(["-c", "--continue", "-r", "--resume"]);
const SESSION_OPTIONS_WITH_VALUE = new Set(["--session", "--fork", "--clone"]);

export function parsePiVersion(output: string): string | undefined {
	const match = output.match(/(?:^|\s)v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)(?:\s|$)/m);
	return match?.[1];
}

export function isPiVersionChanged(loadedVersion: string, installedVersion: string | undefined): boolean {
	return installedVersion !== undefined && installedVersion !== loadedVersion;
}

/**
 * Keep startup options that describe the interactive process, but replace the
 * old session selector and discard an initial prompt that must not be replayed.
 */
export function buildRestartArgs(argv: readonly string[], sessionFile: string): string[] {
	const args: string[] = [];
	let noSession = false;

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--") {
			break;
		}
		if (arg === "--no-session") {
			noSession = true;
			continue;
		}
		if (SESSION_OPTIONS_WITHOUT_VALUE.has(arg)) {
			continue;
		}
		if (SESSION_OPTIONS_WITH_VALUE.has(arg)) {
			index += 1;
			continue;
		}
		if (arg.startsWith("--session=") || arg.startsWith("--fork=") || arg.startsWith("--clone=")) {
			continue;
		}
		if (!arg.startsWith("-")) {
			continue;
		}

		args.push(arg);
		if (VALUE_OPTIONS.has(arg) && index + 1 < argv.length) {
			args.push(argv[index + 1]);
			index += 1;
		}
	}

	if (sessionFile) {
		args.push("--session", sessionFile);
	} else if (noSession) {
		args.push("--no-session");
	}
	return args;
}
