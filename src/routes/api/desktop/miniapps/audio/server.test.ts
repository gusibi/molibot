import assert from "node:assert/strict";
import test from "node:test";
import { _handleMiniAppAudioRequest } from "./+server.js";

function request(body: unknown): Request {
  return new Request("http://localhost/api/desktop/miniapps/audio", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function host(capabilities: string[] = ["audioCapture"]) {
  const calls: Array<{ path: string; request: Request }> = [];
  return {
    calls,
    listCatalog: () => [{ id: "meeting-notes", enabled: true, status: "active", hostCapabilities: capabilities }],
    handleHttp: async (_appId: string, forwarded: Request, path: string) => {
      calls.push({ path, request: forwarded });
      return new Response(JSON.stringify({ ok: true }), { status: 202 });
    }
  };
}

test("audio chunks only reach a declared app capability and preserve timing", async () => {
  const target = host();
  const response = await _handleMiniAppAudioRequest(request({
    action: "chunk",
    appId: "meeting-notes",
    meetingId: "meeting_1",
    trackId: "microphone",
    seq: 3,
    startMs: 30000,
    endMs: 40000,
    mimeType: "audio/wav",
    audioBase64: Buffer.from("wav").toString("base64")
  }), target as never);
  assert.equal(response.status, 202);
  assert.equal(target.calls[0].path, "/chunks/meeting_1");
  assert.equal(new URL(target.calls[0].request.url).searchParams.get("seq"), "3");
  assert.deepEqual(Buffer.from(await target.calls[0].request.arrayBuffer()), Buffer.from("wav"));
});

test("finish carries the explicit last sequence barrier", async () => {
  const target = host();
  const response = await _handleMiniAppAudioRequest(request({
    action: "finish",
    appId: "meeting-notes",
    meetingId: "meeting_1",
    trackId: "microphone",
    expectedLastSeq: 8,
    endMs: 81234,
    captureError: "audio callback overloaded"
  }), target as never);
  assert.equal(response.status, 202);
  assert.deepEqual(await target.calls[0].request.json(), {
    tracks: [{ id: "microphone", expectedLastSeq: 8, endMs: 81234 }],
    captureError: "audio callback overloaded"
  });
});

test("audio is denied without the manifest capability", async () => {
  const target = host([]);
  const response = await _handleMiniAppAudioRequest(request({
    action: "finish", appId: "meeting-notes", meetingId: "meeting_1", trackId: "microphone", expectedLastSeq: 0, endMs: 1
  }), target as never);
  assert.equal(response.status, 403);
  assert.equal(target.calls.length, 0);
});

test("adapter body-limit failures are reported as an upload-size error", async () => {
  const oversized = new Request("http://localhost/api/desktop/miniapps/audio", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: new ReadableStream({
      pull(controller) {
        controller.error(new Error("request body size exceeded BODY_SIZE_LIMIT of 524288"));
      }
    }),
    duplex: "half"
  } as RequestInit & { duplex: "half" });
  const response = await _handleMiniAppAudioRequest(oversized, host() as never);
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { ok: false, error: "Audio upload exceeded the service request limit." });
});
