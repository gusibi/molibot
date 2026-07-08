import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopPackagePath = path.join(repositoryRoot, "apps/desktop/package.json");

export function desktopArchFromTarget(target = process.env.TAURI_BUILD_TARGET ?? "") {
  if (target.includes("x86_64")) return "x86_64";
  if (target.includes("aarch64")) return "aarch64";
  return process.arch === "x64" ? "x86_64" : "aarch64";
}

export function defaultDmgDirectory(target = process.env.TAURI_BUILD_TARGET ?? "") {
  const targetPart = String(target).trim();
  return path.join(
    repositoryRoot,
    "apps/desktop/src-tauri/target",
    ...(targetPart ? [targetPart] : []),
    "release/bundle/dmg"
  );
}

export async function findDmgPath(directory = defaultDmgDirectory()) {
  const entries = await readdir(directory);
  const dmgFiles = entries.filter((entry) => entry.endsWith(".dmg")).sort();
  if (dmgFiles.length === 0) {
    throw new Error(`No Desktop DMG found under ${directory}`);
  }
  return path.join(directory, dmgFiles[0]);
}

export async function desktopVersion() {
  const packageInfo = JSON.parse(await readFile(desktopPackagePath, "utf8"));
  return String(packageInfo.version ?? "").trim();
}

export function releaseDmgName(version, arch = desktopArchFromTarget()) {
  return `Molibot_${version}_${arch}.dmg`;
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export async function writeDesktopReleaseChecksum(dmgPath) {
  if (!dmgPath) throw new Error("Desktop DMG path is required");
  const metadata = await stat(dmgPath);
  if (!metadata.isFile() || metadata.size === 0) {
    throw new Error(`Desktop DMG is missing or empty: ${dmgPath}`);
  }

  const digest = await sha256File(dmgPath);
  const checksumPath = `${dmgPath}.sha256`;
  await writeFile(checksumPath, `${digest}  ${path.basename(dmgPath)}\n`, "utf8");
  return { checksumPath, digest };
}

export async function finalizeDesktopRelease(options = {}) {
  const version = options.version ?? await desktopVersion();
  const arch = options.arch ?? desktopArchFromTarget(options.target);
  const originalPath = options.dmgPath ?? await findDmgPath(options.directory ?? defaultDmgDirectory(options.target));
  const finalPath = path.join(path.dirname(originalPath), releaseDmgName(version, arch));
  if (path.basename(originalPath) !== path.basename(finalPath)) {
    await rename(originalPath, finalPath);
  }
  return { dmgPath: finalPath, ...(await writeDesktopReleaseChecksum(finalPath)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await finalizeDesktopRelease();
  console.log(`Desktop DMG SHA-256: ${result.digest}`);
  console.log(`DMG file: ${path.relative(repositoryRoot, result.dmgPath)}`);
  console.log(`Checksum file: ${path.relative(repositoryRoot, result.checksumPath)}`);
}
