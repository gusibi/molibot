import path from "node:path";
import os from "node:os";
import dotenv from "dotenv";

dotenv.config();

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

// Load the persistent data-dir `.env` so all runtime secrets (tokens, API
// keys) live in one place. Runs after DATA_DIR is resolved (DATA_DIR itself
// must come from the OS env or cwd `.env`, not from inside the data dir).
// dotenv does not override existing vars, so precedence is:
//   OS env > cwd .env > <dataDir>/.env
dotenv.config({ path: path.join(resolvedDataDir, ".env") });

const resolvedDatabaseDir = expandHomePath(process.env.DB_DIR ?? path.join(resolvedDataDir, "db"));

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
  settingsFile: expandHomePath(process.env.SETTINGS_FILE ?? path.join(resolvedDataDir, "settings.json")),
  settingsDbFile: expandHomePath(process.env.SETTINGS_DB_FILE ?? path.join(resolvedDatabaseDir, "settings.sqlite")),
  webWorkspaceDir: expandHomePath(process.env.WEB_WORKSPACE_DIR ?? path.join(resolvedDataDir, "moli-w")),
  sessionsDir: expandHomePath(process.env.SESSIONS_DIR ?? path.join(resolvedDataDir, "sessions")),
  sessionsIndexFile: expandHomePath(
    process.env.SESSIONS_INDEX_FILE ?? path.join(resolvedDataDir, "sessions", "index.json")
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
