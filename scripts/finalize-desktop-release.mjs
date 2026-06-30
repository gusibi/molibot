import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultDmgPath = path.join(
  repositoryRoot,
  "apps/desktop/src-tauri/target/release/bundle/dmg/Molibot_0.1.0_aarch64.dmg",
);

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export async function writeDesktopReleaseChecksum(dmgPath = defaultDmgPath) {
  const metadata = await stat(dmgPath);
  if (!metadata.isFile() || metadata.size === 0) {
    throw new Error(`Desktop DMG is missing or empty: ${dmgPath}`);
  }

  const digest = await sha256File(dmgPath);
  const checksumPath = `${dmgPath}.sha256`;
  await writeFile(checksumPath, `${digest}  ${path.basename(dmgPath)}\n`, "utf8");
  return { checksumPath, digest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await writeDesktopReleaseChecksum();
  console.log(`Desktop DMG SHA-256: ${result.digest}`);
  console.log(`Checksum file: ${path.relative(repositoryRoot, result.checksumPath)}`);
}
