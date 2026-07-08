import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopPackagePath = path.join(repositoryRoot, "apps/desktop/package.json");
const tauriConfigPath = path.join(repositoryRoot, "apps/desktop/src-tauri/tauri.conf.json");
const cargoTomlPath = path.join(repositoryRoot, "apps/desktop/src-tauri/Cargo.toml");
const cargoLockPath = path.join(repositoryRoot, "apps/desktop/src-tauri/Cargo.lock");

export async function syncDesktopVersion() {
  const desktopPackage = JSON.parse(await readFile(desktopPackagePath, "utf8"));
  const version = String(desktopPackage.version ?? "").trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid Desktop package version: ${version || "<empty>"}`);
  }

  const tauriConfig = JSON.parse(await readFile(tauriConfigPath, "utf8"));
  tauriConfig.version = version;
  await writeFile(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`, "utf8");

  const cargoToml = await readFile(cargoTomlPath, "utf8");
  await writeFile(
    cargoTomlPath,
    cargoToml.replace(/^version = ".*"$/m, `version = "${version}"`),
    "utf8"
  );

  const cargoLock = await readFile(cargoLockPath, "utf8");
  await writeFile(
    cargoLockPath,
    cargoLock.replace(
      /(\[\[package\]\]\nname = "molibot-desktop"\nversion = ")[^"]+(")/,
      `$1${version}$2`
    ),
    "utf8"
  );

  return version;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  const version = await syncDesktopVersion();
  console.log(`Desktop version synced: ${version}`);
}
