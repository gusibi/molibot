#!/usr/bin/env node

import process from "node:process";
import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const baseUrl = process.env.MOLIBOT_EVAL_BASE_URL || "http://127.0.0.1:3000";
if (process.env.MOLIBOT_EVAL_ALLOW_SEND !== "1") {
  throw new Error("Refusing to send live reminders. Set MOLIBOT_EVAL_ALLOW_SEND=1 after confirming the configured recipients.");
}
const requestedChannels = (process.env.MOLIBOT_EVAL_CHANNELS || "web,telegram,feishu")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const dataDir = process.env.MOLIBOT_DATA_DIR || join(homedir(), ".molibot");
const channelDirs = { web: "moli-w", telegram: "moli-t", feishu: "moli-f" };

async function request(pathname, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    signal: controller.signal,
    headers: { "content-type": "application/json", ...(init?.headers || {}) }
  }).finally(() => clearTimeout(timeout));
  const payload = await response.json();
  if (!response.ok || payload.ok !== true) {
    throw new Error(`${init?.method || "GET"} ${pathname} failed (${response.status}): ${payload.error || "unknown error"}`);
  }
  return payload;
}

async function waitForTask(taskId, predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await request("/api/desktop/tasks");
    const task = state.summary.items.find((item) => item.taskId === taskId);
    if (task && predicate(task)) return task;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for task ${taskId}.`);
}

function chooseTarget(targets, channel) {
  const candidates = targets.filter((target) => target.channel === channel && target.scope === "workspace");
  if (candidates.length === 0) throw new Error(`No enabled, authorized ${channel} task target is configured.`);
  if (channel === "telegram") {
    return candidates.find((target) => !String(target.chatId).startsWith("-")) || candidates[0];
  }
  return candidates[0];
}

async function runChannel(target, marker) {
  const channelDir = channelDirs[target.channel];
  if (!channelDir) throw new Error(`Unsupported live matrix channel: ${target.channel}`);
  const runtimeTaskId = `acceptance-${randomUUID().slice(0, 8)}`;
  const eventsDir = join(dataDir, channelDir, "bots", target.botId, "events");
  const filename = `acceptance-${Date.now()}-${randomUUID().slice(0, 6)}.json`;
  const eventPath = join(eventsDir, filename);
  const tempPath = `${eventPath}.tmp`;
  let opaqueTaskId = "";
  const startedAt = Date.now();
  try {
    await mkdir(eventsDir, { recursive: true });
    await writeFile(tempPath, `${JSON.stringify({
      taskId: runtimeTaskId,
      enabled: true,
      type: "one-shot",
      chatId: target.chatId,
      text: `${marker} create`,
      delivery: "text",
      at: new Date(Date.now() + 60_000).toISOString(),
      timezone: "Asia/Shanghai",
      sessionMode: "fresh",
      status: { state: "pending", runCount: 0 }
    }, null, 2)}\n`, { flag: "wx" });
    await rename(tempPath, eventPath);

    const created = await waitForTask(runtimeTaskId, () => true);
    opaqueTaskId = created.id;

    const deliveredText = `${marker} delivered`;
    const updated = await request("/api/desktop/tasks", {
      method: "POST",
      body: JSON.stringify({
        action: "update",
        id: opaqueTaskId,
        patch: { text: deliveredText, at: new Date(Date.now() + 3_000).toISOString() }
      })
    });
    const updatedTask = updated.summary.items.find((item) => item.id === opaqueTaskId);
    if (updatedTask?.text !== deliveredText) throw new Error("Updated reminder text did not round-trip.");

    const completed = await waitForTask(runtimeTaskId, (task) => task.status === "completed" || task.status === "error", 45_000);
    if (completed.status !== "completed") throw new Error(completed.lastError || `Reminder ended as ${completed.status}.`);

    const history = await request("/api/desktop/tasks", {
      method: "POST",
      body: JSON.stringify({ action: "history", id: opaqueTaskId, page: 1, pageSize: 5 })
    });
    const execution = history.history?.items?.[0];
    if (!execution || execution.status !== "completed") {
      throw new Error(`Execution receipt is ${execution?.status || "missing"}.`);
    }

    return {
      channel: target.channel,
      status: "passed",
      checks: ["watched_event_create", "crud_update_round_trip", "scheduled_trigger", "completed_execution_receipt"],
      durationMs: Date.now() - startedAt
    };
  } finally {
    if (opaqueTaskId) {
      await request("/api/desktop/tasks", {
        method: "POST",
        body: JSON.stringify({ action: "delete", ids: [opaqueTaskId] })
      });
    }
  }
}

const taskState = await request("/api/desktop/tasks");
const marker = `[Molibot reminder acceptance ${new Date().toISOString()}]`;
const reports = [];
for (const channel of requestedChannels) {
  try {
    reports.push(await runChannel(chooseTarget(taskState.summary.targets, channel), marker));
  } catch (error) {
    reports.push({ channel, status: "failed", error: error instanceof Error ? error.message : String(error) });
  }
}

const passed = reports.every((report) => report.status === "passed");
console.log(JSON.stringify({ passed, marker, reports }, null, 2));
if (!passed) process.exitCode = 1;
