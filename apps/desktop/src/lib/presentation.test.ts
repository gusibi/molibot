import assert from "node:assert/strict";
import test from "node:test";
import {
  formatNaturalDateTime,
  formatNaturalSchedule,
  humanizeModelOption,
  modelOptionCopy,
  humanizeProviderName,
  humanizeTechnicalName
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
