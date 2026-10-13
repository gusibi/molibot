import { resolve, join } from "node:path";

/** Child test processes must not reinterpret dotenv-injected owner paths as explicit overrides. */
export function isolatedDataEnv(directory, base = process.env) {
  const root = resolve(directory);
  return { ...base, DATA_DIR: root, DB_DIR: join(root, "db"), SETTINGS_DB_FILE: join(root, "db", "settings.sqlite"), SETTINGS_FILE: join(root, "settings.json"), WEB_WORKSPACE_DIR: join(root, "moli-w"), SESSIONS_DIR: join(root, "sessions"), SESSIONS_INDEX_FILE: join(root, "sessions", "index.json"), PI_CODING_AGENT_DIR: join(root, "pi") };
}
