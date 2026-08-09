#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateTask } from "./lib/assertions.mjs";
import { runTaskTurns } from "./lib/client.mjs";
import { renderReport, summarize } from "./lib/report.mjs";
import {
  createScratchDataDir,
  findFreePort,
  removeScratchDataDir,
  startScratchService,
  stopScratchService
} from "./lib/service.mjs";
import { loadTasks, selectTasks } from "./lib/tasks.mjs";
import { buildFixtures } from "./fixtures/build-fixtures.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

function parseArgs(argv) {
  const options = {
    ids: [],
    groups: [],
    skipTags: [],
    seedFrom: process.env.MOLIBOT_EVAL_SEED_FROM ?? path.join(process.env.HOME ?? "", ".molibot"),
    keepDataDir: false,
    listOnly: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--id") options.ids.push(...next().split(","));
    else if (arg === "--group") options.groups.push(...next().split(","));
    else if (arg === "--skip-tag") options.skipTags.push(...next().split(","));
    else if (arg === "--seed-from") options.seedFrom = next();
    else if (arg === "--keep-data-dir") options.keepDataDir = true;
    else if (arg === "--list") options.listOnly = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

const USAGE = `
molibot evals — run the golden set against a throwaway service

  node evals/run.mjs [options]

  --id A1,B2          only these tasks
  --group A,F         only these groups
  --skip-tag slow     drop tasks carrying a tag (slow, network)
  --seed-from <dir>   data dir to copy provider config from (default ~/.molibot)
  --keep-data-dir     leave the scratch DATA_DIR in place for inspection
  --list              print the selected tasks and exit

The service runs on a temporary DATA_DIR with MOLIBOT_DISABLE_EXTERNAL_CHANNELS=1,
so it can never answer as your Telegram/Feishu/WeChat bot. Requires a build:
  corepack pnpm build
`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE.trim());
    return;
  }

  const tasks = selectTasks(loadTasks(path.join(here, "golden")), options).filter(
    (task) => !task.tags.some((tag) => options.skipTags.includes(tag))
  );

  if (options.listOnly) {
    for (const task of tasks) {
      console.log(`${task.id.padEnd(3)} [${task.baseline.padEnd(7)}] ${task.title}`);
    }
    console.log(`\n${tasks.length} task(s).`);
    return;
  }
  if (tasks.length === 0) {
    console.error("no tasks selected");
    process.exitCode = 1;
    return;
  }

  if (!existsSync(path.join(repoRoot, "build", "index.js"))) {
    console.error("build/index.js is missing — run `corepack pnpm build` first.");
    process.exitCode = 1;
    return;
  }

  const fixtureDir = path.join(here, "fixtures");
  buildFixtures(fixtureDir);

  const dataDir = createScratchDataDir({ seedFrom: options.seedFrom });
  const resultsDir = path.join(here, "results");
  mkdirSync(resultsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = path.join(resultsDir, `${stamp}.service.log`);

  console.log(`scratch DATA_DIR : ${dataDir}`);
  console.log(`seeded from      : ${options.seedFrom}`);
  console.log(`service log      : ${logPath}`);

  const port = await findFreePort();
  let service;
  const startedAt = Date.now();
  const results = [];

  try {
    service = await startScratchService({
      repoRoot,
      dataDir,
      port,
      onLog: (chunk) => appendFileSync(logPath, chunk)
    });
    console.log(`service ready    : ${service.endpoint}\n`);

    for (const task of tasks) {
      process.stdout.write(`${task.id.padEnd(3)} ${task.title} … `);
      const taskStartedAt = Date.now();
      let record;
      try {
        const run = await withTimeout(
          runTaskTurns(service.endpoint, task, { fixtureDir }),
          task.timeoutMs,
          `task exceeded ${task.timeoutMs}ms`
        );
        const evaluated = await evaluateTask(task, {
          reply: run.reply,
          tools: run.tools,
          dataDir
        });
        record = {
          ...taskHeader(task),
          status: evaluated.status,
          checks: evaluated.checks,
          reply: run.reply,
          // Every turn, not just the last: diagnosing a multi-turn failure from
          // the final reply alone is guesswork — for a memory task the question
          // is almost always what happened on turn 1.
          replies: run.replies,
          tools: run.tools,
          elapsedMs: Date.now() - taskStartedAt
        };
      } catch (error) {
        // If the service is gone, that is the real story — say so instead of
        // leaving a bare "fetch failed" that reads like a flaky network.
        const exit = service.exitInfo?.();
        const died = exit
          ? ` — the service process exited (code ${exit.code}, signal ${exit.signal}); see the service log`
          : "";
        record = {
          ...taskHeader(task),
          status: "error",
          checks: [],
          error: `${error?.message ?? String(error)}${died}`,
          serviceExit: exit ?? null,
          elapsedMs: Date.now() - taskStartedAt
        };
      }
      results.push(record);
      console.log(`${record.status}  ${(record.elapsedMs / 1000).toFixed(0)}s`);
      if (service.exitInfo?.()) {
        console.log("! the service process is gone; every remaining task would fail the same way. Stopping.");
        break;
      }
    }
  } finally {
    if (service) await stopScratchService(service);
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(renderReport(results, { elapsedMs }));

  const jsonPath = path.join(resultsDir, `${stamp}.json`);
  writeFileSync(
    jsonPath,
    JSON.stringify(
      { startedAt: new Date(startedAt).toISOString(), elapsedMs, summary: summarize(results), results },
      null,
      2
    ),
    "utf8"
  );
  console.log(`\nresults: ${path.relative(repoRoot, jsonPath)}`);

  removeScratchDataDir(dataDir, { keep: options.keepDataDir });
  if (options.keepDataDir) console.log(`kept scratch data dir: ${dataDir}`);
}

function taskHeader(task) {
  return { id: task.id, title: task.title, group: task.group, baseline: task.baseline };
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    })
  ]);
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
