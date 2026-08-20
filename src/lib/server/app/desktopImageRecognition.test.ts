import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import {
  buildDesktopImageRecognitionSummary,
  buildImageRecognitionSettingsInput,
  isDesktopImageRecognitionUpdateRequest
} from "./desktopImageRecognition.js";

test("desktop image recognition projection preserves failover order without credentials", () => {
  const settings = structuredClone(defaultRuntimeSettings);
  settings.imageRecognition = {
    enabled: true,
    defaultEngine: "auto",
    engineOrder: ["primary", "backup"],
    engines: {
      primary: { enabled: true, name: "Primary", modelKey: "pi|openai|gpt-4.1" },
      backup: { enabled: false, name: "Backup", modelKey: "pi|google|gemini-2.5-flash" }
    }
  };
  const summary = buildDesktopImageRecognitionSummary(settings);
  assert.deepEqual(summary.engines.map((engine) => engine.id), ["primary", "backup"]);
  assert.deepEqual(summary.adapterTypes, ["api"]);
  assert.deepEqual(summary.plannedAdapterTypes, ["cli"]);
});

test("desktop image recognition request maps ordered engines to runtime settings", () => {
  const request = {
    enabled: true,
    defaultEngine: "backup",
    engines: [
      { id: "primary", enabled: true, name: "Primary", modelKey: "pi|openai|gpt-4.1" },
      { id: "backup", enabled: true, name: "Backup", modelKey: "custom|local|vision" }
    ]
  };
  assert.equal(isDesktopImageRecognitionUpdateRequest(request), true);
  const value = buildImageRecognitionSettingsInput(request);
  assert.deepEqual(value.engineOrder, ["primary", "backup"]);
  assert.equal(value.defaultEngine, "backup");
  assert.equal(value.engines.backup.modelKey, "custom|local|vision");
});

test("desktop image recognition rejects duplicate, malformed, and missing default engines", () => {
  const engine = { id: "primary", enabled: true, name: "Primary", modelKey: "pi|openai|gpt-4.1" };
  assert.equal(isDesktopImageRecognitionUpdateRequest({ enabled: true, defaultEngine: "auto", engines: [engine, engine] }), false);
  assert.equal(isDesktopImageRecognitionUpdateRequest({ enabled: true, defaultEngine: "missing", engines: [engine] }), false);
  assert.equal(isDesktopImageRecognitionUpdateRequest({ enabled: true, defaultEngine: "auto", engines: [{ ...engine, modelKey: "openai" }] }), false);
});
