import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveComposerContextUsage,
  deriveSessionUsageView,
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

test("context usage derives the last snapshot plus its trailing reply", () => {
  const usage = deriveComposerContextUsage([
    { role: "user" },
    {
      role: "assistant",
      usage: { inputTokens: 100, outputTokens: 60, cacheReadTokens: 300, cacheWriteTokens: 100 },
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
      // panel must use the snapshot call's own input side plus its reply.
      usage: { inputTokens: 200, outputTokens: 150, cacheReadTokens: 600, cacheWriteTokens: 200 },
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
  assert.equal(usage.usedTokens, 1_150);
  assert.equal(usage.contextWindow, 100_000);
  assert.ok(Math.abs(usage.percent - 1.15) < 1e-9);
  assert.equal("cacheHitRate" in usage, false);
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

// Real session shape (s-20260913-tpyk): the last call's reported input plus
// its reply output is what the NEXT dispatch starts from — not the turn-
// aggregated usage (86k) and not the input alone (17.2k).
test("current context equals the last call's input plus its reply output", () => {
  const usage = deriveComposerContextUsage([
    {
      role: "assistant",
      usage: { inputTokens: 17_246, outputTokens: 2_393, cacheReadTokens: 0, cacheWriteTokens: 0 },
      contextBreakdown: {
        contextWindow: 1_048_576,
        estimatedTokens: 17_421,
        breakdown: { messages: 6_302, mcpTools: 0, systemTools: 4_185, systemPrompt: 6_840, skills: 94, other: 0 },
        inputTokens: 17_246,
        cacheReadTokens: 0,
        cacheWriteTokens: 0
      }
    }
  ]);
  assert.ok(usage);
  assert.equal(usage.usedTokens, 19_639);
  assert.ok(Math.abs(usage.percent - (19_639 / 1_048_576) * 100) < 1e-9);
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

// Sessions transcribed before snapshots existed still carry real per-turn
// usage: capacity renders from it (turn input + output), category rows hidden.
test("without a snapshot the panel degrades to reported usage plus the configured model window", () => {
  const usage = deriveComposerContextUsage([
    { role: "user" },
    {
      role: "assistant",
      usage: { inputTokens: 1_000, outputTokens: 500, cacheReadTokens: 27_000, cacheWriteTokens: 0 }
    }
  ], 200_000);
  assert.ok(usage);
  assert.equal(usage.usedTokens, 28_500);
  assert.equal(usage.contextWindow, 200_000);
  assert.ok(Math.abs(usage.percent - 14.25) < 1e-9);
  assert.deepEqual(usage.categories, []);
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

// The cumulative hit ratio comes from summed tokens (spec acceptance: 8,114
// cache-read of 84,028 full input = 9.66%; averaging the per-turn 9.9%/10.4%/8.7%
// would show 6.3%-style wrong numbers). Zero input stays null, never a fake 0%.
test("session usage folds cache into full input and derives the cumulative hit rate", () => {
  const view = deriveSessionUsageView({
    available: true,
    requests: 4,
    inputTokens: 75_914,
    outputTokens: 4_056,
    cacheReadTokens: 8_114,
    cacheWriteTokens: 0,
    totalTokens: 88_084,
    coverageStart: "2026-09-12T10:00:00.000Z"
  });

  assert.ok(view);
  assert.equal(view.inputTokens, 84_028);
  assert.equal(view.totalTokens, 88_084);
  assert.equal(view.outputTokens, 4_056);
  assert.ok(Math.abs((view.hitRate ?? 0) - 0.0966) < 0.0005);

  const noInput = deriveSessionUsageView({
    available: true,
    requests: 1,
    inputTokens: 0,
    outputTokens: 500,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 500,
    coverageStart: null
  });
  assert.equal(noInput?.hitRate, null);
});

test("session usage view is null when the ledger is unavailable, zero only when truly empty", () => {
  assert.equal(deriveSessionUsageView(null), null);
  assert.equal(
    deriveSessionUsageView({ available: false, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, coverageStart: null }),
    null
  );
  const empty = deriveSessionUsageView({
    available: true,
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    coverageStart: null
  });
  assert.deepEqual(
    empty && [empty.requests, empty.totalTokens, empty.inputTokens, empty.hitRate],
    [0, 0, 0, null]
  );
});
