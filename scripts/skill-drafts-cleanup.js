#!/usr/bin/env node
// Maintenance tool for legacy Skill Drafts polluted by the template-body-inlining
// bug (a real skill such as skill-creator mis-configured as the draft template
// got its entire body copied into every generated draft).
//
// Default mode is report-only: it scans every <data-dir>/**/skill-drafts/*.md,
// flags polluted drafts, and prints a summary. It NEVER deletes or moves files
// unless an explicit action flag is passed.
//
// Usage:
//   node scripts/skill-drafts-cleanup.js                 # report only
//   node scripts/skill-drafts-cleanup.js --json          # machine-readable report
//   node scripts/skill-drafts-cleanup.js --archive       # move polluted drafts to skill-drafts-archive/
//   DATA_DIR=/custom/root node scripts/skill-drafts-cleanup.js
//
// Data root resolution matches the app: DATA_DIR env, else ~/.molibot.

import { readdirSync, readFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");
const doArchive = args.has("--archive");

function dataRoot() {
  const fromEnv = process.env.DATA_DIR;
  if (fromEnv && fromEnv.trim()) {
    return fromEnv.startsWith("~") ? join(os.homedir(), fromEnv.slice(1).replace(/^\//, "")) : fromEnv;
  }
  return join(os.homedir(), ".molibot");
}

function findSkillDraftDirs(root, out) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(root, entry.name);
    if (entry.name === "skill-drafts") {
      out.push(full);
      continue;
    }
    findSkillDraftDirs(full, out);
  }
}

function frontmatterField(content, key) {
  const re = new RegExp(`^${key}\\s*:\\s*(.+)$`, "m");
  const match = content.match(re);
  return match ? match[1].trim() : "";
}

// Signature lines from the skill-creator SKILL.md body that should never appear
// inside a generated workflow draft.
const SKILL_CREATOR_BODY_SIGNATURES = [
  "A skill for creating new skills",
  "the process of creating a skill goes like this",
  "Anatomy of a Skill",
  "the skill creator is liable to be used"
];

function classify(content) {
  const templatePath = frontmatterField(content, "template_skill_path");
  const templateIsSkillCreator = /skill-creator/i.test(templatePath);
  const lower = content.toLowerCase();
  const bodyLeaked = SKILL_CREATOR_BODY_SIGNATURES.some((sig) => lower.includes(sig.toLowerCase()));
  return {
    templatePath,
    templateIsSkillCreator,
    bodyLeaked,
    polluted: bodyLeaked || templateIsSkillCreator
  };
}

const root = dataRoot();
const dirs = [];
findSkillDraftDirs(root, dirs);

const report = { root, totalDirs: dirs.length, total: 0, polluted: [], clean: 0, archived: [] };

for (const dir of dirs) {
  let files;
  try {
    files = readdirSync(dir, { withFileTypes: true });
  } catch {
    continue;
  }
  for (const f of files) {
    if (!f.isFile() || !f.name.toLowerCase().endsWith(".md")) continue;
    const filePath = join(dir, f.name);
    report.total += 1;
    let content = "";
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const verdict = classify(content);
    if (!verdict.polluted) {
      report.clean += 1;
      continue;
    }
    const size = (() => {
      try {
        return statSync(filePath).size;
      } catch {
        return 0;
      }
    })();
    const record = {
      filePath,
      bytes: size,
      templatePath: verdict.templatePath,
      reason: verdict.bodyLeaked ? "skill-creator-body-inlined" : "template-points-at-skill-creator"
    };
    report.polluted.push(record);

    if (doArchive) {
      const archiveDir = `${dir}-archive`;
      mkdirSync(archiveDir, { recursive: true });
      const dest = join(archiveDir, f.name);
      try {
        renameSync(filePath, dest);
        report.archived.push({ from: filePath, to: dest });
      } catch (err) {
        record.archiveError = err instanceof Error ? err.message : String(err);
      }
    }
  }
}

if (asJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(0);
}

const kb = (n) => `${(n / 1024).toFixed(1)}KB`;
console.log(`Data root: ${report.root}`);
console.log(`skill-drafts dirs: ${report.totalDirs}`);
console.log(`Total drafts: ${report.total}`);
console.log(`Clean: ${report.clean}`);
console.log(`Polluted: ${report.polluted.length}`);
if (report.polluted.length > 0) {
  console.log("\nPolluted drafts:");
  for (const r of report.polluted) {
    console.log(`  - [${kb(r.bytes)}] ${r.reason}  ${r.filePath}`);
  }
}
if (doArchive) {
  console.log(`\nArchived ${report.archived.length} file(s) to sibling skill-drafts-archive/ dirs.`);
} else if (report.polluted.length > 0) {
  console.log("\nReport only — no files changed. Re-run with --archive to move polluted drafts aside.");
}
