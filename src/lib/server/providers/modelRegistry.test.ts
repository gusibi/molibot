import test from "node:test";
import assert from "node:assert/strict";
import { ModelRegistryService, type RemoteModelsRegistry } from "./modelRegistry.js";

const mockRegistry: RemoteModelsRegistry = {
  "hpc-ai": {
    id: "hpc-ai",
    name: "HPC AI",
    models: {
      "deepseek/deepseek-v4-flash": {
        id: "deepseek/deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        description: "Fast DeepSeek V4 lane",
        reasoning: true,
        reasoning_options: [{ type: "effort", values: ["high", "max"] }],
        tool_call: true,
        structured_output: true,
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 1048576, output: 128000 }
      }
    }
  },
  "neuralwatt": {
    id: "neuralwatt",
    name: "NeuralWatt",
    models: {
      "kimi-k3": {
        id: "kimi-k3",
        name: "Kimi K3",
        description: "Multimodal Kimi model",
        attachment: true,
        reasoning: true,
        reasoning_options: [{ type: "toggle" }, { type: "effort", values: ["low", "high", "max"] }],
        tool_call: true,
        interleaved: { field: "reasoning_content" },
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 1048576, output: 128000 }
      },
      "voice-agent-v1": {
        id: "voice-agent-v1",
        name: "Voice Agent V1",
        modalities: { input: ["text", "audio"], output: ["text", "audio"] },
        tool_call: false,
        limit: { context: 32768, output: 4096 }
      }
    }
  }
};

test("ModelRegistryService matches models by exact, prefix, and normalized ID", () => {
  const registry = new ModelRegistryService("/tmp/test-registry-cache");
  registry.buildIndex(mockRegistry);

  // Exact ID
  const direct = registry.inferModelCapabilities("deepseek/deepseek-v4-flash");
  assert.equal(direct.matched, true);
  assert.equal(direct.alias, "DeepSeek V4 Flash");
  assert.equal(direct.contextWindow, 1048576);
  assert.equal(direct.maxTokens, 128000);
  assert.deepEqual(direct.tags, ["text", "tool"]);
  assert.equal(direct.reasoning, true);
  assert.equal(direct.thinking?.format, "thought_tag");

  // Prefix stripped match (user enters deepseek-v4-flash)
  const stripped = registry.inferModelCapabilities("deepseek-v4-flash");
  assert.equal(stripped.matched, true);
  assert.equal(stripped.alias, "DeepSeek V4 Flash");
  assert.equal(stripped.contextWindow, 1048576);

  // Multimodal model Kimi K3
  const kimi = registry.inferModelCapabilities("kimi-k3");
  assert.equal(kimi.matched, true);
  assert.equal(kimi.vision, true);
  assert.deepEqual(kimi.tags, ["text", "vision", "tool"]);
  assert.equal(kimi.thinking?.format, "reasoning_content");
  assert.equal(kimi.contextWindow, 1048576);

  // Audio / voice model
  const voice = registry.inferModelCapabilities("voice-agent-v1");
  assert.equal(voice.matched, true);
  assert.equal(voice.audioInput, true);
  assert.equal(voice.stt, true);
  assert.equal(voice.tts, true);
  assert.equal(voice.toolCall, false);
  assert.deepEqual(voice.tags, ["text", "audio_input", "stt", "tts"]);
  assert.equal(voice.contextWindow, 32768);
});

test("ModelRegistryService falls back gracefully on unknown models", () => {
  const registry = new ModelRegistryService("/tmp/test-registry-cache");
  registry.buildIndex(mockRegistry);

  const unknown = registry.inferModelCapabilities("completely-unknown-custom-model");
  assert.equal(unknown.matched, false);
  assert.deepEqual(unknown.tags, ["text"]);
  assert.deepEqual(unknown.supportedRoles, ["system", "user", "assistant", "tool"]);
  assert.equal(unknown.contextWindow, undefined);
});
