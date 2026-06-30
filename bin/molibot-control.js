#!/usr/bin/env node
// Molibot control daemon — an independent, minimal process that can start/stop/
// restart the main molibot service from a dedicated Telegram bot. It deliberately
// imports nothing from the main app (no agent/runtime/settings) so it keeps
// running even when the main service is down, which is the only way a chat command
// can bring a fully stopped service back up.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Bot } from "grammy";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultDataDir = join(os.homedir(), ".molibot");

function expandHomePath(input) {
  const value = String(input || "").trim();
  if (!value.startsWith("~")) return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return join(os.homedir(), value.slice(2));
  return value;
}

function resolvePath(input) {
  return resolve(expandHomePath(input));
}

function parseEnvValue(raw) {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function loadDeployConfig() {
  const dataDir = resolvePath(process.env.DATA_DIR || defaultDataDir);
  const configPath = resolvePath(process.env.MOLIBOT_DEPLOY_CONFIG || join(dataDir, "deploy.env"));
  const config = {};
  if (!existsSync(configPath)) return config;
  for (const line of readFileSync(configPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    config[trimmed.slice(0, eq)] = parseEnvValue(trimmed.slice(eq + 1));
  }
  return config;
}

const deployConfig = loadDeployConfig();
function cfg(key) {
  return process.env[key] || deployConfig[key] || "";
}

const token = cfg("MOLIBOT_CONTROL_TG_TOKEN");
if (!token) {
  console.error("[molibot-control] missing MOLIBOT_CONTROL_TG_TOKEN (set it in deploy.env or env)");
  process.exit(1);
}

const adminIds = new Set(
  cfg("MOLIBOT_CONTROL_ADMIN_IDS")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
);
// Discovery mode: with no admins configured nobody is authorized, so no command
// can ever run. We still start the bot and log incoming chats so the operator
// can read the log to find their chat id, then add it to the allow-list. This
// avoids a bootstrap deadlock (you can't discover your id if the daemon refuses
// to start without an id).
if (adminIds.size === 0) {
  console.warn(
    "[molibot-control] MOLIBOT_CONTROL_ADMIN_IDS is empty — running in DISCOVERY MODE: " +
      "no commands will be authorized. Send any message to this bot, copy the logged chat_id " +
      "into MOLIBOT_CONTROL_ADMIN_IDS, then restart."
  );
}

// The control daemon supports two service sources:
//   - release: the deployed, immutable release at MOLIBOT_CURRENT_LINK; `/start`
//     re-runs the release flow (molibot-update.sh) to build/deploy the latest
//     git ref and restart it.
//   - dev: the local working tree this daemon lives in; `/start dev` starts it
//     through `scripts/start-server.mjs`, matching `molibot start` and its data lock.
const currentLink = cfg("MOLIBOT_CURRENT_LINK");
const repoRoot = dirname(scriptDir); // the working tree containing this bin/ dir
const devDir = resolvePath(cfg("MOLIBOT_CONTROL_DEV_DIR") || repoRoot);
const devServiceScript = join(devDir, "bin", "molibot-service.sh");
const releaseServiceScript = resolvePath(
  cfg("MOLIBOT_CONTROL_SERVICE_SCRIPT") ||
    (currentLink ? join(currentLink, "bin", "molibot-service.sh") : devServiceScript)
);
const updateScript = resolvePath(cfg("MOLIBOT_CONTROL_UPDATE_SCRIPT") || join(scriptDir, "molibot-update.sh"));
const logFile = resolvePath(cfg("MOLIBOT_LOG_FILE") || join(os.homedir(), "logs", "molibot.log"));
// Stop/status are PID-file based and mode-agnostic; use whichever service script
// exists so the daemon can always report/stop a running service.
const statusServiceScript = existsSync(devServiceScript) ? devServiceScript : releaseServiceScript;

// All deploy.env keys are passed through so service/update scripts act on the
// real deployment (log/pid files, deploy dir, git ref, …). process.env wins.
function baseEnv(extra = {}) {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(deployConfig)) {
    if (value && !process.env[key]) env[key] = value;
  }
  return { ...env, ...extra };
}

function runScript(scriptPath, args, extraEnv = {}) {
  return new Promise((resolveRun) => {
    if (!existsSync(scriptPath)) {
      resolveRun({ ok: false, output: `script not found: ${scriptPath}` });
      return;
    }
    const child = spawn("bash", [scriptPath, ...args], { env: baseEnv(extraEnv) });
    let out = "";
    const cap = (chunk) => {
      out += chunk.toString();
      if (out.length > 60_000) out = out.slice(-60_000);
    };
    child.stdout.on("data", cap);
    child.stderr.on("data", cap);
    child.on("error", (err) => resolveRun({ ok: false, output: String(err?.message || err) }));
    child.on("close", (code) => resolveRun({ ok: code === 0, output: out.trim() || `(exit code ${code})` }));
  });
}

function wantsDev(ctx) {
  return ctx.match?.toString().trim().toLowerCase() === "dev";
}

// Compile the dev working tree (npm run build) so `/start dev` reflects the
// latest local code. Run through a login shell so node/npm resolve from the
// operator's profile PATH, matching how the supervisor launches commands.
function runBuild() {
  return new Promise((resolveRun) => {
    const child = spawn("bash", ["-lc", "npm run build"], { cwd: devDir, env: baseEnv() });
    let out = "";
    const cap = (chunk) => {
      out += chunk.toString();
      if (out.length > 60_000) out = out.slice(-60_000);
    };
    child.stdout.on("data", cap);
    child.stderr.on("data", cap);
    child.on("error", (err) => resolveRun({ ok: false, output: String(err?.message || err) }));
    child.on("close", (code) => resolveRun({ ok: code === 0, output: out.trim() || `(exit code ${code})` }));
  });
}

function tailLog(lines) {
  try {
    if (!existsSync(logFile)) return `log file not found: ${logFile}`;
    const text = readFileSync(logFile, "utf8").replace(/\r\n?/g, "\n");
    return text.split("\n").slice(-lines).join("\n").trim() || "(log empty)";
  } catch (err) {
    return `failed to read log: ${String(err?.message || err)}`;
  }
}

function codeBlock(text) {
  const trimmed = String(text || "").trim() || "(no output)";
  return "```\n" + trimmed.slice(0, 3500) + "\n```";
}

const bot = new Bot(token);

function isAdmin(ctx) {
  const chatId = ctx.chat?.id != null ? String(ctx.chat.id) : "";
  const fromId = ctx.from?.id != null ? String(ctx.from.id) : "";
  return adminIds.has(chatId) || adminIds.has(fromId);
}

// Ignore anyone not on the allow-list — this process can stop/start the whole
// service, so it must never act for unknown chats. We still log the ignored
// chat/user ids so an operator can discover their own id during setup (read the
// control log), but we never reply to non-admins.
bot.use(async (ctx, next) => {
  if (!isAdmin(ctx)) {
    const chatId = ctx.chat?.id != null ? String(ctx.chat.id) : "unknown";
    const fromId = ctx.from?.id != null ? String(ctx.from.id) : "unknown";
    const text = ctx.message?.text != null ? String(ctx.message.text) : "";
    console.log(
      `[molibot-control] ignored non-admin message chat_id=${chatId} from_id=${fromId} text=${JSON.stringify(text)} ` +
        `(add chat_id to MOLIBOT_CONTROL_ADMIN_IDS to allow)`
    );
    return;
  }
  await next();
});

bot.command("start", async (ctx) => {
  if (wantsDev(ctx)) {
    await ctx.reply(`⏳ building dev working tree (${devDir})… this can take a while.`);
    const build = await runBuild();
    if (!build.ok) {
      await ctx.reply(`❌ build failed (not starting)\n${codeBlock(build.output)}`, { parse_mode: "Markdown" });
      return;
    }
    await ctx.reply("✅ build ok. ⏳ starting…");
    const r = await runScript(devServiceScript, ["start"], { MOLIBOT_APP_DIR: devDir });
    await ctx.reply(`${r.ok ? "✅ dev start" : "❌ dev start failed"}\n${codeBlock(r.output)}`, { parse_mode: "Markdown" });
    return;
  }
  await ctx.reply("⏳ running release flow (build latest, deploy, restart)… this can take a while.");
  const r = await runScript(updateScript, []);
  await ctx.reply(`${r.ok ? "✅ release deployed & started" : "❌ release flow failed"}\n${codeBlock(r.output)}`, { parse_mode: "Markdown" });
});

bot.command("stop", async (ctx) => {
  await ctx.reply("⏳ stopping molibot…");
  const r = await runScript(statusServiceScript, ["stop"]);
  await ctx.reply(`${r.ok ? "✅ stopped" : "❌ stop failed"}\n${codeBlock(r.output)}`, { parse_mode: "Markdown" });
});

bot.command("restart", async (ctx) => {
  if (wantsDev(ctx)) {
    await ctx.reply(`⏳ building dev working tree (${devDir})… this can take a while.`);
    const build = await runBuild();
    if (!build.ok) {
      await ctx.reply(`❌ build failed (not restarting)\n${codeBlock(build.output)}`, { parse_mode: "Markdown" });
      return;
    }
    await ctx.reply("✅ build ok. ⏳ restarting…");
    const r = await runScript(devServiceScript, ["restart"], { MOLIBOT_APP_DIR: devDir });
    await ctx.reply(`${r.ok ? "✅ dev restarted" : "❌ dev restart failed"}\n${codeBlock(r.output)}`, { parse_mode: "Markdown" });
    return;
  }
  await ctx.reply("⏳ restarting current release…");
  const r = await runScript(releaseServiceScript, ["restart"]);
  await ctx.reply(`${r.ok ? "✅ release restarted" : "❌ release restart failed"}\n${codeBlock(r.output)}`, { parse_mode: "Markdown" });
});

bot.command("build", async (ctx) => {
  await ctx.reply(`⏳ building dev working tree (${devDir})… this can take a while.`);
  const r = await runBuild();
  await ctx.reply(`${r.ok ? "✅ build ok" : "❌ build failed"}\n${codeBlock(r.output)}`, { parse_mode: "Markdown" });
});

bot.command("status", async (ctx) => {
  const r = await runScript(statusServiceScript, ["status"]);
  await ctx.reply(codeBlock(r.output), { parse_mode: "Markdown" });
});

bot.command("logs", async (ctx) => {
  const n = Number.parseInt(ctx.match?.toString().trim() || "", 10);
  const lines = Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 50;
  await ctx.reply(codeBlock(tailLog(lines)), { parse_mode: "Markdown" });
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    [
      "molibot control commands:",
      "/status — service status",
      "/start — release flow: build latest, deploy to current, start",
      "/start dev — build the dev working tree, then start it",
      "/build — build the dev working tree (npm run build)",
      "/stop — stop service (stays down)",
      "/restart — restart the current release",
      "/restart dev — build the dev working tree, then restart it",
      "/logs [n] — last n log lines (default 50)"
    ].join("\n")
  );
});

bot.catch((err) => {
  console.error("[molibot-control] bot error:", err?.error || err);
});

async function main() {
  console.log(
    `[molibot-control] starting (admins=${adminIds.size}, release=${releaseServiceScript}, dev=${devServiceScript}, update=${updateScript})`
  );
  await bot.start({
    onStart: (info) => console.log(`[molibot-control] online as @${info.username}`)
  });
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`[molibot-control] received ${sig}, shutting down`);
    bot.stop().finally(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error("[molibot-control] fatal:", err);
  process.exit(1);
});
