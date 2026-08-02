#!/usr/bin/env node
/**
 * Copies the Starter template into a new Mini App.
 *
 * Renaming is the error-prone part of "start from the template": the app id
 * appears in the directory name, the manifest, the SQLite filename, the table
 * name, the CSS class prefix and every DOM id. Doing it by hand leaves one
 * behind, and the failure shows up as a load error after a service restart.
 *
 *   node scaffold.mjs <app-id> "<Display Name>" <target-dir>
 *
 * The target directory must not exist: this script creates apps, it never
 * overwrites one. Upgrading an installed app is a deliberate replace through
 * the Mini Apps manager, not a scaffold.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ID_PATTERN = /^[a-z][a-z0-9-]{1,62}$/;
const TEMPLATE_ID = "starter";
const TEMPLATE_NAME = "Starter";

const [appId, displayName, targetArg] = process.argv.slice(2);

if (!appId || !displayName || !targetArg) {
  fail(`Usage: node scaffold.mjs <app-id> "<Display Name>" <target-dir>

Example:
  node scaffold.mjs expenses "Expenses" ~/.molibot/miniapps/apps/expenses`);
}

if (!APP_ID_PATTERN.test(appId)) {
  fail(`Invalid app id "${appId}". Must match ${APP_ID_PATTERN} — lowercase letters, digits and hyphens.`);
}

const templateDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "template");
const targetDir = path.resolve(expandHome(targetArg));

if (!fs.existsSync(path.join(templateDir, "manifest.json"))) {
  fail(`Template not found at ${templateDir}.`);
}
if (fs.existsSync(targetDir)) {
  fail(`${targetDir} already exists. Pick a new directory — this script never overwrites an app.`);
}

// The host requires the directory name to equal the manifest id; catching it
// here is far cheaper than an error row after a restart.
const targetName = path.basename(targetDir);
if (targetName !== appId) {
  fail(`The directory name must equal the app id: expected ".../${appId}", got ".../${targetName}".`);
}

// A CSS-class / DOM-id prefix cannot start with a digit or contain a leading
// hyphen run; the app id pattern already guarantees a leading letter.
const classPrefix = appId;

copyTree(templateDir, targetDir);

console.log(`Created ${targetDir}`);
console.log(`
Next:
  1. Edit server/index.mjs — SCHEMA and the Store class are your domain model.
  2. Keep manifest.json tools and the \`tools\` handlers exactly in sync.
  3. Give every tool keywords in every language your users speak.
  4. Restart Molibot (V1 has no hot reload), then open the panel cold.`);

function copyTree(sourceDir, destinationDir) {
  fs.mkdirSync(destinationDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name);
    const destination = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      copyTree(source, destination);
      continue;
    }
    if (!entry.isFile()) continue;
    if (isTextFile(entry.name)) {
      fs.writeFileSync(destination, rename(fs.readFileSync(source, "utf8")), "utf8");
    } else {
      fs.copyFileSync(source, destination);
    }
  }
}

/**
 * Replaces the template identifiers. Case matters: `starter` is the id, the
 * table prefix and the class prefix, while `Starter` is only ever display copy.
 */
function rename(content) {
  return content
    .replaceAll(TEMPLATE_ID, classPrefix)
    .replaceAll(TEMPLATE_NAME, displayName);
}

function isTextFile(name) {
  return /\.(json|mjs|js|html|css|svg|md)$/i.test(name);
}

function expandHome(value) {
  return value.startsWith("~/") ? path.join(process.env.HOME ?? "", value.slice(2)) : value;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
