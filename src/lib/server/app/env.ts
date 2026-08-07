import path from "node:path";
import os from "node:os";
import dotenv from "dotenv";
import { ALLOW_EXTERNAL_PATHS_ENV, createDataDirScope } from "$lib/server/app/dataDirScope.js";

// Snapshot the OS environment before any `.env` file is merged in. Which layer
// a variable came from is the only thing that distinguishes "this run wants its
// data elsewhere" from "the repository happens to pin a path" — see
// dataDirScope.ts for why that distinction is load-bearing.
const osEnvKeys = new Set(Object.keys(process.env));
dotenv.config();
const cwdEnvKeys = new Set(Object.keys(process.env).filter((key) => !osEnvKeys.has(key)));

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : fallback;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function expandHomePath(input: string): string {
  if (!input.startsWith("~")) return input;
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

const defaultDataDir = path.join(os.homedir(), ".molibot");
const resolvedDataDir = expandHomePath(process.env.DATA_DIR ?? defaultDataDir);

const dataDirScope = createDataDirScope({
  dataDir: resolvedDataDir,
  dataDirFromOsEnv: osEnvKeys.has("DATA_DIR"),
  dataDirIsDefault: process.env.DATA_DIR === undefined,
  // Only the cwd `.env` layer can be out of scope: `<dataDir>/.env` lives
  // inside the data directory and is loaded below, after this snapshot.
  isCwdEnvOnly: (name) => cwdEnvKeys.has(name),
  allowExternal: /^(1|true|yes|on)$/i.test(String(process.env[ALLOW_EXTERNAL_PATHS_ENV] ?? "").trim()),
  expandHomePath
});

// Load the persistent data-dir `.env` so all runtime secrets (tokens, API
// keys) live in one place. Runs after DATA_DIR is resolved (DATA_DIR itself
// must come from the OS env or cwd `.env`, not from inside the data dir).
// dotenv does not override existing vars, so precedence is:
//   OS env > cwd .env > <dataDir>/.env
dotenv.config({ path: path.join(resolvedDataDir, ".env") });

// pi's `grep`/`find` tools shell out to ripgrep/fd and will silently download
// those binaries from GitHub on first use if they are not on PATH. Fetching and
// executing an external binary at runtime is not something this service should
// do on its own, so default to pi's offline mode: a missing binary surfaces as
// a tool error instead. Both binaries are instead provisioned at build time:
// the Dockerfile apt-installs them for the server image, and the Desktop app
// bundles pinned, checksummed copies that `supervisor.rs` puts on this
// process's PATH. Set PI_OFFLINE=0 explicitly to opt back into downloads.
process.env.PI_OFFLINE = process.env.PI_OFFLINE ?? "1";

// Keep every pi-owned user path inside DATA_DIR instead of `~/.pi`.
//
// pi derives its whole user tree — `bin/` (downloaded rg/fd), `sessions/`,
// `themes/`, `prompts/`, `models.json`, `settings.json`, `auth.json`, its debug
// log — from `getAgentDir()`, which falls back to `~/.pi/agent` unless
// PI_CODING_AGENT_DIR is set. This service owns one data directory and must not
// scatter state into a second home-level folder that users neither chose nor
// know to back up. `~/.pi/agent/bin/rg` had already appeared here that way.
//
// Set before anything imports pi: `tools-manager.ts` evaluates
// `const TOOLS_DIR = getBinDir()` at module load, so a later assignment would
// not be seen. This is also why it lives in env.ts rather than at a call site.
process.env.PI_CODING_AGENT_DIR = dataDirScope.resolve(
  "PI_CODING_AGENT_DIR",
  process.env.PI_CODING_AGENT_DIR,
  path.join(resolvedDataDir, "pi")
);

const resolvedDatabaseDir = dataDirScope.resolve(
  "DB_DIR",
  process.env.DB_DIR,
  path.join(resolvedDataDir, "db")
);

// True when the runtime must not start live network services (channel
// websockets, the task scheduler, the periodic memory-sync interval). These
// are real, long-lived side effects that have no place in unit tests: when a
// tool/unit test transitively reaches `getRuntime()` (for example the host-bash
// path reads settings through it), booting the Feishu/Telegram clients keeps
// the process alive forever and the node:test runner never exits.
//
// `NODE_TEST_CONTEXT` is set by `node --test` and never in production, so it
// auto-detects test runs. `MOLIBOT_DISABLE_LIVE_CHANNELS` is an explicit escape
// hatch for any other harness that imports the runtime without wanting bots.
export function liveServicesDisabled(): boolean {
  if (process.env.NODE_TEST_CONTEXT) return true;
  const raw = String(process.env.MOLIBOT_DISABLE_LIVE_CHANNELS ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export const config = {
  port: intFromEnv("PORT", 3000),
  dataDir: resolvedDataDir,
  databaseDir: resolvedDatabaseDir,
  settingsFile: dataDirScope.resolve(
    "SETTINGS_FILE",
    process.env.SETTINGS_FILE,
    path.join(resolvedDataDir, "settings.json")
  ),
  settingsDbFile: dataDirScope.resolve(
    "SETTINGS_DB_FILE",
    process.env.SETTINGS_DB_FILE,
    path.join(resolvedDatabaseDir, "settings.sqlite")
  ),
  webWorkspaceDir: dataDirScope.resolve(
    "WEB_WORKSPACE_DIR",
    process.env.WEB_WORKSPACE_DIR,
    path.join(resolvedDataDir, "moli-w")
  ),
  sessionsDir: dataDirScope.resolve(
    "SESSIONS_DIR",
    process.env.SESSIONS_DIR,
    path.join(resolvedDataDir, "sessions")
  ),
  sessionsIndexFile: dataDirScope.resolve(
    "SESSIONS_INDEX_FILE",
    process.env.SESSIONS_INDEX_FILE,
    path.join(resolvedDataDir, "sessions", "index.json")
  ),
  telegramSttBaseUrl:
    (process.env.TELEGRAM_STT_BASE_URL ??
      process.env.CUSTOM_AI_BASE_URL ??
      "https://api.openai.com/v1").trim(),
  telegramSttApiKey:
    (process.env.TELEGRAM_STT_API_KEY ??
      process.env.OPENAI_API_KEY ??
      process.env.CUSTOM_AI_API_KEY ??
      "").trim(),
  telegramSttModel: (process.env.TELEGRAM_STT_MODEL ?? "whisper-1").trim(),
  telegramSttLanguage: (process.env.TELEGRAM_STT_LANGUAGE ?? "").trim(),
  telegramSttPrompt: (process.env.TELEGRAM_STT_PROMPT ?? "").trim(),
  rateLimitPerMinute: intFromEnv("RATE_LIMIT_PER_MINUTE", 30),
  maxMessageChars: intFromEnv("MAX_MESSAGE_CHARS", 4000)
};

/** Overrides dropped because they came from the repository `.env` rather than
 * from the same layer as an explicit `DATA_DIR`. Exported for the runtime-env
 * diagnostics surface; announced here because a silently relocated database is
 * exactly the failure this guard exists to prevent. */
export const ignoredDataPathOverrides = dataDirScope.ignoredOverrides();
if (ignoredDataPathOverrides.length > 0) {
  console.warn(
    `[molibot] DATA_DIR=${resolvedDataDir} was set explicitly; ignoring ` +
      `${ignoredDataPathOverrides.join(", ")} from the repository .env so data stays inside it.`
  );
}
