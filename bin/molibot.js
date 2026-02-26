#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultDataDir = join(os.homedir(), ".molibot");

const args = process.argv.slice(2);
const command = args[0] ?? "dev";
const passthrough = args.slice(1);

const scriptMap = new Map([
  ["dev", "dev"],
  ["start", "start"],
  ["build", "build"],
  ["cli", "cli"]
]);

function expandHomePath(input) {
  if (!input.startsWith("~")) return input;
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return join(os.homedir(), input.slice(2));
  return input;
}

function resolveDataDir() {
  const raw = (process.env.DATA_DIR ?? defaultDataDir).trim();
  return resolve(expandHomePath(raw || defaultDataDir));
}

function ensureEmptyFile(path) {
  if (existsSync(path)) return false;
  writeFileSync(path, "", "utf8");
  return true;
}

function runInit() {
  const dataDir = resolveDataDir();
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(dataDir, "skills"), { recursive: true });
  const defaultAgentsPath = join(rootDir, "src/lib/server/mom/prompts/AGENTS.default.md");
  const defaultAgentsContent = readFileSync(defaultAgentsPath, "utf8");

  const files = [
    "SOUL.md",
    "TOOLS.md",
    "BOOTSTRAP.md",
    "IDENTITY.md",
    "USER.md"
  ];

  const created = [];
  const agentsPath = join(dataDir, "AGENTS.md");
  if (ensureEmptyFile(agentsPath)) {
    writeFileSync(agentsPath, defaultAgentsContent, "utf8");
    created.push(agentsPath);
  }

  for (const file of files) {
    const path = join(dataDir, file);
    if (ensureEmptyFile(path)) {
      created.push(path);
    }
  }

  process.stdout.write(`Initialized: ${dataDir}\n`);
  if (created.length > 0) {
    process.stdout.write(`Created ${created.length} file(s):\n`);
    for (const path of created) {
      process.stdout.write(`- ${path}\n`);
    }
  } else {
    process.stdout.write("No new files created (already exist).\n");
  }
}

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
      "  molibot init",
      "",
      "Examples:",
      "  npm link",
      "  molibot",
      "  molibot cli",
      "  molibot init"
    ].join("\n") + "\n"
  );
}

if (command === "help" || command === "--help" || command === "-h") {
  printHelp();
  process.exit(0);
}

if (command === "init") {
  runInit();
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
