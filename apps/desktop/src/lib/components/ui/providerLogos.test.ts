import { test } from "node:test";
import assert from "node:assert/strict";
import { getProviderLogoKey, getProviderLogoSvg, PROVIDER_LOGOS } from "./providerLogos.js";

test("providerLogos recognizes common provider IDs", () => {
  assert.equal(getProviderLogoKey("openai"), "openai");
  assert.equal(getProviderLogoKey("openai-codex"), "openai");
  assert.equal(getProviderLogoKey("anthropic"), "anthropic");
  assert.equal(getProviderLogoKey("claude"), "anthropic");
  assert.equal(getProviderLogoKey("deepseek"), "deepseek");
  assert.equal(getProviderLogoKey("google"), "google");
  assert.equal(getProviderLogoKey("google-vertex"), "google");
  assert.equal(getProviderLogoKey("moonshotai"), "moonshot");
  assert.equal(getProviderLogoKey("kimi-coding"), "moonshot");
  assert.equal(getProviderLogoKey("minimax-cn"), "minimax");
  assert.equal(getProviderLogoKey("qwen-token-plan"), "qwen");
  assert.equal(getProviderLogoKey("zai-coding-cn"), "zai");
  assert.equal(getProviderLogoKey("xai"), "xai");
  assert.equal(getProviderLogoKey("amazon-bedrock"), "bedrock");
  assert.equal(getProviderLogoKey("azure-openai-responses"), "azure");
  assert.equal(getProviderLogoKey("github-copilot"), "github");
  assert.equal(getProviderLogoKey("siliconflow"), "siliconflow");
  assert.equal(getProviderLogoKey("custom-provider-unknown"), null);
});

test("providerLogos recognizes provider names when id is generic", () => {
  assert.equal(getProviderLogoKey("custom-1", "My OpenAI Proxy"), "openai");
  assert.equal(getProviderLogoKey("custom-2", "DeepSeek API"), "deepseek");
  assert.equal(getProviderLogoKey("custom-3", "Claude 3.5 Sonnet Relay"), "anthropic");
  assert.equal(getProviderLogoKey("custom-4", "Kimi Chat Gateway"), "moonshot");
});

test("getProviderLogoSvg returns valid SVG markup for known keys", () => {
  const svg = getProviderLogoSvg("anthropic");
  assert.ok(svg && svg.startsWith("<svg") && svg.endsWith("</svg>"));
  assert.equal(getProviderLogoSvg("unknown-something"), null);
});
