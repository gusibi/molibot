#!/usr/bin/env node
import path from "node:path";
import { validatePluginCandidate } from "../src/lib/server/plugins/contract/validateCandidate.js";

const target = process.argv[2] || process.cwd();
const resolved = path.resolve(target);

console.log(`Validating plugin manifest at: ${resolved}`);
const result = validatePluginCandidate(resolved);

if (result.ok) {
  console.log(`\x1b[32m✔ Plugin manifest is valid!\x1b[0m`);
  console.log(`  ID: ${result.value.manifest.id}`);
  console.log(`  Name: ${result.value.manifest.name}`);
  console.log(`  Version: ${result.value.manifest.version}`);
  console.log(`  Settings mode: ${result.value.manifest.settings?.mode || "none"}`);
  process.exit(0);
} else {
  console.error(`\x1b[31m✖ Validation failed:\x1b[0m ${result.error}`);
  process.exit(1);
}
