import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "@sinclair/typebox";
import { createToolSearchTool, type DeferredToolEntry } from "$lib/server/agent/tools/toolSearch.js";

function createDeferredEntry(): DeferredToolEntry {
  return {
    name: "imageGenerate",
    label: "imageGenerate",
    description: "Generate high-quality images based on text descriptions, save locally, and automatically send to chat.",
    keywords: [
      "image",
      "generate",
      "poster"
    ],
    tool: {
      name: "imageGenerate",
      label: "imageGenerate",
      description: "Generate high-quality images based on text descriptions.",
      parameters: Type.Object({ prompt: Type.String() }),
      execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} })
    }
  };
}

function createTtsDeferredEntry(): DeferredToolEntry {
  return {
    name: "ttsGenerate",
    label: "ttsGenerate",
    description: "Convert text into speech audio, save locally, and automatically send to chat.",
    keywords: ["tts", "speech", "voiceover"],
    tool: {
      name: "ttsGenerate",
      label: "ttsGenerate",
      description: "Convert text into speech audio.",
      parameters: Type.Object({ text: Type.String() }),
      execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} })
    }
  };
}

test("toolSearch loads imageGenerate by direct deferred-tool selection", async () => {
  const loadedNames: string[] = [];
  const tool = createToolSearchTool({
    chatId: "chat-1",
    getDeferredTools: () => [createDeferredEntry()],
    loadDeferredTools: (toolNames) => {
      loadedNames.push(...toolNames);
      return toolNames;
    }
  });

  const result = await tool.execute("call-1", {
    query: "select:imageGenerate"
  });
  const text = result.content.map((item: any) => String(item.text ?? "")).join("\n");

  assert.deepEqual(loadedNames, ["imageGenerate"]);
  assert.deepEqual(result.details.loaded, ["imageGenerate"]);
  assert.match(text, /Loaded deferred tools: imageGenerate/);
  assert.match(text, /"name":"imageGenerate"/);
});

test("toolSearch loads ttsGenerate by direct deferred-tool selection", async () => {
  const loadedNames: string[] = [];
  const tool = createToolSearchTool({
    chatId: "chat-1",
    getDeferredTools: () => [createTtsDeferredEntry()],
    loadDeferredTools: (toolNames) => {
      loadedNames.push(...toolNames);
      return toolNames;
    }
  });

  const result = await tool.execute("call-1", { query: "select:ttsGenerate" });
  const text = result.content.map((item: any) => String(item.text ?? "")).join("\n");

  assert.deepEqual(loadedNames, ["ttsGenerate"]);
  assert.deepEqual(result.details.loaded, ["ttsGenerate"]);
  assert.match(text, /Loaded deferred tools: ttsGenerate/);
  assert.match(text, /"name":"ttsGenerate"/);
});

test("toolSearch reports malformed direct selections while loading valid matches", async () => {
  const loadedNames: string[] = [];
  const tool = createToolSearchTool({
    chatId: "chat-selection",
    getDeferredTools: () => [createDeferredEntry(), createTtsDeferredEntry()],
    loadDeferredTools: (names) => { loadedNames.push(...names); return names; }
  });
  const result = await tool.execute("partial", {
    query: "select:imageGenerate,miniapp note create_note tool schema"
  });
  const text = result.content.map((item: any) => item.text ?? "").join("\n");
  assert.deepEqual(loadedNames, ["imageGenerate"]);
  assert.deepEqual(result.details.unmatched, ["miniapp note create_note tool schema"]);
  assert.match(text, /Unmatched direct selections/);
  assert.match(text, /without select:/);
  assert.match(text, /Available deferred tools: imageGenerate, ttsGenerate/);
  assert.match(text, /"name":"imageGenerate"/);

  const missing = await tool.execute("missing", { query: "select:unknown" });
  assert.deepEqual(missing.details.unmatched, ["unknown"]);
  assert.deepEqual(missing.details.loaded, []);
  assert.deepEqual(loadedNames, ["imageGenerate"]);
});
