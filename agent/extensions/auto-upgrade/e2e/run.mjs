import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const dockerfile = join(packageRoot, "e2e", "Dockerfile");
const tag = `auto-upgrade-e2e:${process.pid}`;
const workspace = readFileSync(join(packageRoot, "..", "pnpm-workspace.yaml"), "utf8");
const versionMatch = workspace.match(/"@earendil-works\/pi-coding-agent":\s+([^\s#]+)/);
if (!versionMatch) throw new Error("Could not find the pinned pi-coding-agent version");
const piVersion = versionMatch[1];
const semverMatch = piVersion.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
if (!semverMatch) throw new Error(`E2E requires an exact semver pin, got ${piVersion}`);
const runtimeVersion = piVersion === "0.85.1" ? "0.84.4" : "0.85.1";

function run(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: "inherit" });
		child.once("error", reject);
		child.once("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
	});
}

const buildCode = await run("docker", [
	"build",
	"--build-arg",
	`PI_VERSION=${piVersion}`,
	"--build-arg",
	`PI_RUNTIME_VERSION=${runtimeVersion}`,
	"--tag",
	tag,
	"--file",
	dockerfile,
	packageRoot,
]);
if (buildCode !== 0) process.exit(buildCode);

let testCode;
try {
	testCode = await run("docker", ["run", "--rm", "--init", "--network", "none", tag]);
} finally {
	await run("docker", ["image", "rm", tag]);
}
process.exit(testCode);
