#!/usr/bin/env node
/**
 * `pnpm verify:feature` — run the checks this change needs.
 *
 * The entry point is deterministic and additive: it selects a scope from the
 * changed paths, always runs the base smoke set, and never removes what the
 * mapping chose. It only verifies — it does not modify code. Checks whose
 * environment is missing are reported as "未验证" and never counted as passing.
 *
 * See docs/requirements/feature-verification-spec.md.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { selectScope, uiGrepExpression, SMOKE_SUITES, SETTINGS_SUITES } from "./verify/selection.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(args) {
  const result = spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.split("\n").map(line => line.trim()).filter(Boolean);
}

function changedPaths() {
  const tracked = git(["diff", "--name-only", "HEAD", "--"]);
  const untracked = git(["ls-files", "--others", "--exclude-standard"]);
  return [...new Set([...tracked, ...untracked])].sort();
}

function parseArgs(argv) {
  const options = { appendedTags: [], skipUi: false, skipTypeCheck: false, dryRun: false };
  for (const arg of argv) {
    if (arg.startsWith("--tags=")) options.appendedTags.push(...arg.slice(7).split(",").map(t => t.trim()).filter(Boolean));
    else if (arg === "--skip-ui") options.skipUi = true;
    else if (arg === "--skip-typecheck") options.skipTypeCheck = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function run(label, command, args) {
  const started = Date.now();
  process.stdout.write(`\n▶ ${label}\n`);
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit" });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (result.status !== 0) return { ok: false, seconds, label };
  return { ok: true, seconds, label };
}

function coreTestFiles() {
  const files = git(["ls-files", "src"]);
  return files.filter(file => file.endsWith(".test.ts"));
}

/**
 * The native harness exists only once a test build with the Tauri driver is
 * present and an isolated test application id is configured. Until then the
 * check is reported unverified rather than silently skipped.
 */
function nativeHarnessAvailable() {
  return process.env.MOLIBOT_NATIVE_TEST === "1"
    && existsSync(path.join(repoRoot, "tests/app/wdio.conf.ts"));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("usage: pnpm verify:feature [--tags=@a,@b] [--skip-ui] [--skip-typecheck] [--dry-run]");
    return 0;
  }

  const changed = changedPaths();
  const scope = selectScope(changed);
  const grep = uiGrepExpression(scope, options.appendedTags);

  console.log("verify:feature");
  console.log(`  changed paths: ${changed.length === 0 ? "(none)" : changed.join(", ")}`);
  console.log(`  matched rules: ${scope.matchedRules.length ? scope.matchedRules.join(", ") : "(none → conservative fallback)"}`);
  console.log(`  UI grep:       ${grep}`);
  console.log(`  full core:     ${scope.fullCore ? "yes" : "no"}`);
  console.log(`  native:        ${scope.native ? "required" : "not required"}`);
  if (options.dryRun) return 0;

  const results = [];
  const unavailable = [];

  if (!options.skipTypeCheck) {
    results.push(run("type check", "corepack", ["pnpm", "run", "check"]));
    if (changed.some(p => p.startsWith("apps/desktop/"))) {
      results.push(run("desktop type check", "corepack", ["pnpm", "run", "desktop:check"]));
    }
  }

  const nodeTests = scope.fullCore ? coreTestFiles() : [];
  const files = [...new Set([...SMOKE_SUITES, ...(scope.settingsRoundTrip ? SETTINGS_SUITES : []), ...nodeTests])];
  results.push(run(
    scope.fullCore ? `logic/API tests (full core, ${files.length} files)` : `logic/API smoke (${files.length} files)`,
    process.execPath,
    ["--import", "./scripts/register-loader.js", "--import", "tsx", "--test", ...files]
  ));

  if (changed.some(p => p.startsWith("apps/desktop/")) && existsSync(path.join(repoRoot, "apps/desktop/package.json"))) {
    results.push(run("desktop unit tests", "corepack", ["pnpm", "run", "desktop:test"]));
  }

  if (!options.skipUi) {
    results.push(run("browser UI (WebKit)", process.execPath, [
      "node_modules/@playwright/test/cli.js", "test",
      "--config", "tests/ui/playwright.config.ts", "--project=webkit", "-g", grep
    ]));
    results.push(run("browser UI smoke (Chromium)", process.execPath, [
      "node_modules/@playwright/test/cli.js", "test",
      "--config", "tests/ui/playwright.config.ts", "--project=chromium", "-g", "@smoke"
    ]));
  }

  if (scope.native) {
    if (nativeHarnessAvailable()) {
      results.push(run("native App tests", process.execPath, ["scripts/verify/native.mjs"]));
    } else {
      unavailable.push("原生 App 测试（需要带 Tauri 驱动的测试构建与测试应用标识；尚未建设）");
    }
  } else {
    results.push({ ok: true, seconds: "0.0", label: "native App tests (not required)" });
  }

  console.log("\n── verify:feature summary ──");
  let failed = false;
  for (const result of results) {
    const mark = result.ok ? "PASS" : "FAIL";
    if (!result.ok) failed = true;
    console.log(`  ${mark}  ${result.label} (${result.seconds}s)`);
  }
  for (const item of unavailable) console.log(`  未验证  ${item}（环境缺失，见上方原因；不计为通过）`);
  if (failed) {
    console.log("\nverify:feature failed. Fix the failing check and run it again.");
    return 1;
  }
  console.log("\nverify:feature passed." + (unavailable.length ? ` Unverified: ${unavailable.join(", ")}.` : ""));
  return 0;
}

main().then(code => process.exit(code)).catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
