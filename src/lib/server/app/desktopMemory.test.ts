import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeSettings } from "$lib/server/settings/schema";
import type { MemoryBackendCapabilities } from "$lib/server/memory/types";
import { buildDesktopMemorySummary } from "./desktopMemory";

function caps(overrides: Partial<MemoryBackendCapabilities> = {}): MemoryBackendCapabilities {
  return {
    supportsHybridSearch: true,
    supportsVectorSearch: false,
    supportsIncrementalFlush: true,
    supportsLayeredMemory: false,
    ...overrides
  };
}

test("buildDesktopMemorySummary maps config + runtime state + capabilities", () => {
  const summary = buildDesktopMemorySummary(
    { plugins: { memory: { enabled: true, backend: "mory", embeddingProviderId: "", embeddingModel: "" } } } as RuntimeSettings,
    { enabled: true, capabilities: caps() }
  );

  assert.equal(summary.enabled, true);
  assert.equal(summary.configEnabled, true);
  assert.equal(summary.backend, "mory");
  assert.deepEqual(summary.capabilities, {
    hybridSearch: true,
    vectorSearch: false,
    incrementalFlush: true,
    layeredMemory: false,
    domains: false,
    versioning: false,
    candidates: false
  });
});

test("buildDesktopMemorySummary falls back when memory config is absent", () => {
  const summary = buildDesktopMemorySummary(
    {} as RuntimeSettings,
    { enabled: false, capabilities: caps({ supportsHybridSearch: false, supportsIncrementalFlush: false }) }
  );

  assert.equal(summary.enabled, false);
  assert.equal(summary.configEnabled, false);
  assert.equal(summary.backend, "");
  assert.equal(summary.capabilities.hybridSearch, false);
  assert.equal(summary.capabilities.incrementalFlush, false);
});
