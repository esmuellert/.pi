import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const [, , encodedConfig] = process.argv;
if (!encodedConfig) {
  console.error("auto-upgrade: missing handoff configuration");
  process.exit(2);
}

/** @type {{ parentPid: number, command: string, args: string[], cwd: string }} */
let config;
try {
  config = JSON.parse(encodedConfig);
} catch (error) {
  console.error(`auto-upgrade: invalid handoff configuration: ${String(error)}`);
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isZombie(pid) {
  if (process.platform !== "linux") return false;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const closeParen = stat.lastIndexOf(")");
    return stat.slice(closeParen + 2, closeParen + 3) === "Z";
  } catch {
    return false;
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return !isZombie(pid);
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function quoteWindowsArg(value) {
  if (value.length > 0 && /^[a-zA-Z0-9_./:\\-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/g, "$1$1")}"`;
}

function spawnPi() {
  const options = {
    cwd: config.cwd,
    env: { ...process.env, PI_AUTO_UPGRADE: "1" },
    stdio: "inherit",
  };

  if (process.platform !== "win32" || !/\.(?:cmd|bat)$/i.test(config.command)) {
    return spawn(config.command, config.args, options);
  }

  const commandLine = [
    "call",
    quoteWindowsArg(config.command),
    ...config.args.map(quoteWindowsArg),
  ].join(" ");
  return spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", commandLine], options);
}

const deadline = Date.now() + 15_000;
while (isAlive(config.parentPid) && Date.now() < deadline) {
  await sleep(50);
}

if (isAlive(config.parentPid)) {
  console.error("auto-upgrade: old Pi process did not exit; not starting a second session");
  process.exit(1);
}

await sleep(100);
const child = spawnPi();
child.once("error", (error) => {
  console.error(`auto-upgrade: could not start Pi: ${error.message}`);
  process.exit(1);
});
child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
