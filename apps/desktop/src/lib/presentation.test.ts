import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveComposerContextUsage,
  formatContextTokens,
  formatNaturalDateTime,
  formatNaturalSchedule,
  humanizeModelOption,
  groupModelOptions,
  modelOptionCopy,
  humanizeProviderName,
  humanizeTechnicalName,
  resolveModelContextWindow
} from "./presentation";

test("model options lead with a human name and keep the opaque key secondary", () => {
  assert.deepEqual(
    humanizeModelOption("[Custom] CliProxyAPI / tencent/hy3", "custom|cli-proxy-api|tencent/hy3"),
    { label: "CliProxyAPI · HY3", technicalId: "custom|cli-proxy-api|tencent/hy3" }
  );
  assert.deepEqual(
    humanizeModelOption("[Custom] 硅基流动语音 / TeleAI/TeleSpeechASR", "custom|siliconflow|TeleAI/TeleSpeechASR"),
    { label: "硅基流动语音 · TeleSpeech ASR", technicalId: "custom|siliconflow|TeleAI/TeleSpeechASR" }
  );
});

// `[PI]` / `[Custom]` are routing tags from `buildModelOptions`, not something a
// person picking a model should read (issue #28). The alias wins when set; the
// exact id survives as the secondary line so near-identical models stay apart.
test("model selectors lead with the alias and never show the routing tag", () => {
  assert.deepEqual(
    modelOptionCopy({ key: "custom|cli-proxy-api|gpt-5.4-mini", label: "[Custom] CliProxyAPI / gpt-5.4-mini", alias: "小模型" }),
    { name: "小模型", detail: "CliProxyAPI / gpt-5.4-mini" }
  );
  assert.deepEqual(
    modelOptionCopy({ key: "pi|deepseek|deepseek-v4-pro", label: "[PI] deepseek / deepseek-v4-pro" }),
    { name: "DeepSeek V4 Pro", detail: "deepseek / deepseek-v4-pro" }
  );
  // A blank alias is not an alias.
  assert.equal(modelOptionCopy({ key: "pi|deepseek|deepseek-v4-pro", label: "[PI] deepseek / deepseek-v4-pro", alias: "  " }).name, "DeepSeek V4 Pro");
});

test("model selector groups sort alphabetically with one-line names", () => {
  assert.deepEqual(
    groupModelOptions([
      { key: "pi|deepseek|deepseek-v4-flash", label: "[PI] deepseek / deepseek-v4-flash" },
      { key: "pi|deepseek|deepseek-v4-pro", label: "[PI] DeepSeek / deepseek-v4-pro", alias: "Pro" },
      { key: "custom|cli-proxy-api|tencent/hy3", label: "[Custom] CliProxyAPI / tencent/hy3" }
    ]).map((group) => ({ provider: group.provider, names: group.options.map((item) => item.name) })),
    [
      { provider: "CliProxyAPI", names: ["Tencent · HY3"] },
      { provider: "DeepSeek", names: ["DeepSeek V4 Flash", "Pro"] }
    ]
  );
});

// Models arrive in provider-config order; the selector must not surface that
// order or near-identical models (Kimi K3 vs Kimi K2.7 Code) scatter randomly.
test("model groups and their options sort alphabetically by display name", () => {
  const grouped = groupModelOptions([
    { key: "c|x|kimi-k3", label: "[C] x / Kimi K3" },
    { key: "c|x|deepseek-v4-flash-oc", label: "[C] x / DeepSeek V4.1 Flash OC" },
    { key: "a|anthropic|claude", label: "[A] Anthropic / claude" },
    { key: "c|x|kimi-k2-code", label: "[C] x / Kimi K2.7 Code" },
    { key: "c|x|grok-fast", label: "[C] x / grok-fast" }
  ]);
  assert.deepEqual(
    grouped.map((group) => [group.provider, group.options.map((item) => item.name)]),
    [
      ["Anthropic", ["Claude"]],
      ["X", ["DeepSeek V4.1 Flash OC", "Grok Fast", "Kimi K2.7 Code", "Kimi K3"]]
    ]
  );
});

test("provider and technical names become readable without losing their identifiers", () => {
  assert.deepEqual(humanizeProviderName("[Built-in] amazon-bedrock", "amazon-bedrock"), {
    label: "Amazon Bedrock",
    technicalId: "amazon-bedrock"
  });
  assert.equal(humanizeTechnicalName("doubao-seed-2.0-lite"), "Doubao Seed 2.0 Lite");
  assert.equal(humanizeTechnicalName("deepseek-v4-pro"), "DeepSeek V4 Pro");
});

test("common cron schedules are localized while raw cron remains secondary", () => {
  assert.equal(formatNaturalSchedule("0 8,20 * * *", "zh-CN"), "每天 08:00、20:00");
  assert.equal(formatNaturalSchedule("30 18 * * 1,3,5", "zh-CN"), "每周一、周三、周五 18:30");
  assert.equal(formatNaturalSchedule("0 9 15 * *", "en"), "Monthly on day 15 at 09:00");
  assert.equal(formatNaturalSchedule("*/15 * * * *", "zh-CN"), "每 15 分钟");
});

test("timestamps use localized compact date and time", () => {
  assert.match(formatNaturalDateTime("2026-07-14T08:30:00+08:00", "zh-CN"), /7月14日.*08:30/);
  assert.match(formatNaturalDateTime("2026-07-14T08:30:00+08:00", "en"), /Jul 14.*08:30/);
});

