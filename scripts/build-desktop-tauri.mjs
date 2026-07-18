import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = String(process.env.TAURI_BUILD_TARGET ?? "").trim()
  || (process.arch === "x64" ? "x86_64-apple-darwin" : "aarch64-apple-darwin");
const binarySuffixByTarget = {
  "aarch64-apple-darwin": "aarch64-apple-darwin",
  "x86_64-apple-darwin": "x86_64-apple-darwin"
};
const binarySuffix = binarySuffixByTarget[target];
if (!binarySuffix) throw new Error(`Unsupported Desktop build target: ${target}`);

const desktopRoot = path.join(repositoryRoot, "apps/desktop");
const targetBundlePath = path.join(
  desktopRoot,
  "src-tauri/target",
  target,
  "release/bundle"
);
const bundleDmgPath = path.join(targetBundlePath, "dmg");
const appPath = path.join(targetBundlePath, "macos/Molibot.app");
const fallbackDmgPath = path.join(
  bundleDmgPath,
  `Molibot_${JSON.parse(readFileSync(path.join(desktopRoot, "package.json"), "utf8")).version}_${target.startsWith("x86_64") ? "x86_64" : "aarch64"}.dmg`
);
const baseConfigPath = path.join(repositoryRoot, "apps/desktop/src-tauri/tauri.bundle.conf.json");
const generatedConfigPath = path.join(repositoryRoot, "apps/desktop/src-tauri/tauri.bundle.generated.conf.json");
const bundleConfig = JSON.parse(readFileSync(baseConfigPath, "utf8"));
const resources = { ...(bundleConfig.bundle?.resources ?? {}) };
for (const key of Object.keys(resources)) {
  if (key.startsWith("binaries/molibot-node-")) delete resources[key];
}
resources[`binaries/molibot-node-${binarySuffix}`] = "molibot-node";
bundleConfig.bundle = { ...(bundleConfig.bundle ?? {}), resources };
writeFileSync(generatedConfigPath, `${JSON.stringify(bundleConfig, null, 2)}\n`, "utf8");

const args = [
  "build",
  "--ci",
  "--config",
  "src-tauri/tauri.bundle.generated.conf.json",
  "--target",
  target
];

const appResult = spawnSync("tauri", [...args, "--bundles", "app"], {
  cwd: desktopRoot,
  env: process.env,
  stdio: "inherit"
});

if (appResult.status !== 0) {
  throw new Error(`tauri ${args.join(" ")} --bundles app failed with exit code ${appResult.status ?? "unknown"}`);
}

const result = spawnSync("tauri", [...args, "--bundles", "dmg"], {
  cwd: desktopRoot,
  env: process.env,
  stdio: "inherit"
});

if (result.status === 0) process.exit(0);

const fallbackScriptPath = path.join(bundleDmgPath, "bundle_dmg.sh");
if (!existsSync(appPath) || !existsSync(fallbackScriptPath)) {
  throw new Error(`tauri ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
}
if (existsSync(fallbackDmgPath)) {
  rmSync(fallbackDmgPath);
}

const stagingDirectory = mkdtempSync(path.join(os.tmpdir(), "molibot-dmg-"));
try {
  cpSync(appPath, path.join(stagingDirectory, "Molibot.app"), { recursive: true });
  const fallback = spawnSync(
    "bash",
    [
      fallbackScriptPath,
      "--skip-jenkins",
      "--volname",
      "Molibot",
      "--volicon",
      path.join(bundleDmgPath, "icon.icns"),
      "--app-drop-link",
      "450",
      "250",
      fallbackDmgPath,
      stagingDirectory
    ],
    { cwd: desktopRoot, env: process.env, stdio: "inherit" }
  );
  if (fallback.status !== 0 || !existsSync(fallbackDmgPath)) {
    throw new Error(`Tauri DMG fallback failed with exit code ${fallback.status ?? "unknown"}`);
  }
  console.warn("Tauri Finder layout timed out; created a functional DMG without Finder icon positioning.");
} finally {
  rmSync(stagingDirectory, { recursive: true, force: true });
}
