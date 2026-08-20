import assert from "node:assert/strict";
import test from "node:test";
import { buildProviderEnv, getScrubbedBaseEnv } from "../src/environment.js";

test("getScrubbedBaseEnv strips credential-shaped variables and internal prefixes", () => {
  const originalEnv = { ...process.env };
  try {
    process.env.TELEGRAM_BOT_TOKEN = "secret-token-123";
    process.env.FEISHU_APP_SECRET = "secret-key-456";
    process.env.DATABASE_PASSWORD = "db-pass-789";
    process.env.MOLIBOT_INTERNAL = "internal-val";
    process.env.MOM_RUNNER_SECRET = "runner-secret";
    process.env.NORMAL_VAR = "hello-world";

    const scrubbed = getScrubbedBaseEnv();
    assert.equal(scrubbed.TELEGRAM_BOT_TOKEN, undefined);
    assert.equal(scrubbed.FEISHU_APP_SECRET, undefined);
    assert.equal(scrubbed.DATABASE_PASSWORD, undefined);
    assert.equal(scrubbed.MOLIBOT_INTERNAL, undefined);
    assert.equal(scrubbed.MOM_RUNNER_SECRET, undefined);
    assert.equal(scrubbed.NORMAL_VAR, "hello-world");
  } finally {
    process.env = originalEnv;
  }
});

test("buildProviderEnv injects allowed auth for codex and excludes others", () => {
  const originalEnv = { ...process.env };
  try {
    process.env.OPENAI_API_KEY = "sk-openai-123";
    process.env.CODEX_API_KEY = "sk-codex-456";
    process.env.ANTHROPIC_API_KEY = "sk-anthropic-789";
    process.env.TELEGRAM_BOT_TOKEN = "telegram-secret";

    const codexEnv = buildProviderEnv("codex");
    assert.equal(codexEnv.OPENAI_API_KEY, "sk-openai-123");
    assert.equal(codexEnv.CODEX_API_KEY, "sk-codex-456");
    assert.equal(codexEnv.ANTHROPIC_API_KEY, undefined);
    assert.equal(codexEnv.TELEGRAM_BOT_TOKEN, undefined);

    const claudeEnv = buildProviderEnv("claude-code");
    assert.equal(claudeEnv.ANTHROPIC_API_KEY, "sk-anthropic-789");
    assert.equal(claudeEnv.OPENAI_API_KEY, undefined);
    assert.equal(claudeEnv.CODEX_API_KEY, undefined);
    assert.equal(claudeEnv.TELEGRAM_BOT_TOKEN, undefined);
  } finally {
    process.env = originalEnv;
  }
});
