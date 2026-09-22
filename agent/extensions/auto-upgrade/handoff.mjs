import { appendFileSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";

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
const debug = (message) => {
  if (process.env.PI_AUTO_UPGRADE_DEBUG === "1") {
    const path = process.env.PI_AUTO_UPGRADE_DEBUG_FILE ?? "/tmp/auto-upgrade-handoff.log";
    appendFileSync(path, `${new Date().toISOString()} ${message}\n`);
  }
};

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

const POSIX_TTY_REEXEC = [
  "import json, os, signal, sys",
  "config = json.loads(sys.argv[1])",
  "for signal_number in (signal.SIGTTOU, signal.SIGTTIN, signal.SIGTSTP):",
  "    signal.signal(signal_number, signal.SIG_IGN)",
  "try:",
  "    if os.isatty(0):",
  "        os.setpgid(0, os.tcgetpgrp(0))",
  "except OSError:",
  "    pass",
  "os.chdir(config['cwd'])",
  "os.execvpe(config['command'], [config['command'], *config['args']], os.environ)",
].join("\n");

function spawnPi() {
  const options = {
    cwd: config.cwd,
    env: { ...process.env, PI_AUTO_UPGRADE: "1" },
    stdio: "inherit",
  };

  if (process.platform !== "win32" && process.stdin.isTTY) {
    debug(`using python tty reexec pid=${process.pid} ppid=${process.ppid}`);
    return spawn(
      "python3",
      ["-c", POSIX_TTY_REEXEC, JSON.stringify({ command: config.command, args: config.args, cwd: config.cwd })],
      options,
    );
  }

  if (process.platform !== "win32" || !/\.(?:cmd|bat)$/i.test(config.command)) {
    debug(`using direct spawn command=${config.command}`);
    return spawn(config.command, config.args, options);
  }

  debug(`using shell spawn command=${config.command}`);
  return spawn(config.command, config.args, { ...options, shell: true });
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
debug(`parent exited; spawning command=${config.command} args=${JSON.stringify(config.args)}`);
const child = spawnPi();
child.once("error", (error) => {
  debug(`child error ${error.message}`);
  console.error(`auto-upgrade: could not start Pi: ${error.message}`);
  process.exit(1);
});
child.once("exit", (code, signal) => {
  debug(`child exit code=${code} signal=${signal ?? "none"}`);
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
