import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDir, "..");

/** Build executable artifacts that are shipped inside bundled plugin packages. */
export async function buildPluginPackages(rootDir = defaultRoot) {
  const packageDir = path.join(rootDir, "package", "external-subagent");
  await build({
    entryPoints: [path.join(packageDir, "runtime.mjs")],
    outfile: path.join(packageDir, "dist", "runtime.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    banner: {
      js: 'import { createRequire as __molibotCreateRequire } from "node:module"; const require = __molibotCreateRequire(import.meta.url);'
    },
    sourcemap: false,
    logLevel: "silent"
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildPluginPackages();
}
