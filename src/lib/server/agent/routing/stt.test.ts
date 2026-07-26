import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntimeSettings, type RuntimeSettings } from "$lib/server/settings/index.js";
import { transcribeAudioViaConfiguredProvider } from "$lib/server/agent/routing/stt.js";

const apiKey = "sk-stt-secret-12345678";

function sttSettings(): RuntimeSettings {
  return {
    ...defaultRuntimeSettings,
    modelRouting: {
      ...defaultRuntimeSettings.modelRouting,
      sttModelKey: "custom|diagnostic-stt|speech-model"
    },
    customProviders: [
      {
        id: "diagnostic-stt",
        name: "Diagnostic STT",
        enabled: true,
        baseUrl: "https://stt.example/v1",
        apiKey,
        path: "/audio/transcriptions",
        defaultModel: "speech-model",
        models: [
          {
            id: "speech-model",
            enabled: true,
            tags: ["stt"],
            supportedRoles: ["system", "user", "assistant", "tool"]
          }
        ]
      }
    ]
  };
}

async function captureSttWarning(response: Response): Promise<string> {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const warnings: string[] = [];

  globalThis.fetch = (async () => response) as typeof fetch;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((arg) => typeof arg === "string" ? arg : JSON.stringify(arg)).join(" "));
  };

  try {
    const result = await transcribeAudioViaConfiguredProvider({
      channel: "stt-test",
      settings: sttSettings(),
      data: Buffer.from("voice-bytes"),
      filename: "voice.ogg",
      mimeType: "audio/ogg",
      maxAttempts: 1
    });
    assert.equal(result.text, null);
    assert.match(result.errorMessage ?? "", /HTTP 403/);
    return warnings.join("\n");
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
}

test("STT 403 logs safe request metadata and allowlisted upstream diagnostics", async () => {
  const logs = await captureSttWarning(new Response("", {
    status: 403,
    statusText: "Forbidden",
    headers: {
      "content-type": "application/json",
      "x-siliconcloud-trace-id": "trace-403",
      "retry-after": "30",
      "set-cookie": "session=private"
    }
  }));

  assert.match(logs, /voice_transcription_http_error/);
  assert.match(logs, /diagnostic-stt/);
  assert.match(logs, /speech-model/);
  assert.match(logs, /voice\.ogg/);
  assert.match(logs, /audio\/ogg/);
  assert.match(logs, /audioBytes[^\d]*11/);
  assert.match(logs, /requestDurationMs[^\d]*\d+/);
  assert.match(logs, /trace-403/);
  assert.match(logs, /retry-after/);
  assert.match(logs, /responseBodyEmpty[^a-z]*true/i);
  assert.match(logs, /<empty>/);
  assert.doesNotMatch(logs, /session=private/);
});

test("STT provider response logging redacts credential-shaped text", async () => {
  const logs = await captureSttWarning(new Response(JSON.stringify({
    error: `Forbidden for Bearer ${apiKey}`,
    api_key: apiKey
  }), {
    status: 403,
    statusText: "Forbidden",
    headers: {
      "x-request-id": "request-403",
      server: apiKey
    }
  }));

  assert.match(logs, /request-403/);
  assert.match(logs, /<redacted>/);
  assert.doesNotMatch(logs, new RegExp(apiKey));
});
