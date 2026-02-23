#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const command = args[0] ?? "dev";
const passthrough = args.slice(1);

const scriptMap = new Map([
  ["dev", "dev"],
  ["start", "start"],
  ["build", "build"],
  ["cli", "cli"]
]);

function printHelp() {
  process.stdout.write(
    [
      "molibot command",
      "",
      "Usage:",
      "  molibot            # start dev mode (same as npm run dev)",
      "  molibot dev",
      "  molibot start",
      "  molibot build",
      "  molibot cli",
      "",
      "Examples:",
      "  npm link",
      "  molibot",
      "  molibot cli"
    ].join("\n") + "\n"
  );
}

if (command === "help" || command === "--help" || command === "-h") {
  printHelp();
  process.exit(0);
}

const script = scriptMap.get(command);
if (!script) {
  process.stderr.write(`Unknown command: ${command}\n`);
  printHelp();
  process.exit(1);
}

const npmArgs = passthrough.length > 0 ? ["run", script, "--", ...passthrough] : ["run", script];
const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", npmArgs, {
  cwd: rootDir,
  stdio: "inherit",
  env: process.env
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
