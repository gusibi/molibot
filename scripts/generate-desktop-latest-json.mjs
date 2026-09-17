import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopPackagePath = path.join(repositoryRoot, "apps/desktop/package.json");

export async function findPlatformFiles(directory) {
  const results = [];
  async function scan(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scan(full);
      } else if (entry.isFile() && entry.name.startsWith("updater-platform-") && entry.name.endsWith(".json")) {
        results.push(full);
      }
    }
  }
  await scan(directory);
  return results.sort();
}

export async function desktopVersion() {
  const packageInfo = JSON.parse(await readFile(desktopPackagePath, "utf8"));
  return String(packageInfo.version ?? "").trim();
}

export async function generateLatestJson(options = {}) {
  const version = options.version ?? await desktopVersion();
  const notes = options.notes ?? `Molibot ${version} release`;
  const pubDate = options.pubDate ?? new Date().toISOString();

  let platformFiles = options.platformFiles ?? [];
  if (platformFiles.length === 0 && options.artifactsDir) {
    platformFiles = await findPlatformFiles(options.artifactsDir);
  }

  const platforms = {};
  for (const file of platformFiles) {
    try {
      const data = JSON.parse(await readFile(file, "utf8"));
      if (data.platform && data.signature && data.url) {
        platforms[data.platform] = {
          signature: data.signature,
          url: data.url
        };
      }
    } catch (err) {
      console.warn(`Warning: failed to read platform file ${file}:`, err);
    }
  }

  const manifest = {
    version: version.startsWith("v") ? version : `v${version}`,
    notes,
    pub_date: pubDate,
    platforms
  };

  if (options.outputPath) {
    await writeFile(options.outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }

  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  let artifactsDir = "";
  let outputPath = "latest.json";
  let version = "";
  let notes = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--artifacts" && args[i + 1]) {
      artifactsDir = args[++i];
    } else if (args[i] === "--out" && args[i + 1]) {
      outputPath = args[++i];
    } else if (args[i] === "--version" && args[i + 1]) {
      version = args[++i];
    } else if (args[i] === "--notes" && args[i + 1]) {
      notes = args[++i];
    }
  }

  // Never overwrite a (possibly good) published manifest with an empty one:
  // zero files or every file corrupt/missing fields must fail the release step
  // loudly instead of silently breaking all installed clients' update checks.
  const manifest = await generateLatestJson({
    artifactsDir: artifactsDir || undefined,
    version: version || undefined,
    notes: notes || undefined
  });

  if (Object.keys(manifest.platforms).length === 0) {
    console.error(`Refusing to write ${outputPath}: no valid updater-platform-*.json inputs found`);
    process.exit(1);
  }

  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Generated ${outputPath}:`);
  console.log(JSON.stringify(manifest, null, 2));
}
