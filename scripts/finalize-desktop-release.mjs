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

export function desktopBuildTarget(target = process.env.TAURI_BUILD_TARGET ?? "") {
  const explicitTarget = String(target).trim();
  if (explicitTarget) return explicitTarget;
  return process.arch === "x64" ? "x86_64-apple-darwin" : "aarch64-apple-darwin";
}

export function defaultDmgDirectory(target = process.env.TAURI_BUILD_TARGET ?? "") {
  return path.join(
    repositoryRoot,
    "apps/desktop/src-tauri/target",
    desktopBuildTarget(target),
    "release/bundle/dmg"
  );
}

export function defaultMacosDirectory(target = process.env.TAURI_BUILD_TARGET ?? "") {
  return path.join(
    repositoryRoot,
    "apps/desktop/src-tauri/target",
    desktopBuildTarget(target),
    "release/bundle/macos"
  );
}

export function releaseUpdaterTarName(version, arch = desktopArchFromTarget()) {
  return `Molibot_${version}_${arch}.app.tar.gz`;
}

export function releaseUpdaterSigName(version, arch = desktopArchFromTarget()) {
  return `Molibot_${version}_${arch}.app.tar.gz.sig`;
}

export function releaseUpdaterPlatformName(arch = desktopArchFromTarget()) {
  return `updater-platform-${arch}.json`;
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
  const dmgResult = { dmgPath: finalPath, ...(await writeDesktopReleaseChecksum(finalPath)) };

  // Finalize updater artifacts if produced by tauri build
  const macosDir = options.macosDirectory ?? defaultMacosDirectory(options.target);
  let tarPath = null;
  let sigPath = null;
  let platformPath = null;

  try {
    const entries = await readdir(macosDir);
    const tarFile = entries.find((e) => (e.endsWith(".app.tar.gz") || e.endsWith(".tar.gz")) && !e.includes(version));
    if (tarFile) {
      const srcTar = path.join(macosDir, tarFile);
      const destTar = path.join(macosDir, releaseUpdaterTarName(version, arch));
      if (srcTar !== destTar) {
        await rename(srcTar, destTar);
      }
      tarPath = destTar;
    }

    const sigFile = entries.find((e) => e.endsWith(".tar.gz.sig") && !e.includes(version));
    if (sigFile) {
      const srcSig = path.join(macosDir, sigFile);
      const destSig = path.join(macosDir, releaseUpdaterSigName(version, arch));
      if (srcSig !== destSig) {
        await rename(srcSig, destSig);
      }
      sigPath = destSig;

      const signature = (await readFile(destSig, "utf8")).trim();
      const platformInfo = {
        version,
        arch,
        platform: arch === "aarch64" ? "darwin-aarch64" : "darwin-x86_64",
        signature,
        url: `https://github.com/gusibi/molibot/releases/download/v${version}/${path.basename(tarPath ?? releaseUpdaterTarName(version, arch))}`
      };
      platformPath = path.join(macosDir, releaseUpdaterPlatformName(arch));
      await writeFile(platformPath, `${JSON.stringify(platformInfo, null, 2)}\n`, "utf8");
    }
  } catch {
    // macosDir might not exist in unit tests or if updater artifacts weren't created
  }

  return { ...dmgResult, tarPath, sigPath, platformPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await finalizeDesktopRelease();
  console.log(`Desktop DMG SHA-256: ${result.digest}`);
  console.log(`DMG file: ${path.relative(repositoryRoot, result.dmgPath)}`);
  console.log(`Checksum file: ${path.relative(repositoryRoot, result.checksumPath)}`);
  if (result.tarPath) console.log(`Updater tarball: ${path.relative(repositoryRoot, result.tarPath)}`);
  if (result.sigPath) console.log(`Updater signature: ${path.relative(repositoryRoot, result.sigPath)}`);
  if (result.platformPath) console.log(`Updater platform manifest: ${path.relative(repositoryRoot, result.platformPath)}`);
}
