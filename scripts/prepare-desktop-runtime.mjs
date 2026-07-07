import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const NODE_VERSION = "22.23.1";
const NODE_ARCHIVE = `node-v${NODE_VERSION}-darwin-arm64.tar.xz`;
const NODE_ARCHIVE_SHA256 = "fb526811860f81dcac7dd8b2b55eca4accfc5d61c3b7c2508f2639faee8a738d";
const NODE_DOWNLOAD_URL = `https://nodejs.org/download/release/v${NODE_VERSION}/${NODE_ARCHIVE}`;

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = path.join(rootDir, "apps/desktop/src-tauri");
const cacheDir = path.join(rootDir, ".cache/desktop-runtime");
const archivePath = path.join(cacheDir, NODE_ARCHIVE);
const extractDir = path.join(cacheDir, `node-v${NODE_VERSION}`);
const nodeBinaryPath = path.join(tauriDir, "binaries/molibot-node-aarch64-apple-darwin");
const runtimeDir = path.join(tauriDir, "resources/molibot-runtime");
const runtimeArchivePath = path.join(tauriDir, "resources/molibot-runtime.tar.gz");
const runtimeVersionPath = path.join(tauriDir, "resources/molibot-runtime.version");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit",
    ...options
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
}

function sha256(pathname) {
  return createHash("sha256").update(readFileSync(pathname)).digest("hex");
}

async function ensureArchive() {
  if (existsSync(archivePath) && sha256(archivePath) === NODE_ARCHIVE_SHA256) return;
  mkdirSync(cacheDir, { recursive: true });
  const response = await fetch(NODE_DOWNLOAD_URL);
  if (!response.ok) throw new Error(`Node download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== NODE_ARCHIVE_SHA256) {
    throw new Error(`Node archive checksum mismatch: expected ${NODE_ARCHIVE_SHA256}, received ${digest}`);
  }
  writeFileSync(archivePath, bytes, { mode: 0o600 });
}

async function prepareNodeBinary() {
  await ensureArchive();
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  run("tar", [
    "-xJf",
    archivePath,
    "-C",
    extractDir,
    "--strip-components=2",
    `node-v${NODE_VERSION}-darwin-arm64/bin/node`
  ]);
  mkdirSync(path.dirname(nodeBinaryPath), { recursive: true });
  copyFileSync(path.join(extractDir, "node"), nodeBinaryPath);
  chmodSync(nodeBinaryPath, 0o755);
}

function prepareRuntime() {
  run("npm", ["run", "build"]);
  run("bash", ["bin/molibot-release.sh", runtimeDir], {
    env: { ...process.env, MOLIBOT_RELEASE_SKIP_BUILD: "1" }
  });
  rmSync(runtimeArchivePath, { force: true });
  run("tar", ["-czf", runtimeArchivePath, "-C", path.dirname(runtimeDir), path.basename(runtimeDir)]);
  const packageInfo = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
  writeFileSync(runtimeVersionPath, `${packageInfo.version}\n`, "utf8");
}

await prepareNodeBinary();
prepareRuntime();
console.log(`Desktop Node runtime prepared: Node ${NODE_VERSION}`);
console.log(`Node binary: ${path.relative(rootDir, nodeBinaryPath)}`);
console.log(`Runtime resources: ${path.relative(rootDir, runtimeDir)}`);
console.log(`Runtime archive: ${path.relative(rootDir, runtimeArchivePath)}`);