test("context tokens read 万-based in Chinese and compact in English", () => {
  assert.equal(formatContextTokens(262_000, "zh-CN"), "26.2万");
  assert.equal(formatContextTokens(1_000_000, "zh-CN"), "100万");
  assert.equal(formatContextTokens(9_800, "zh-CN"), "9.8k");
  assert.equal(formatContextTokens(262_000, "en"), "262k");
  assert.equal(formatContextTokens(1_000_000, "en"), "1m");
});

test("context usage derives the last snapshot and mean per-call cache hit rate", () => {
  const usage = deriveComposerContextUsage([
    { role: "user" },
    {
      role: "assistant",
      usage: { inputTokens: 100, cacheReadTokens: 300, cacheWriteTokens: 100 },
      contextBreakdown: {
        contextWindow: 100_000,
        estimatedTokens: 1_000,
        breakdown: { messages: 500, mcpTools: 200, systemTools: 100, systemPrompt: 150, skills: 30, other: 20 },
        inputTokens: 100,
        cacheReadTokens: 300,
        cacheWriteTokens: 100
      }
    },
    {
      role: "assistant",
      // The turn-aggregated usage double-counts context across calls; the
      // panel must use the snapshot call's own input side instead.
      usage: { inputTokens: 200, cacheReadTokens: 600, cacheWriteTokens: 200 },
      contextBreakdown: {
        contextWindow: 100_000,
        estimatedTokens: 2_000,
        breakdown: { messages: 1_500, mcpTools: 200, systemTools: 100, systemPrompt: 150, skills: 30, other: 20 },
        inputTokens: 200,
        cacheReadTokens: 600,
        cacheWriteTokens: 200
      }
    }
  ]);

  assert.ok(usage);
  assert.equal(usage.usedTokens, 1_000);
  assert.equal(usage.contextWindow, 100_000);
  assert.equal(usage.percent, 1);
  // Mean of the two per-call rates (0.6, 0.6), not a token-weighted sum.
  assert.equal(usage.cacheHitRate, 0.6);
  assert.deepEqual(
    usage.categories.map((category) => [category.key, category.percent]),
    [
      ["messages", 75],
      ["mcpTools", 10],
      ["systemTools", 5],
      ["systemPrompt", 7.5],
      ["skills", 1.5],
      ["other", 1]
    ]
  );
});

test("context usage returns null without a snapshot and clamps an overfull window", () => {
  assert.equal(deriveComposerContextUsage([{ role: "user" }]), null);
  const overfull = deriveComposerContextUsage([{
    role: "assistant",
    contextBreakdown: {
      contextWindow: 1_000,
      estimatedTokens: 1_200,
      breakdown: { messages: 1_200, mcpTools: 0, systemTools: 0, systemPrompt: 0, skills: 0, other: 0 },
      inputTokens: 1_500,
      cacheReadTokens: 0,
      cacheWriteTokens: 0
    }
  }]);
  assert.equal(overfull?.percent, 100);
  assert.equal(overfull?.cacheHitRate, null);
});

test("a snapshot's window wins over the selected model's configured fallback", () => {
  const usage = deriveComposerContextUsage([
    {
      role: "assistant",
      usage: { inputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
      contextBreakdown: {
        contextWindow: 100_000,
        estimatedTokens: 100,
        breakdown: { messages: 100, mcpTools: 0, systemTools: 0, systemPrompt: 0, skills: 0, other: 0 },
        inputTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0
      }
    }
  ], 8_000);
  assert.equal(usage?.contextWindow, 100_000);
});

// Sessions transcribed before snapshots existed still carry real per-call
// usage: capacity and cache rate render from it, category rows stay hidden.
test("without a snapshot the panel degrades to reported usage plus the configured model window", () => {
  const usage = deriveComposerContextUsage([
    { role: "user" },
    {
      role: "assistant",
      usage: { inputTokens: 1_000, cacheReadTokens: 27_000, cacheWriteTokens: 0 }
    }
  ], 200_000);
  assert.ok(usage);
  assert.equal(usage.usedTokens, 28_000);
  assert.equal(usage.contextWindow, 200_000);
  assert.ok(Math.abs(usage.percent - 14) < 1e-9);
  assert.deepEqual(usage.categories, []);
  assert.equal(usage.cacheHitRate, 27_000 / 28_000);
});

test("resolveModelContextWindow reads the selected option and defaults to 0", () => {
  const options = [
    { key: "a", contextWindow: 100_000 },
    { key: "b" }
  ];
  assert.equal(resolveModelContextWindow(options, "a"), 100_000);
  assert.equal(resolveModelContextWindow(options, "b"), 0);
  assert.equal(resolveModelContextWindow(options, "missing"), 0);
});

// The cache line always renders when the transcript has usage: an all-zero
// transcript shows a real 0% (the provider reported no cache hits), and mixed
// data shows the mean of per-call rates.
test("cache hit rate renders 0 when no call reports cache activity", () => {
  const allZero = deriveComposerContextUsage([
    { role: "assistant", usage: { inputTokens: 12_000, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    { role: "assistant", usage: { inputTokens: 13_000, cacheReadTokens: 0, cacheWriteTokens: 0 } }
  ], 1_000_000);
  assert.equal(allZero?.cacheHitRate, 0);

  const mixed = deriveComposerContextUsage([
    { role: "assistant", usage: { inputTokens: 12_000, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    { role: "assistant", usage: { inputTokens: 1_000, cacheReadTokens: 11_000, cacheWriteTokens: 0 } }
  ], 1_000_000);
  assert.ok(mixed && mixed.cacheHitRate !== null && mixed.cacheHitRate > 0);
});
