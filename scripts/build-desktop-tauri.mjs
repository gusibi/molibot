import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
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

const result = spawnSync("tauri", args, {
  cwd: path.join(repositoryRoot, "apps/desktop"),
  env: process.env,
  stdio: "inherit"
});

if (result.status !== 0) {
  throw new Error(`tauri ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
}
