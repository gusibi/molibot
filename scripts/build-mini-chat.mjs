import {build} from "esbuild";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(root, "src/lib/server/miniapps/builtin/mini-chat/ui-src");
const outputDir = path.join(root, "src/lib/server/miniapps/builtin/mini-chat/ui");

fs.mkdirSync(outputDir, { recursive: true });
await build({
  entryPoints: [path.join(sourceDir, "main.tsx")],
  outfile: path.join(outputDir, "app.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome120"],
  minify: true,
  legalComments: "eof",
  jsx: "automatic"
});

const css = [
  fs.readFileSync(path.join(root, "node_modules/@astryxdesign/core/src/reset.css"), "utf8"),
  fs.readFileSync(path.join(root, "node_modules/@astryxdesign/core/dist/astryx.css"), "utf8"),
  fs.readFileSync(path.join(root, "node_modules/@astryxdesign/theme-neutral/dist/theme.css"), "utf8")
].join("\n");
fs.writeFileSync(path.join(outputDir, "astryx.css"), css, "utf8");
fs.copyFileSync(path.join(sourceDir, "styles.css"), path.join(outputDir, "styles.css"));
