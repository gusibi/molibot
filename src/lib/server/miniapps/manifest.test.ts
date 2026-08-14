import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readMiniAppManifest } from "$lib/server/miniapps/manifest.js";

function withManifest(
  mutate: (manifest: Record<string, unknown>) => void,
  run: (result: ReturnType<typeof readMiniAppManifest>) => void
): void {
  const root = mkdtempSync(join(tmpdir(), "molibot-miniapp-manifest-"));
  const appDir = join(root, "capture-app");
  mkdirSync(join(appDir, "server"), { recursive: true });
  mkdirSync(join(appDir, "ui"), { recursive: true });
  writeFileSync(join(appDir, "server", "index.mjs"), "export default () => ({ tools: {}, handleHttp: async () => ({}) });");
  writeFileSync(join(appDir, "ui", "index.html"), "<!doctype html>");
  const manifest: Record<string, unknown> = {
    manifestVersion: 1,
    id: "capture-app",
    name: "Capture App",
    version: "1.0.0",
    engines: { molibot: ">=2.9.8" },
    runtime: { entry: "server/index.mjs" },
    ui: { entry: "ui/index.html" },
    data: { schemaVersion: 1 },
    tools: [{
      name: "save",
      description: "Save captured content.",
      inputSchema: {
        type: "object",
        properties: { capture: { type: "object" } },
        required: ["capture"],
        additionalProperties: false
      },
      destructiveHint: false
    }]
  };
  mutate(manifest);
  writeFileSync(join(appDir, "manifest.json"), JSON.stringify(manifest));
  try {
    run(readMiniAppManifest(appDir, "capture-app"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("a valid message action is preserved by manifest validation", () => {
  withManifest(
    (manifest) => {
      manifest.contributions = {
        messageActions: [{
          tool: "save",
          label: { zh: "保存", en: "Save" },
          icon: "star",
          accepts: ["text", "image"]
        }]
      };
    },
    (result) => {
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.deepEqual(result.value.manifest.contributions?.messageActions, [{
        tool: "save",
        label: { zh: "保存", en: "Save" },
        icon: "star",
        accepts: ["text", "image"]
      }]);
    }
  );
});

test("AI capabilities and controlled upload limits are strict and preserved", () => {
  withManifest(
    (manifest) => {
      manifest.ai = {
        capabilities: ["text", "transcription"],
        uploadLimits: [{ path: "/api/segments", maxBytes: 25 * 1024 * 1024 }]
      };
    },
    (result) => {
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.deepEqual(result.value.manifest.ai, {
        capabilities: ["text", "transcription"],
        uploadLimits: [{ path: "/api/segments", maxBytes: 25 * 1024 * 1024 }]
      });
    }
  );

  withManifest(
    (manifest) => {
      manifest.ai = { capabilities: ["text"], uploadLimits: [{ path: "/api/upload", maxBytes: 1 }] };
    },
    (result) => {
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /transcription/);
    }
  );
});

test("host device capabilities are strict and preserved", () => {
  withManifest(
    (manifest) => { manifest.host = { capabilities: ["audioCapture", "audioCapture"] }; },
    (result) => {
      assert.equal(result.ok, true);
      if (result.ok) assert.deepEqual(result.value.manifest.host, { capabilities: ["audioCapture"] });
    }
  );
  withManifest(
    (manifest) => { manifest.host = { capabilities: ["filesystem"] }; },
    (result) => {
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /unsupported/);
    }
  );
});

test("message action nested fields, destructive tools, counts, capture schemas, and accepts fail closed", () => {
  const invalidCases: Array<{ mutate: (manifest: Record<string, unknown>) => void; pattern: RegExp }> = [
    { mutate: (manifest) => { manifest.contributions = { messageActions: [{ tool: "save", label: { zh: "保存" } }] }; }, pattern: /zh and en/ },
    { mutate: (manifest) => { manifest.contributions = { messageActions: [{ tool: "save", label: { zh: "保存", en: "Save" }, icon: "Star!" }] }; }, pattern: /icon/ },
    { mutate: (manifest) => { manifest.contributions = { messageActions: [{ tool: "save", label: { zh: "保存", en: "Save" }, accepts: ["video"] }] }; }, pattern: /accepts/ },
    { mutate: (manifest) => { manifest.contributions = { messageActions: Array.from({ length: 4 }, () => ({ tool: "save", label: { zh: "保存", en: "Save" } })) }; }, pattern: /at most 3/ },
    { mutate: (manifest) => { manifest.contributions = { messageActions: [{ tool: "save", label: { zh: "保存", en: "Save" }, surprise: true }] }; }, pattern: /unknown field/ },
    { mutate: (manifest) => {
      const tools = manifest.tools as Array<Record<string, unknown>>;
      tools[0].destructiveHint = true;
      manifest.contributions = { messageActions: [{ tool: "save", label: { zh: "保存", en: "Save" } }] };
    }, pattern: /destructive/ },
    { mutate: (manifest) => {
      const tools = manifest.tools as Array<Record<string, unknown>>;
      tools[0].inputSchema = { type: "object", properties: {}, additionalProperties: false };
      manifest.contributions = { messageActions: [{ tool: "save", label: { zh: "保存", en: "Save" } }] };
    }, pattern: /capture property/ }
  ];
  for (const invalid of invalidCases) {
    withManifest(invalid.mutate, (result) => {
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, invalid.pattern);
    });
  }
});

test("AI nested objects reject unknown capabilities, fields, routes, and oversized limits", () => {
  const cases: Array<{ ai: unknown; pattern: RegExp }> = [
    { ai: { capabilities: ["image"] }, pattern: /unsupported/ },
    { ai: { capabilities: ["text"], surprise: true }, pattern: /unknown field/ },
    { ai: { capabilities: ["transcription"], uploadLimits: [{ path: "/upload", maxBytes: 1 }] }, pattern: /normalized/ },
    { ai: { capabilities: ["transcription"], uploadLimits: [{ path: "/api/upload", maxBytes: 25 * 1024 * 1024 + 1 }] }, pattern: /25 MiB/ },
    { ai: { capabilities: ["transcription"], uploadLimits: [{ path: "/api/upload", maxBytes: 1, surprise: true }] }, pattern: /unknown field/ }
  ];
  for (const entry of cases) {
    withManifest((manifest) => { manifest.ai = entry.ai; }, (result) => {
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, entry.pattern);
    });
  }
});
