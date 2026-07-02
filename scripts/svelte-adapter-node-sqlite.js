import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

export default function adapter(opts = {}) {
  const { out = "build", precompress = true, envPrefix = "" } = opts;

  return {
    name: "@sveltejs/adapter-node",
    async adapt(builder) {
      const tmp = builder.getBuildDirectory("adapter-node");

      builder.rimraf(out);
      builder.rimraf(tmp);
      builder.mkdirp(tmp);

      builder.log.minor("Copying assets");
      builder.writeClient(`${out}/client${builder.config.kit.paths.base}`);
      builder.writePrerendered(`${out}/prerendered${builder.config.kit.paths.base}`);

      if (precompress) {
        builder.log.minor("Compressing assets");
        await Promise.all([
          builder.compress(`${out}/client`),
          builder.compress(`${out}/prerendered`)
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
        dir: `${out}/server`,
        format: "esm",
        sourcemap: true,
        chunkFileNames: "chunks/[name]-[hash].js"
      });

      builder.copy(files, out, {
        replace: handlerReplacements(builder, envPrefix, precompress)
      });

      if (builder.hasServerInstrumentationFile?.()) {
        builder.instrument?.({
          entrypoint: `${out}/index.js`,
          instrumentation: `${out}/server/instrumentation.server.js`,
          module: {
            exports: ["path", "host", "port", "server"]
          }
        });
      }
    },
    supports: {
      read: () => true,
      instrumentation: () => true
    }
  };
}
