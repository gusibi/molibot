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
const NODE_TARGETS = {
  "aarch64-apple-darwin": {
    nodeArch: "arm64",
    binarySuffix: "aarch64-apple-darwin",
    sha256: "fb526811860f81dcac7dd8b2b55eca4accfc5d61c3b7c2508f2639faee8a738d"
  },
  "x86_64-apple-darwin": {
    nodeArch: "x64",
    binarySuffix: "x86_64-apple-darwin",
    sha256: "efeec6641a2f15f5396d27cd0b32f5062d6689d1e9e5d89607d0b29bda890233"
  }
};
const buildTarget = String(process.env.TAURI_BUILD_TARGET ?? "").trim()
  || (process.arch === "x64" ? "x86_64-apple-darwin" : "aarch64-apple-darwin");
const nodeTarget = NODE_TARGETS[buildTarget];
if (!nodeTarget) {
  throw new Error(`Unsupported Desktop build target: ${buildTarget}`);
}
const NODE_ARCHIVE = `node-v${NODE_VERSION}-darwin-${nodeTarget.nodeArch}.tar.xz`;
const NODE_ARCHIVE_SHA256 = nodeTarget.sha256;
const NODE_DOWNLOAD_URL = `https://nodejs.org/download/release/v${NODE_VERSION}/${NODE_ARCHIVE}`;

// The agent's `grep`/`find` tools shell out to ripgrep/fd. pi downloads those
// from GitHub on first use, which `PI_OFFLINE=1` deliberately disables (see
// `src/lib/server/app/env.ts`), and the Desktop app has no system package
// manager to install them from the way the Docker image does. So they are
// pinned and checksummed here at build time, exactly like the Node runtime
// above, and shipped inside the app bundle; `supervisor.rs` puts their
// directory on the spawned runtime's PATH, where pi's `getToolPath` finds them.
const toolArch = buildTarget.split("-")[0];
const SEARCH_TOOLS = [
  {
    binaryName: "rg",
    version: "14.1.1",
    archiveStem: (version) => `ripgrep-${version}-${toolArch}-apple-darwin`,
    downloadUrl: (version, archive) =>
      `https://github.com/BurntSushi/ripgrep/releases/download/${version}/${archive}`,
    sha256: {
      aarch64: "24ad76777745fbff131c8fbc466742b011f925bfa4fffa2ded6def23b5b937be",
      x86_64: "fc87e78f7cb3fea12d69072e7ef3b21509754717b746368fd40d88963630e2b3"
    }
  },
  {
    // 10.3.0 is the last fd release with a published x86_64-apple-darwin asset;
    // pi pins that same version for the target in its own downloader.
    binaryName: "fd",
    version: "10.3.0",
    archiveStem: (version) => `fd-v${version}-${toolArch}-apple-darwin`,
    downloadUrl: (version, archive) =>
      `https://github.com/sharkdp/fd/releases/download/v${version}/${archive}`,
    sha256: {
      aarch64: "0570263812089120bc2a5d84f9e65cd0c25e4a4d724c80075c357239c74ae904",
      x86_64: "50d30f13fe3d5914b14c4fff5abcbd4d0cdab4b855970a6956f4f006c17117a3"
    }
  }
];

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = path.join(rootDir, "apps/desktop/src-tauri");
const cacheDir = path.join(rootDir, ".cache/desktop-runtime");
const archivePath = path.join(cacheDir, NODE_ARCHIVE);
const extractDir = path.join(cacheDir, `node-v${NODE_VERSION}-darwin-${nodeTarget.nodeArch}`);
const nodeBinaryPath = path.join(tauriDir, `binaries/molibot-node-${nodeTarget.binarySuffix}`);
const searchToolBinaryPath = (binaryName) =>
  path.join(tauriDir, `binaries/molibot-${binaryName}-${nodeTarget.binarySuffix}`);
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

// Downloads are only ever accepted against a pinned checksum, so a compromised
// or moved release asset fails the build instead of shipping in the bundle.
async function ensureArchive(label, url, destination, expectedSha256) {
  if (existsSync(destination) && sha256(destination) === expectedSha256) return;
  mkdirSync(path.dirname(destination), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${label} download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== expectedSha256) {
    throw new Error(`${label} archive checksum mismatch: expected ${expectedSha256}, received ${digest}`);
  }
  writeFileSync(destination, bytes, { mode: 0o600 });
}

async function prepareSearchTool(tool) {
  const expectedSha256 = tool.sha256[toolArch];
  if (!expectedSha256) {
    throw new Error(`No pinned ${tool.binaryName} checksum for Desktop build target: ${buildTarget}`);
  }
  const stem = tool.archiveStem(tool.version);
  const archiveName = `${stem}.tar.gz`;
  const toolArchivePath = path.join(cacheDir, archiveName);
  await ensureArchive(
    tool.binaryName,
    tool.downloadUrl(tool.version, archiveName),
    toolArchivePath,
    expectedSha256
  );
  const toolExtractDir = path.join(cacheDir, stem);
  rmSync(toolExtractDir, { recursive: true, force: true });
  mkdirSync(toolExtractDir, { recursive: true });
  run("tar", [
    "-xzf",
    toolArchivePath,
    "-C",
    toolExtractDir,
    "--strip-components=1",
    `${stem}/${tool.binaryName}`
  ]);
  const destination = searchToolBinaryPath(tool.binaryName);
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(path.join(toolExtractDir, tool.binaryName), destination);
  chmodSync(destination, 0o755);
  return destination;
}

async function prepareSearchTools() {
  const staged = [];
  for (const tool of SEARCH_TOOLS) {
    staged.push(await prepareSearchTool(tool));
  }
  return staged;
}

async function prepareNodeBinary() {
  await ensureArchive("Node", NODE_DOWNLOAD_URL, archivePath, NODE_ARCHIVE_SHA256);
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  run("tar", [
    "-xJf",
    archivePath,
    "-C",
    extractDir,
    "--strip-components=2",
    `node-v${NODE_VERSION}-darwin-${nodeTarget.nodeArch}/bin/node`
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
const searchToolPaths = await prepareSearchTools();
prepareRuntime();
console.log(`Desktop Node runtime prepared: Node ${NODE_VERSION}`);
console.log(`Build target: ${buildTarget}`);
console.log(`Node binary: ${path.relative(rootDir, nodeBinaryPath)}`);
for (const [index, toolPath] of searchToolPaths.entries()) {
  const tool = SEARCH_TOOLS[index];
  console.log(`Search tool: ${tool.binaryName} ${tool.version} -> ${path.relative(rootDir, toolPath)}`);
}
console.log(`Runtime resources: ${path.relative(rootDir, runtimeDir)}`);
console.log(`Runtime archive: ${path.relative(rootDir, runtimeArchivePath)}`);
