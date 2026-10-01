#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFixtures } from "./fixtures/build-fixtures.mjs";
import { evaluateTask } from "./lib/assertions.mjs";
import { runTaskTurns } from "./lib/client.mjs";
import { createScratchDataDir, findFreePort, startScratchService, stopScratchService, removeScratchDataDir } from "./lib/service.mjs";
import { ADAPTIVE_EVAL_VERSION, adaptiveTasks, readAdaptiveTrace, summarizeAdaptiveSamples } from "./lib/adaptive-thinking.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const value = flag => args[args.indexOf(flag) + 1];
async function main() {
  if (args.includes("--list")) {
    console.log(ADAPTIVE_EVAL_VERSION);
    for (const task of adaptiveTasks) console.log(`${task.id} [${task.category}] ${task.title}`);
    return;
  }
  if (!args.includes("--live")) throw new Error("Use --list offline, or --live --seed-from <dir> --fixed-level <existing-default> --repeats 3 for paid model calls.");
  const fixedLevel = value("--fixed-level");
  if (!args.includes("--seed-from") || !args.includes("--fixed-level") || !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(fixedLevel)) throw new Error("Provide --seed-from and --fixed-level matching the existing main-model default.");
  const repeats = args.includes("--repeats") ? Number(value("--repeats")) : 3;
  if (!Number.isInteger(repeats) || repeats < 2) throw new Error("--repeats must be an integer >= 2");
  const selected = args.includes("--id") ? adaptiveTasks.filter(task => value("--id").split(",").includes(task.id)) : adaptiveTasks;
  if (!selected.length) throw new Error("No tasks selected");
  const fixtureDir = path.join(here, "fixtures");
  buildFixtures(fixtureDir);
  const dataDir = createScratchDataDir({ seedFrom: value("--seed-from") });
  const samples = [];
  let service;
  try {
    service = await startScratchService({ repoRoot: path.resolve(here, ".."), dataDir, port: await findFreePort() });
    const adaptive = await (await fetch(`${service.endpoint}/api/settings/adaptive-thinking`)).json();
    if (!adaptive.ok || !adaptive.autoAvailable) throw new Error("The seeded decision model must be enabled and usable before comparing Auto with fixed effort. Configure the isolated seed first.");
    for (const task of selected) for (let repeat = 0; repeat < repeats; repeat += 1) {
      // Alternate pair ordering to reduce warmup and provider-time bias.
      for (const mode of repeat % 2 ? ["auto", "fixed"] : ["fixed", "auto"]) {
        const started = performance.now();
        const sample = { taskId: task.id, repeat, mode };
        try {
          const run = await runTaskTurns(service.endpoint, { ...task, id: `${task.id}-${repeat}-${mode}` }, { fixtureDir, thinkingLevel: mode === "auto" ? "auto" : fixedLevel });
          sample.endToEndMs = performance.now() - started;
          const evaluated = await evaluateTask(task, { reply: run.reply, tools: run.tools, dataDir });
          Object.assign(sample, { status: evaluated.status, checks: evaluated.checks, replies: run.replies, tools: run.tools }, readAdaptiveTrace(dataDir, run.conversationIds, { mode }));
        } catch (error) {
          Object.assign(sample, { status: "error", endToEndMs: performance.now() - started, error: error.message, decisionMs: null, firstVisibleMs: null, retries: null, totalCost: null });
        }
        samples.push(sample);
        console.log(`${task.id} ${mode} #${repeat + 1}: ${sample.status}`);
        if (service.exitInfo()) throw new Error("Scratch service exited");
      }
    }
    const resultsDir = path.join(here, "results");
    mkdirSync(resultsDir, { recursive: true });
    const output = path.join(resultsDir, `adaptive-${Date.now()}.json`);
    writeFileSync(output, JSON.stringify({ version: ADAPTIVE_EVAL_VERSION, fixedLevel, baselineSource: "explicit existing default supplied by operator", repeats,
      qualityScope: "deterministic outcome checks; detailed diagnosis quality requires human review of saved replies", summary: summarizeAdaptiveSamples(samples), samples }, null, 2));
    console.log(`Results: ${output}`);
  } finally {
    if (service) await stopScratchService(service);
    removeScratchDataDir(dataDir, { keep: args.includes("--keep-data-dir") });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
