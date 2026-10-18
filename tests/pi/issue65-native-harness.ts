import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { startFixture, oauthServer } from "../../evals/lib/oauthFixture.js";
import { startModelService, modelRequestMatchers } from "../ui/support/model-service.js";
import { findFreePort } from "../../evals/lib/service.mjs";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { SettingsStore } from "$lib/server/settings/store.js";
import { ensureStorageDirs, storagePaths } from "$lib/server/infra/db/storage.js";

const dataDir = process.env.DATA_DIR;
if (!dataDir?.includes("molibot-ui-pi-native-") || resolve(dataDir) !== storagePaths.dataDir) throw new Error("Native acceptance requires its isolated data directory.");
ensureStorageDirs();
const oauth = await startFixture();
const provider = await startModelService();
provider.script({ name: "native-plan", when: request => request.tools.includes("exitPlan") && modelRequestMatchers(request).lastUserText.includes("issue65-plan"),
  reply: { type: "toolCalls", calls: [{ name: "exitPlan", args: { title: "Issue65 Native Plan", summary: "Verify 31 isolated local fixture items.", steps: Array.from({ length: 31 }, (_, index) => `native-fixture-step ${index + 1}`) } }] } });
provider.script({ name: "native-plan-step", when: request => modelRequestMatchers(request).lastUserText.includes("Current step: native-fixture-step"),
  reply: { type: "text", text: "Verified the isolated local fixture item.", chunks: 2, delayMs: 300 } });
provider.script({ name: "native-hold", when: request => modelRequestMatchers(request).lastUserText.includes("issue65-hold"),
  reply: { type: "hold", key: "native-hold", text: "Waiting in the isolated native fixture." } });
provider.script({ name: "native-approval", when: request => modelRequestMatchers(request).lastUserText.includes("approval fixture") && !modelRequestMatchers(request).afterToolResults,
  reply: { type: "toolCalls", calls: [{ name: "write", args: { label: "Native approval fixture", path: "native-approval.txt", content: "Verified isolated native approval" } }] } });
provider.script({ name: "catch-all", reply: { type: "text", text: "OK" } });
const settings = structuredClone(defaultRuntimeSettings);
settings.providerMode = "custom"; settings.defaultCustomProviderId = "pi-local";
settings.customProviders = [{ id: "pi-local", name: "Pi Local", enabled: true, protocol: "openai-compatible", baseUrl: provider.url, apiKey: "local-fixture", path: "/chat/completions", defaultModel: "fixture", models: [{ id: "fixture", enabled: true, tags: ["text"], supportedRoles: ["system", "user", "assistant", "tool"] }] }];
settings.modelRouting.textModelKey = "custom|pi-local|fixture";
settings.agents = [{ id: "default", name: "Momo", description: "Local acceptance", enabled: true, permissionMode: "manual" }, { id: "second", name: "Second", description: "Local acceptance", enabled: true, permissionMode: "manual" }];
settings.defaultAgentId = "default"; settings.permissionMode = "manual";
settings.openConnector.enabled = false; settings.plugins.memory.enabled = false;
settings.mcpServers = [oauthServer("pi-local-oauth", oauth.mcpUrl)];
new SettingsStore().save(settings);
const port = Number(process.env.NATIVE_FRONTEND_PORT) || await findFreePort();
const frontend = `http://127.0.0.1:${port}`;
const vite = spawn(process.execPath, [resolve("node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port)], { cwd: resolve("apps/desktop"), env: { ...process.env, VITE_MOLIBOT_PREVIEW: "0" }, stdio: ["ignore", "ignore", "pipe"] });
vite.stderr?.on("data", data => process.stderr.write(data));
mkdirSync(".test-tmp/pi", { recursive: true });
writeFileSync(".test-tmp/pi/native-harness.json", JSON.stringify({ dataDir, frontend, oauthUrl: oauth.asUrl, mcpUrl: oauth.mcpUrl, pid: process.pid }));
writeFileSync(".test-tmp/pi/native-config.json", JSON.stringify({ identifier: "dev.molibot.issue65-acceptance", productName: "Molibot Issue 65", build: { devUrl: frontend, beforeDevCommand: "" } }));
console.log(JSON.stringify({ type: "ready", frontend, dataDir }));
process.on("SIGUSR2", () => provider.release("native-hold"));
const shutdown = async () => { vite.kill("SIGTERM"); await provider.close(); await oauth.close(); process.exit(0); };
process.on("SIGTERM", () => { void shutdown(); });
process.on("SIGINT", () => { void shutdown(); });
setInterval(() => {}, 1000);
