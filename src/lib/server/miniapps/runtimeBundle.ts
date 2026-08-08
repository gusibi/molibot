import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

export interface MiniAppRuntimeBundleOptions {
  appId: string;
  entryPath: string;
  cacheRoot: string;
}

export interface MiniAppRuntimeBundle {
  contentHash: string;
  filePath: string;
  moduleUrl: string;
}

/**
 * Bundles one Mini App's relative server-module graph into a content-addressed
 * ESM file. App-local packages are included so moving the generated module into
 * the host cache does not change package resolution; Node built-ins stay
 * external under esbuild's Node platform.
 *
 * The content hash gives changed code a new file URL. The activation query is
 * deliberately unique even when the bytes are identical: reinstalling an app
 * must create a fresh top-level module scope after the old runtime is disposed.
 */
export async function bundleMiniAppRuntime(options: MiniAppRuntimeBundleOptions): Promise<MiniAppRuntimeBundle> {
  const result = await build({
    entryPoints: [options.entryPath],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    write: false,
    legalComments: "none",
    sourcemap: false,
    logLevel: "silent"
  });
  const output = result.outputFiles[0];
  if (!output) throw new Error("Mini App runtime bundle produced no output.");

  const contentHash = createHash("sha256").update(output.contents).digest("hex").slice(0, 24);
  const appCacheDir = path.join(options.cacheRoot, options.appId);
  const filePath = path.join(appCacheDir, `${contentHash}.mjs`);
  fs.mkdirSync(appCacheDir, { recursive: true });
  if (!fs.existsSync(filePath)) {
    const staging = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(staging, output.contents, { flag: "wx" });
      fs.renameSync(staging, filePath);
    } catch (cause) {
      fs.rmSync(staging, { force: true });
      // Another concurrent activation may have won the same content-addressed
      // filename. That is success when the final immutable file exists.
      if (!fs.existsSync(filePath)) throw cause;
    }
  }
  return {
    contentHash,
    filePath,
    moduleUrl: `${pathToFileURL(filePath).href}?activation=${randomUUID()}`
  };
}
