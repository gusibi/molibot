import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { rollup } from "rollup";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";

const files = fileURLToPath(new URL("../node_modules/@sveltejs/adapter-node/files", import.meta.url).href);

export function handlerReplacements(builder, envPrefix, precompress) {
  return {
    ENV: "./env.js",
    HANDLER: "./handler.js",
    MANIFEST: "./server/manifest.js",
    SERVER: "./server/index.js",
    SHIMS: "./shims.js",
    ENV_PREFIX: JSON.stringify(envPrefix),
    PRECOMPRESS: JSON.stringify(precompress),
    BASE: JSON.stringify(builder.config.kit.paths.base),
    PRERENDERED: `new Set(${JSON.stringify(builder.prerendered.paths)})`
  };
}

function replaceFile(source, destination) {
  if (!existsSync(source)) return;
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
  copyFileSync(source, temporary);
  renameSync(temporary, destination);
}

export function publishBuild(stagedOut, out) {
  mkdirSync(out, { recursive: true });

  // A running server can lazy-load route chunks from its already-imported
  // manifest, so hashed chunks from the previous build must remain available.
  const stagedChunks = path.join(stagedOut, "server/chunks");
  if (existsSync(stagedChunks)) {
    cpSync(stagedChunks, path.join(out, "server/chunks"), { recursive: true });
  }

  const stagedManifest = path.resolve(stagedOut, "server/manifest.js");
  const stagedManifestMap = `${stagedManifest}.map`;
  cpSync(stagedOut, out, {
    recursive: true,
    filter: (source) => {
      const resolved = path.resolve(source);
      return resolved !== stagedManifest && resolved !== stagedManifestMap;
    }
  });

  replaceFile(stagedManifestMap, path.join(out, "server/manifest.js.map"));
  replaceFile(stagedManifest, path.join(out, "server/manifest.js"));
  rmSync(stagedOut, { recursive: true, force: true });
}

export default function adapter(opts = {}) {
  const { out = "build", precompress = true, envPrefix = "" } = opts;

  return {
    name: "@sveltejs/adapter-node",
    async adapt(builder) {
      const tmp = builder.getBuildDirectory("adapter-node");
      const stagedOut = builder.getBuildDirectory("adapter-node-output");

      builder.rimraf(tmp);
      builder.rimraf(stagedOut);
      builder.mkdirp(tmp);
      builder.mkdirp(stagedOut);

      builder.log.minor("Copying assets");
      builder.writeClient(`${stagedOut}/client${builder.config.kit.paths.base}`);
      builder.writePrerendered(`${stagedOut}/prerendered${builder.config.kit.paths.base}`);

      if (precompress) {
        builder.log.minor("Compressing assets");
        await Promise.all([
          builder.compress(`${stagedOut}/client`),
          builder.compress(`${stagedOut}/prerendered`)
        ]);
      }

      builder.log.minor("Building server");

      builder.writeServer(tmp);

      writeFileSync(
        `${tmp}/manifest.js`,
        [
          `export const manifest = ${builder.generateManifest({ relativePath: "./" })};`,
          `export const prerendered = new Set(${JSON.stringify(builder.prerendered.paths)});`,
          `export const base = ${JSON.stringify(builder.config.kit.paths.base)};`
        ].join("\n\n")
      );

      const pkg = JSON.parse(readFileSync("package.json", "utf8"));

      const input = {
        index: `${tmp}/index.js`,
        manifest: `${tmp}/manifest.js`
      };

      if (builder.hasServerInstrumentationFile?.()) {
        input["instrumentation.server"] = `${tmp}/instrumentation.server.js`;
      }

      const bundle = await rollup({
        input,
        external: [
          "node:sqlite",
          ...Object.keys(pkg.dependencies || {}).map((dependency) => new RegExp(`^${dependency}(\\/.*)?$`))
        ],
        plugins: [
          nodeResolve({
            preferBuiltins: true,
            exportConditions: ["node"]
          }),
          commonjs({ strictRequires: true }),
          json()
        ]
      });

      await bundle.write({
        dir: `${stagedOut}/server`,
        format: "esm",
        sourcemap: true,
        chunkFileNames: "chunks/[name]-[hash].js"
      });

      builder.copy(files, stagedOut, {
        replace: handlerReplacements(builder, envPrefix, precompress)
      });

      if (builder.hasServerInstrumentationFile?.()) {
        builder.instrument?.({
          entrypoint: `${stagedOut}/index.js`,
          instrumentation: `${stagedOut}/server/instrumentation.server.js`,
          module: {
            exports: ["path", "host", "port", "server"]
          }
        });
      }

      publishBuild(stagedOut, out);
    },
    supports: {
      read: () => true,
      instrumentation: () => true
    }
  };
}
