import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { MiniAppHost } from "$lib/server/miniapps/host.js";
import { _handleMiniAppInvokeRequest } from "./+server.js";

test("desktop invoke route returns an App action result and overwrites capture authority", async () => {
  let input: any;
  const host = {
    listCatalog: () => [{
      id: "capture-app",
      enabled: true,
      status: "active",
      messageActions: [{ tool: "save", label: { zh: "保存", en: "Save" }, accepts: ["text"] }]
    }],
    invokeTool: async (_toolId: string, value: unknown) => {
      input = value;
      return { content: [{ type: "text" as const, text: "saved" }] };
    }
  } as unknown as MiniAppHost;
  const request = new Request("http://localhost/api/desktop/miniapps/invoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      appId: "capture-app",
      tool: "save",
      capture: { text: "hello", role: "assistant", source: { channel: "forged" } }
    })
  });

  const response = await _handleMiniAppInvokeRequest(request, {
    host,
    channel: "desktop",
    now: new Date("2026-08-06T03:00:00.000Z")
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    content: [{ type: "text", text: "saved" }]
  });
  assert.equal(input.capture.source.channel, "desktop");
  assert.equal(input.capture.capturedAt, "2026-08-06T03:00:00.000Z");
});

test("desktop invoke stages an accepted attachment before invoking the App", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-action-route-"));
  let input: any;
  try {
    const sourcePath = path.join(root, "secret-source.png");
    fs.writeFileSync(sourcePath, "image");
    const host = {
      listCatalog: () => [{
        id: "capture-app",
        enabled: true,
        status: "active",
        messageActions: [{ tool: "save", label: { zh: "保存", en: "Save" }, accepts: ["text", "image"] }]
      }],
      invokeTool: async (_toolId: string, value: unknown) => {
        input = value;
        return { content: [{ type: "text" as const, text: "saved" }] };
      }
    } as unknown as MiniAppHost;
    const request = new Request("http://localhost/api/desktop/miniapps/invoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        appId: "capture-app",
        tool: "save",
        capture: { text: "image", role: "user" },
        resources: [{ sessionId: "opaque", fileId: "opaque" }]
      })
    });
    const response = await _handleMiniAppInvokeRequest(request, {
      host,
      channel: "desktop",
      dataRoot: path.join(root, "data"),
      resolveResource: async () => ({ sourcePath, original: "photo.png", kind: "image", mimeType: "image/png" })
    });

    assert.equal(response.status, 200);
    assert.equal(input.capture.resources[0].kind, "image");
    assert.match(input.capture.resources[0].path, /^incoming\//);
    assert.equal(JSON.stringify(input.capture).includes(sourcePath), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
