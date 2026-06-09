# TTS Generate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared Agent-layer deferred `ttsGenerate` tool with independent `/settings/tts` configuration for macOS system voices and Xiaomi MiMo TTS.

**Architecture:** Implement the feature as a provider-based Agent tool under `src/lib/server/agent/ttsGenerate/`, then wire it into runtime settings, deferred-tool discovery, prompt routing, settings APIs, and the settings UI. Keep all synthesis, artifact writing, and shared upload handling in the Agent layer; Channel code remains unchanged.

**Tech Stack:** TypeScript, SvelteKit, Svelte 5, Shadcn Svelte components, `@sinclair/typebox`, Node built-in `node:test`, Node `child_process.spawn`, built-in `fetch`, existing Molibot settings store and tool path guard utilities.

---

## File structure and responsibilities

### Create

- `src/lib/server/agent/ttsGenerate/types.ts`
  - Provider IDs, provider input/result/context interfaces, voice/model metadata constants, and audio format helpers.
- `src/lib/server/agent/ttsGenerate/providers.ts`
  - Xiaomi MiMo request/response mapping and macOS `say` process execution.
- `src/lib/server/agent/ttsGenerate/providers.test.ts`
  - Unit tests for Xiaomi request construction, base64 decoding, response errors, macOS availability, and safe spawn arguments.
- `src/lib/server/agent/ttsGenerate/ttsGenerateTool.ts`
  - `AgentTool` factory with TypeBox schema, settings resolution, output path routing, provider dispatch, file save, upload handling, and standard result details.
- `src/lib/server/agent/ttsGenerate/ttsGenerateTool.test.ts`
  - Tool-level behavior tests for default provider selection, disabled config, generated file persistence, upload handling, and partial upload success.
- `src/routes/api/settings/tts-generate/test/+server.ts`
  - Settings-page test endpoint that runs the real tool against unsaved form state in a data-dir scratch folder.
- `src/routes/api/settings/tts-generate/voices/+server.ts`
  - Voice discovery endpoint for macOS `say -v ?` with safe degraded output on non-macOS.
- `src/routes/settings/tts/+page.svelte`
  - Independent TTS settings page with global enable, provider defaults, macOS card, Xiaomi card, test controls, and fixed save footbar.

### Modify

- `src/lib/server/settings/schema.ts`
  - Add `TtsGenerateProviderId`, provider settings interfaces, `TtsGenerateSettings`, and `RuntimeSettings.ttsGenerate`.
- `src/lib/server/settings/defaults.ts`
  - Add environment-backed default TTS settings.
- `src/lib/server/settings/sanitize.ts`
  - Add `sanitizeTtsGenerateSettings` and include it in `sanitizeSettings`.
- `src/lib/server/settings/store.ts`
  - Add `ttsGenerate` to dynamic settings persistence and static-to-dynamic migration.
- `src/lib/server/settings/sanitize.test.ts`
  - Add TTS backfill and sanitizer regression coverage.
- `src/lib/server/agent/tools/index.ts`
  - Create the runtime `ttsGenerate` tool and register the deferred entry.
- `src/lib/server/agent/tools/index.test.ts`
  - Verify deferred registration.
- `src/lib/server/agent/tools/toolSearch.test.ts`
  - Verify `select:ttsGenerate` loads the full schema.
- `src/lib/server/agent/prompts/prompt.ts`
  - Add TTS short-circuit routing, deferred tool list entry, and public tool summary.
- `src/lib/server/agent/prompts/prompt.test.ts`
  - Verify prompt routing and fallback avoidance.
- `src/routes/api/settings/dynamic/[key]/+server.ts`
  - Add `tts-generate`, `ttsGenerate`, and `settings_tts_generate` key aliases.
- `src/routes/settings/+layout.svelte`
  - Add localized sidebar label and `/settings/tts` navigation entry.
- `README.md`, `features.md`, `prd.md`, `CHANGELOG.md`
  - Document delivered TTS capability, environment variables, settings page, and acceptance status.

---

## Task 1: Add TTS settings schema, defaults, and sanitizer

**Files:**
- Modify: `src/lib/server/settings/schema.ts`
- Modify: `src/lib/server/settings/defaults.ts`
- Modify: `src/lib/server/settings/sanitize.ts`
- Test: `src/lib/server/settings/sanitize.test.ts`

- [ ] **Step 1: Write failing sanitizer tests**

Add these tests after the existing imageGenerate tests in `src/lib/server/settings/sanitize.test.ts`:

```ts
test("sanitizeSettings backfills ttsGenerate for legacy settings", () => {
  const legacySettings = { ...defaultRuntimeSettings } as Partial<RuntimeSettings>;
  delete legacySettings.ttsGenerate;

  const sanitized = sanitizeSettings({}, legacySettings as RuntimeSettings);

  assert.equal(sanitized.ttsGenerate.enabled, defaultRuntimeSettings.ttsGenerate.enabled);
  assert.equal(sanitized.ttsGenerate.defaultProvider, "macos");
  assert.deepEqual(Object.keys(sanitized.ttsGenerate.providers).sort(), ["macos", "xiaomi"]);
  assert.equal(sanitized.ttsGenerate.providers.xiaomi.model, "mimo-v2-tts");
  assert.equal(sanitized.ttsGenerate.providers.xiaomi.voice, "mimo_default");
});

test("sanitizeSettings normalizes ttsGenerate provider fields", () => {
  const sanitized = sanitizeSettings({
    ttsGenerate: {
      enabled: true,
      defaultProvider: "invalid-provider",
      providers: {
        macos: {
          enabled: "",
          voice: "  Tingting  "
        },
        xiaomi: {
          enabled: true,
          apiKey: "  secret-key  ",
          baseUrl: "  https://api.xiaomimimo.com/v1/  ",
          model: "  mimo-v2-tts  ",
          voice: "  default_zh  ",
          format: "  wav  "
        }
      }
    }
  }, defaultRuntimeSettings);

  assert.equal(sanitized.ttsGenerate.enabled, true);
  assert.equal(sanitized.ttsGenerate.defaultProvider, defaultRuntimeSettings.ttsGenerate.defaultProvider);
  assert.equal(sanitized.ttsGenerate.providers.macos.enabled, false);
  assert.equal(sanitized.ttsGenerate.providers.macos.voice, "Tingting");
  assert.equal(sanitized.ttsGenerate.providers.xiaomi.enabled, true);
  assert.equal(sanitized.ttsGenerate.providers.xiaomi.apiKey, "secret-key");
  assert.equal(sanitized.ttsGenerate.providers.xiaomi.baseUrl, "https://api.xiaomimimo.com/v1");
  assert.equal(sanitized.ttsGenerate.providers.xiaomi.model, "mimo-v2-tts");
  assert.equal(sanitized.ttsGenerate.providers.xiaomi.voice, "default_zh");
  assert.equal(sanitized.ttsGenerate.providers.xiaomi.format, "wav");
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
node --import ./scripts/register-loader.js --import tsx --test src/lib/server/settings/sanitize.test.ts
```

Expected: FAIL with TypeScript/runtime errors indicating `ttsGenerate` does not exist on `RuntimeSettings` or `defaultRuntimeSettings`.

- [ ] **Step 3: Add schema types**

In `src/lib/server/settings/schema.ts`, insert this block after `VideoGenerateSettings`:

```ts
export type TtsGenerateProviderId = "macos" | "xiaomi";

export type TtsGenerateAudioFormat = "wav" | "aiff" | "m4a" | "caf";

export interface TtsGenerateMacosProviderSettings {
  enabled: boolean;
  voice: string;
  format: TtsGenerateAudioFormat;
}

export interface TtsGenerateXiaomiProviderSettings {
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  model: string;
  voice: string;
  format: TtsGenerateAudioFormat;
}

export interface TtsGenerateProviderSettingsMap {
  macos: TtsGenerateMacosProviderSettings;
  xiaomi: TtsGenerateXiaomiProviderSettings;
}

export interface TtsGenerateSettings {
  enabled: boolean;
  defaultProvider: TtsGenerateProviderId;
  providers: TtsGenerateProviderSettingsMap;
}
```

Then add this property to `RuntimeSettings` immediately after `videoGenerate`:

```ts
  ttsGenerate: TtsGenerateSettings;
```

- [ ] **Step 4: Add default settings**

In `src/lib/server/settings/defaults.ts`, update imports to include the new types:

```ts
import type {
  ImageGenerateEngineId,
  ImageGenerateSettings,
  RuntimeSettings,
  TtsGenerateProviderId,
  TtsGenerateSettings,
  VideoGenerateEngineId,
  VideoGenerateSettings
} from "$lib/server/settings/schema.js";
```

If the file uses a different existing import shape, add `TtsGenerateProviderId` and `TtsGenerateSettings` to that existing import instead of creating a duplicate import.

Add this helper block after `defaultVideoGenerateSettings`:

```ts
function normalizeBaseUrl(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.replace(/\/+$/, "");
}

const defaultTtsGenerateSettings: TtsGenerateSettings = {
  enabled: String(process.env.MOLIBOT_TTS_GENERATE_ENABLED ?? "true").toLowerCase() !== "false",
  defaultProvider: (process.env.MOLIBOT_TTS_GENERATE_DEFAULT_PROVIDER ?? "macos") as TtsGenerateProviderId,
  providers: {
    macos: {
      enabled: String(process.env.MOLIBOT_TTS_MACOS_ENABLED ?? "true").toLowerCase() !== "false",
      voice: String(process.env.MOLIBOT_TTS_MACOS_VOICE ?? "").trim(),
      format: "aiff"
    },
    xiaomi: {
      enabled: String(process.env.MOLIBOT_TTS_XIAOMI_ENABLED ?? "").trim()
        ? String(process.env.MOLIBOT_TTS_XIAOMI_ENABLED).toLowerCase() !== "false"
        : Boolean(String(process.env.MOLIBOT_TTS_XIAOMI_API_KEY ?? "").trim()),
      apiKey: String(process.env.MOLIBOT_TTS_XIAOMI_API_KEY ?? "").trim(),
      baseUrl: normalizeBaseUrl(String(process.env.MOLIBOT_TTS_XIAOMI_BASE_URL ?? ""), "https://api.xiaomimimo.com/v1"),
      model: String(process.env.MOLIBOT_TTS_XIAOMI_MODEL ?? "mimo-v2-tts").trim() || "mimo-v2-tts",
      voice: String(process.env.MOLIBOT_TTS_XIAOMI_VOICE ?? "mimo_default").trim() || "mimo_default",
      format: "wav"
    }
  }
};
```

Then add this property to `defaultRuntimeSettings` after `videoGenerate`:

```ts
  ttsGenerate: defaultTtsGenerateSettings,
```

- [ ] **Step 5: Add sanitizer**

In `src/lib/server/settings/sanitize.ts`, update imports to include:

```ts
  type TtsGenerateAudioFormat,
  type TtsGenerateProviderId,
  type TtsGenerateSettings,
```

Add constants near `IMAGE_GENERATE_ENGINES` and `VIDEO_GENERATE_ENGINES`:

```ts
const TTS_GENERATE_PROVIDERS: TtsGenerateProviderId[] = ["macos", "xiaomi"];
const TTS_GENERATE_FORMATS: TtsGenerateAudioFormat[] = ["wav", "aiff", "m4a", "caf"];
```

Add these helper functions after `sanitizeVideoGenerateSettings`:

```ts
function sanitizeTtsFormat(value: unknown, fallback: TtsGenerateAudioFormat): TtsGenerateAudioFormat {
  const format = String(value ?? fallback).trim().toLowerCase() as TtsGenerateAudioFormat;
  return TTS_GENERATE_FORMATS.includes(format) ? format : fallback;
}

function sanitizeTtsBaseUrl(value: unknown, fallback: string): string {
  const raw = String(value ?? fallback).trim();
  const cleaned = raw.replace(/\/+$/, "");
  return cleaned || fallback;
}

export function sanitizeTtsGenerateSettings(
  input: unknown,
  fallback: TtsGenerateSettings = defaultRuntimeSettings.ttsGenerate
): TtsGenerateSettings {
  const fallbackSettings = fallback ?? defaultRuntimeSettings.ttsGenerate;
  const source = input && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  const providersSource = source.providers && typeof source.providers === "object"
    ? source.providers as Record<string, unknown>
    : {};
  const requestedDefaultProvider = String(
    source.defaultProvider ?? fallbackSettings.defaultProvider
  ).trim() as TtsGenerateProviderId;

  const macosRaw = providersSource.macos && typeof providersSource.macos === "object"
    ? providersSource.macos as Record<string, unknown>
    : {};
  const xiaomiRaw = providersSource.xiaomi && typeof providersSource.xiaomi === "object"
    ? providersSource.xiaomi as Record<string, unknown>
    : {};

  return {
    enabled: source.enabled === undefined ? fallbackSettings.enabled : Boolean(source.enabled),
    defaultProvider: TTS_GENERATE_PROVIDERS.includes(requestedDefaultProvider)
      ? requestedDefaultProvider
      : fallbackSettings.defaultProvider,
    providers: {
      macos: {
        enabled: macosRaw.enabled === undefined ? fallbackSettings.providers.macos.enabled : Boolean(macosRaw.enabled),
        voice: String(macosRaw.voice ?? fallbackSettings.providers.macos.voice ?? "").trim(),
        format: sanitizeTtsFormat(macosRaw.format, fallbackSettings.providers.macos.format)
      },
      xiaomi: {
        enabled: xiaomiRaw.enabled === undefined ? fallbackSettings.providers.xiaomi.enabled : Boolean(xiaomiRaw.enabled),
        apiKey: String(xiaomiRaw.apiKey ?? fallbackSettings.providers.xiaomi.apiKey ?? "").trim(),
        baseUrl: sanitizeTtsBaseUrl(xiaomiRaw.baseUrl, fallbackSettings.providers.xiaomi.baseUrl),
        model: String(xiaomiRaw.model ?? fallbackSettings.providers.xiaomi.model ?? "mimo-v2-tts").trim() || "mimo-v2-tts",
        voice: String(xiaomiRaw.voice ?? fallbackSettings.providers.xiaomi.voice ?? "mimo_default").trim() || "mimo_default",
        format: sanitizeTtsFormat(xiaomiRaw.format, fallbackSettings.providers.xiaomi.format)
      }
    }
  };
}
```

In `sanitizeSettings`, add this assignment next to image/video settings:

```ts
    ttsGenerate: sanitizeTtsGenerateSettings(input.ttsGenerate, fallback.ttsGenerate),
```

- [ ] **Step 6: Run settings tests**

Run:

```bash
node --import ./scripts/register-loader.js --import tsx --test src/lib/server/settings/sanitize.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/lib/server/settings/schema.ts src/lib/server/settings/defaults.ts src/lib/server/settings/sanitize.ts src/lib/server/settings/sanitize.test.ts
git commit -m "feat: add tts generate settings schema

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Persist TTS settings in the dynamic settings store

**Files:**
- Modify: `src/lib/server/settings/store.ts`
- Test: `src/lib/server/settings/store.test.ts`

- [ ] **Step 1: Write failing store coverage**

Open `src/lib/server/settings/store.test.ts` and add a focused test that follows the file's existing temp-directory/store setup. If the file already has a helper for isolated storage, use that helper. Add this assertion body to the new test:

```ts
const initial = store.load();
const updated = store.update({
  ttsGenerate: {
    ...initial.ttsGenerate,
    enabled: true,
    defaultProvider: "xiaomi",
    providers: {
      ...initial.ttsGenerate.providers,
      xiaomi: {
        enabled: true,
        apiKey: "persisted-key",
        baseUrl: "https://api.xiaomimimo.com/v1",
        model: "mimo-v2-tts",
        voice: "default_en",
        format: "wav"
      }
    }
  }
});

assert.equal(updated.ttsGenerate.defaultProvider, "xiaomi");
assert.equal(updated.ttsGenerate.providers.xiaomi.apiKey, "persisted-key");

const reloaded = store.load();
assert.equal(reloaded.ttsGenerate.defaultProvider, "xiaomi");
assert.equal(reloaded.ttsGenerate.providers.xiaomi.apiKey, "persisted-key");
assert.equal(reloaded.ttsGenerate.providers.xiaomi.voice, "default_en");
```

Name the test:

```ts
test("settings store persists ttsGenerate dynamic settings", () => {
  // existing store.test setup wrapper goes here
});
```

Use the existing helper setup in the file so the test writes only to its temp data directory.

- [ ] **Step 2: Run the store test and verify it fails**

Run:

```bash
node --import ./scripts/register-loader.js --import tsx --test src/lib/server/settings/store.test.ts
```

Expected: FAIL because `ttsGenerate` is not yet included in dynamic keys or dynamic database save/load.

- [ ] **Step 3: Add `ttsGenerate` to dynamic keys and raw settings**

In `src/lib/server/settings/store.ts`, update imports from settings to include:

```ts
  type TtsGenerateSettings
```

Add `ttsGenerate` to `DynamicSettingKey`:

```ts
  | "ttsGenerate"
```

Add it to `DYNAMIC_SETTING_KEYS` after `videoGenerate`:

```ts
  "ttsGenerate",
```

Add this optional property to `RawSettings`:

```ts
  ttsGenerate?: unknown;
```

- [ ] **Step 4: Add dynamic save/load helpers**

Add these methods after `loadVideoGenerateSettings`:

```ts
  private saveTtsGenerateSettings(db: DatabaseSync, ttsGenerate: RuntimeSettings["ttsGenerate"]): void {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT OR REPLACE INTO settings_dynamic (key, value_json, updated_at)
      VALUES ('settings_tts_generate', ?, ?)
    `).run(JSON.stringify(ttsGenerate), now);
  }

  private loadTtsGenerateSettings(db: DatabaseSync): RuntimeSettings["ttsGenerate"] | undefined {
    const row = db.prepare("SELECT value_json FROM settings_dynamic WHERE key = ?").get("settings_tts_generate") as {
      value_json: string;
    } | undefined;
    if (!row) return undefined;
    return this.parseDynamicValue<RuntimeSettings["ttsGenerate"]>(row.value_json, undefined as any);
  }
```

- [ ] **Step 5: Wire dynamic loading and saving**

In `loadDynamicSettings`, add:

```ts
      const ttsGenerate = this.loadTtsGenerateSettings(db);
```

Return it with the other dynamic settings:

```ts
        ttsGenerate,
```

In `saveDynamicSettings`, add after `videoGenerate`:

```ts
      if (keys.includes("ttsGenerate")) {
        this.saveTtsGenerateSettings(db, settings.ttsGenerate);
      }
```

In `load()`, add static-to-dynamic migration after the video block:

```ts
      if (!rawDynamic.ttsGenerate && rawStatic.ttsGenerate) {
        this.saveTtsGenerateSettings(db, sanitizeTtsGenerateSettings(rawStatic.ttsGenerate));
        migrated = true;
      }
```

Update the import from `sanitize.ts` to include:

```ts
  sanitizeTtsGenerateSettings,
```

In the merged `RawSettings`, add:

```ts
      ttsGenerate: rawDynamicAfterMigration.ttsGenerate ?? rawStatic.ttsGenerate,
```

- [ ] **Step 6: Run store and sanitizer tests**

Run:

```bash
node --import ./scripts/register-loader.js --import tsx --test src/lib/server/settings/store.test.ts src/lib/server/settings/sanitize.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/lib/server/settings/store.ts src/lib/server/settings/store.test.ts
git commit -m "feat: persist tts generate settings

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Implement provider layer for Xiaomi and macOS

**Files:**
- Create: `src/lib/server/agent/ttsGenerate/types.ts`
- Create: `src/lib/server/agent/ttsGenerate/providers.ts`
- Test: `src/lib/server/agent/ttsGenerate/providers.test.ts`

- [ ] **Step 1: Write provider tests first**

Create `src/lib/server/agent/ttsGenerate/providers.test.ts` with this content:

```ts
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createMacosTtsProvider, createXiaomiTtsProvider, parseMacosSayVoices } from "./providers.js";
import type { TtsGenerateProviderContext } from "./types.js";

function context(overrides: Partial<TtsGenerateProviderContext> = {}): TtsGenerateProviderContext {
  return {
    settings: {
      enabled: true,
      defaultProvider: "xiaomi",
      providers: {
        macos: { enabled: true, voice: "Tingting", format: "aiff" },
        xiaomi: {
          enabled: true,
          apiKey: "secret-key",
          baseUrl: "https://api.xiaomimimo.com/v1",
          model: "mimo-v2-tts",
          voice: "mimo_default",
          format: "wav"
        }
      }
    },
    fetch: async () => new Response(JSON.stringify({
      choices: [{ message: { audio: { data: Buffer.from("audio-bytes").toString("base64") } } }]
    }), { status: 200 }),
    platform: "darwin",
    spawn: (() => { throw new Error("spawn not configured"); }) as any,
    ...overrides
  };
}

test("xiaomi provider posts assistant text and decodes audio data", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const provider = createXiaomiTtsProvider();

  const result = await provider.generate({
    text: "hello",
    provider: "xiaomi",
    voice: "default_zh",
    model: "mimo-v2-tts",
    style: "cheerful",
    format: "wav"
  }, context({
    fetch: async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({
        choices: [{ message: { audio: { data: Buffer.from("audio-bytes").toString("base64") } } }]
      }), { status: 200 });
    }
  }));

  assert.equal(capturedUrl, "https://api.xiaomimimo.com/v1/chat/completions");
  assert.equal((capturedInit?.headers as Record<string, string>)["api-key"], "secret-key");
  const body = JSON.parse(String(capturedInit?.body));
  assert.equal(body.model, "mimo-v2-tts");
  assert.equal(body.messages[0].role, "assistant");
  assert.equal(body.messages[0].content, "<style>cheerful</style>hello");
  assert.deepEqual(body.audio, { format: "wav", voice: "default_zh" });
  assert.equal(body.stream, false);
  assert.equal(result.audioBuffer.toString(), "audio-bytes");
  assert.equal(result.mimeType, "audio/wav");
  assert.equal(result.extension, "wav");
});

test("xiaomi provider rejects missing api key", async () => {
  const provider = createXiaomiTtsProvider();
  await assert.rejects(
    () => provider.generate({ text: "hello", provider: "xiaomi" }, context({
      settings: {
        ...context().settings,
        providers: {
          ...context().settings.providers,
          xiaomi: { ...context().settings.providers.xiaomi, apiKey: "" }
        }
      }
    })),
    /Xiaomi TTS API key is not configured/
  );
});

test("xiaomi provider rejects malformed audio response", async () => {
  const provider = createXiaomiTtsProvider();
  await assert.rejects(
    () => provider.generate({ text: "hello", provider: "xiaomi" }, context({
      fetch: async () => new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 })
    })),
    /Xiaomi TTS response did not include audio data/
  );
});

test("parseMacosSayVoices extracts voice ids and samples", () => {
  const voices = parseMacosSayVoices("Tingting             zh_CN    # 你好\nSamantha            en_US    # Hello\n");
  assert.deepEqual(voices, [
    { id: "Tingting", locale: "zh_CN", sample: "你好" },
    { id: "Samantha", locale: "en_US", sample: "Hello" }
  ]);
});

test("macos provider rejects non-darwin platforms", async () => {
  const provider = createMacosTtsProvider();
  await assert.rejects(
    () => provider.generate({ text: "hello", provider: "macos" }, context({ platform: "linux" })),
    /macOS system TTS is only available on macOS/
  );
});

test("macos provider uses safe spawn argument array", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const provider = createMacosTtsProvider();

  await provider.generate({
    text: "hello; rm -rf /",
    provider: "macos",
    voice: "Tingting",
    format: "aiff",
    outputPath: "/tmp/speech.aiff"
  }, context({
    spawn: ((command: string, args: string[]) => {
      calls.push({ command, args });
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => true;
      queueMicrotask(() => child.emit("close", 0));
      return child;
    }) as any
  }));

  assert.equal(calls[0].command, "say");
  assert.deepEqual(calls[0].args, ["-v", "Tingting", "-o", "/tmp/speech.aiff", "--", "hello; rm -rf /"]);
});
```

- [ ] **Step 2: Run provider tests and verify they fail**

Run:

```bash
node --import ./scripts/register-loader.js --import tsx --test src/lib/server/agent/ttsGenerate/providers.test.ts
```

Expected: FAIL because provider files do not exist.

- [ ] **Step 3: Create provider types**

Create `src/lib/server/agent/ttsGenerate/types.ts`:

```ts
import type { ChildProcess } from "node:child_process";
import type { TtsGenerateAudioFormat, TtsGenerateProviderId, TtsGenerateSettings } from "$lib/server/settings/index.js";

export type TtsGenerateProvider = TtsGenerateProviderId;
export type TtsGenerateFormat = TtsGenerateAudioFormat;

export interface TtsGenerateInput {
  text: string;
  provider?: TtsGenerateProvider;
  voice?: string;
  model?: string;
  style?: string;
  format?: TtsGenerateFormat;
  outputPath?: string;
}

export interface TtsGenerateProviderResult {
  audioBuffer?: Buffer;
  outputPath?: string;
  mimeType: string;
  extension: string;
  voice: string;
  model?: string;
  format: TtsGenerateFormat;
}

export interface TtsGenerateProviderContext {
  settings: TtsGenerateSettings;
  fetch: typeof fetch;
  platform: NodeJS.Platform;
  spawn: (command: string, args: string[], options?: Record<string, unknown>) => ChildProcess;
  signal?: AbortSignal;
}

export interface TtsGenerateProviderAdapter {
  id: TtsGenerateProvider;
  generate(input: TtsGenerateInput, context: TtsGenerateProviderContext): Promise<TtsGenerateProviderResult>;
}

export interface TtsVoiceOption {
  id: string;
  locale?: string;
  sample?: string;
}

export const XIAOMI_TTS_VOICES: TtsVoiceOption[] = [
  { id: "mimo_default", sample: "MiMo default voice" },
  { id: "default_zh", locale: "zh_CN", sample: "Chinese female voice" },
  { id: "default_en", locale: "en_US", sample: "English female voice" }
];

export const XIAOMI_TTS_MODELS = ["mimo-v2-tts"] as const;

export function mimeTypeForAudioFormat(format: TtsGenerateFormat): string {
  switch (format) {
    case "wav":
      return "audio/wav";
    case "m4a":
      return "audio/mp4";
    case "caf":
      return "audio/x-caf";
    case "aiff":
    default:
      return "audio/aiff";
  }
}
```

- [ ] **Step 4: Create provider implementations**

Create `src/lib/server/agent/ttsGenerate/providers.ts`:

```ts
import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { TtsGenerateFormat } from "./types.js";
import { mimeTypeForAudioFormat, type TtsGenerateInput, type TtsGenerateProviderAdapter, type TtsGenerateProviderContext, type TtsGenerateProviderResult, type TtsVoiceOption } from "./types.js";

function trimSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function parseJsonSafely(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Xiaomi TTS returned non-JSON response.");
  }
}

function normalizeStyleText(text: string, style?: string): string {
  const styleText = String(style ?? "").trim();
  if (!styleText) return text;
  return `<style>${styleText}</style>${text}`;
}

export function parseMacosSayVoices(stdout: string): TtsVoiceOption[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\S+)\s+([\w-]+)\s+#\s*(.*)$/);
      if (!match) return undefined;
      return {
        id: match[1],
        locale: match[2],
        sample: match[3]
      } satisfies TtsVoiceOption;
    })
    .filter((voice): voice is TtsVoiceOption => Boolean(voice));
}

export async function listMacosSayVoices(options: {
  platform?: NodeJS.Platform;
  spawn?: typeof nodeSpawn;
  signal?: AbortSignal;
} = {}): Promise<TtsVoiceOption[]> {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") return [];
  const spawn = options.spawn ?? nodeSpawn;
  return await new Promise<TtsVoiceOption[]>((resolve, reject) => {
    const child = spawn("say", ["-v", "?"]);
    let stdout = "";
    let stderr = "";
    const onAbort = () => {
      child.kill();
      reject(new Error("macOS voice discovery aborted."));
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      options.signal?.removeEventListener("abort", onAbort);
      if (code !== 0) {
        reject(new Error(`macOS voice discovery failed: ${stderr.trim() || `exit ${code}`}`));
        return;
      }
      resolve(parseMacosSayVoices(stdout));
    });
  });
}

export function createXiaomiTtsProvider(): TtsGenerateProviderAdapter {
  return {
    id: "xiaomi",
    async generate(input: TtsGenerateInput, context: TtsGenerateProviderContext): Promise<TtsGenerateProviderResult> {
      const config = context.settings.providers.xiaomi;
      if (!config.enabled) {
        throw new Error("Xiaomi TTS provider is disabled in settings.");
      }
      if (!config.apiKey.trim()) {
        throw new Error("Xiaomi TTS API key is not configured.");
      }
      const text = input.text.trim();
      if (!text) {
        throw new Error("Text is required for TTS generation.");
      }
      const model = String(input.model ?? config.model ?? "mimo-v2-tts").trim() || "mimo-v2-tts";
      const voice = String(input.voice ?? config.voice ?? "mimo_default").trim() || "mimo_default";
      const format = (input.format ?? config.format ?? "wav") as TtsGenerateFormat;
      const url = `${trimSlash(config.baseUrl || "https://api.xiaomimimo.com/v1")}/chat/completions`;
      const body = {
        model,
        messages: [{ role: "assistant", content: normalizeStyleText(text, input.style) }],
        audio: { format, voice },
        stream: false
      };

      const response = await context.fetch(url, {
        method: "POST",
        headers: {
          "api-key": config.apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: context.signal
      });
      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`Xiaomi TTS request failed: ${response.status} ${response.statusText} ${responseText.slice(0, 300)}`.trim());
      }
      const json = parseJsonSafely(responseText);
      const audioData = json?.choices?.[0]?.message?.audio?.data;
      if (!audioData || typeof audioData !== "string") {
        throw new Error("Xiaomi TTS response did not include audio data.");
      }

      return {
        audioBuffer: Buffer.from(audioData, "base64"),
        mimeType: mimeTypeForAudioFormat(format),
        extension: format,
        voice,
        model,
        format
      };
    }
  };
}

export function createMacosTtsProvider(): TtsGenerateProviderAdapter {
  return {
    id: "macos",
    async generate(input: TtsGenerateInput, context: TtsGenerateProviderContext): Promise<TtsGenerateProviderResult> {
      if (context.platform !== "darwin") {
        throw new Error("macOS system TTS is only available on macOS.");
      }
      const config = context.settings.providers.macos;
      if (!config.enabled) {
        throw new Error("macOS TTS provider is disabled in settings.");
      }
      const text = input.text.trim();
      if (!text) {
        throw new Error("Text is required for TTS generation.");
      }
      if (!input.outputPath) {
        throw new Error("outputPath is required for macOS TTS generation.");
      }
      const voice = String(input.voice ?? config.voice ?? "").trim();
      const format = (input.format ?? config.format ?? "aiff") as TtsGenerateFormat;
      const args = voice
        ? ["-v", voice, "-o", input.outputPath, "--", text]
        : ["-o", input.outputPath, "--", text];

      await new Promise<void>((resolve, reject) => {
        const child: ChildProcess = context.spawn("say", args, { stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        const onAbort = () => {
          child.kill();
          reject(new Error("macOS TTS generation aborted."));
        };
        context.signal?.addEventListener("abort", onAbort, { once: true });
        child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
        child.on("error", reject);
        child.on("close", (code) => {
          context.signal?.removeEventListener("abort", onAbort);
          if (code !== 0) {
            reject(new Error(`macOS say failed: ${stderr.trim() || `exit ${code}`}`));
            return;
          }
          resolve();
        });
      });

      return {
        outputPath: input.outputPath,
        mimeType: mimeTypeForAudioFormat(format),
        extension: format,
        voice: voice || "system-default",
        format
      };
    }
  };
}

export const TTS_GENERATE_PROVIDERS = {
  macos: createMacosTtsProvider(),
  xiaomi: createXiaomiTtsProvider()
} as const;
```

- [ ] **Step 5: Run provider tests**

Run:

```bash
node --import ./scripts/register-loader.js --import tsx --test src/lib/server/agent/ttsGenerate/providers.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/lib/server/agent/ttsGenerate/types.ts src/lib/server/agent/ttsGenerate/providers.ts src/lib/server/agent/ttsGenerate/providers.test.ts
git commit -m "feat: add tts provider adapters

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Implement the `ttsGenerate` Agent tool

**Files:**
- Create: `src/lib/server/agent/ttsGenerate/ttsGenerateTool.ts`
- Test: `src/lib/server/agent/ttsGenerate/ttsGenerateTool.test.ts`

- [ ] **Step 1: Write tool tests first**

Create `src/lib/server/agent/ttsGenerate/ttsGenerateTool.test.ts` with this content:

```ts
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createTtsGenerateTool } from "./ttsGenerateTool.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";

function settings(overrides: Partial<RuntimeSettings["ttsGenerate"]> = {}): RuntimeSettings {
  const ttsGenerate = {
    ...defaultRuntimeSettings.ttsGenerate,
    defaultProvider: "xiaomi" as const,
    providers: {
      macos: { ...defaultRuntimeSettings.ttsGenerate.providers.macos, enabled: true, voice: "Tingting", format: "aiff" as const },
      xiaomi: {
        ...defaultRuntimeSettings.ttsGenerate.providers.xiaomi,
        enabled: true,
        apiKey: "secret-key",
        baseUrl: "https://api.xiaomimimo.com/v1",
        model: "mimo-v2-tts",
        voice: "mimo_default",
        format: "wav" as const
      }
    },
    ...overrides
  };
  return { ...defaultRuntimeSettings, ttsGenerate };
}

test("ttsGenerate writes Xiaomi audio and uploads by default", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-tts-tool-"));
  const uploaded: string[] = [];
  try {
    const tool = createTtsGenerateTool({
      getSettings: () => settings(),
      cwd: root,
      workspaceDir: root,
      artifactDir: "artifacts",
      uploadFile: async (filePath) => { uploaded.push(filePath); },
      fetch: async () => new Response(JSON.stringify({
        choices: [{ message: { audio: { data: Buffer.from("speech").toString("base64") } } }]
      }), { status: 200 }),
      platform: "darwin",
      spawn: (() => { throw new Error("spawn not expected"); }) as any,
      now: () => 1_717_280_000_000
    });

    const result = await tool.execute("call-1", {
      text: "hello",
      provider: "xiaomi",
      fileName: "hello.wav"
    });

    assert.equal(uploaded.length, 1);
    assert.equal(readFileSync(uploaded[0], "utf8"), "speech");
    assert.equal((result as any).details.provider, "xiaomi");
    assert.equal((result as any).details.uploaded, true);
    assert.match((result as any).details.path, /artifacts\/hello\.wav$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ttsGenerate returns partial success when upload fails", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-tts-tool-"));
  try {
    const tool = createTtsGenerateTool({
      getSettings: () => settings(),
      cwd: root,
      workspaceDir: root,
      artifactDir: "artifacts",
      uploadFile: async () => { throw new Error("upload unavailable"); },
      fetch: async () => new Response(JSON.stringify({
        choices: [{ message: { audio: { data: Buffer.from("speech").toString("base64") } } }]
      }), { status: 200 }),
      platform: "darwin",
      spawn: (() => { throw new Error("spawn not expected"); }) as any,
      now: () => 1_717_280_000_000
    });

    const result = await tool.execute("call-1", { text: "hello", provider: "xiaomi" });

    assert.equal((result as any).details.uploaded, false);
    assert.equal((result as any).details.uploadError, "upload unavailable");
    assert.match((result as any).content[0].text, /Generated successfully, but automatic chat upload failed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ttsGenerate rejects disabled global settings", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-tts-tool-"));
  try {
    const tool = createTtsGenerateTool({
      getSettings: () => settings({ enabled: false }),
      cwd: root,
      workspaceDir: root,
      artifactDir: "artifacts"
    });

    await assert.rejects(
      () => tool.execute("call-1", { text: "hello" }),
      /TTS generation tool is disabled in settings/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ttsGenerate rejects unsafe file names", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-tts-tool-"));
  try {
    const tool = createTtsGenerateTool({
      getSettings: () => settings(),
      cwd: root,
      workspaceDir: root,
      artifactDir: "artifacts"
    });

    await assert.rejects(
      () => tool.execute("call-1", { text: "hello", fileName: "../escape.wav" }),
      /fileName must be a safe file name/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tool tests and verify they fail**

Run:

```bash
node --import ./scripts/register-loader.js --import tsx --test src/lib/server/agent/ttsGenerate/ttsGenerateTool.test.ts
```

Expected: FAIL because `ttsGenerateTool.ts` does not exist.

- [ ] **Step 3: Create the tool implementation**

Create `src/lib/server/agent/ttsGenerate/ttsGenerateTool.ts`:

```ts
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { promises as fs } from "node:fs";
import { spawn as nodeSpawn } from "node:child_process";
import { basename, dirname, extname } from "node:path";
import { createPathGuard, resolveToolPath } from "$lib/server/agent/tools/path.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import { TTS_GENERATE_PROVIDERS } from "./providers.js";
import type { TtsGenerateFormat, TtsGenerateProvider } from "./types.js";

const ttsGenerateSchema = Type.Object({
  text: Type.String({ description: "Text to synthesize into speech audio." }),
  provider: Type.Optional(Type.Union([Type.Literal("macos"), Type.Literal("xiaomi")], {
    description: "TTS provider. Defaults to the provider selected in /settings/tts."
  })),
  voice: Type.Optional(Type.String({ description: "Provider-specific voice ID. Xiaomi examples: mimo_default, default_zh, default_en. macOS examples depend on installed system voices." })),
  model: Type.Optional(Type.String({ description: "Provider-specific model ID. Xiaomi defaults to mimo-v2-tts. macOS has no model concept." })),
  style: Type.Optional(Type.String({ description: "Optional Xiaomi style instruction, inserted as a <style>...</style> prefix. macOS does not support style." })),
  format: Type.Optional(Type.String({ description: "Audio format. Xiaomi defaults to wav; macOS defaults to aiff." })),
  fileName: Type.Optional(Type.String({ description: "Safe output file name such as narration.wav. Must not contain directories or path traversal." })),
  autoUpload: Type.Optional(Type.Boolean({ description: "Whether to automatically send the generated audio to the active chat. Defaults to true." }))
});

function buildTtsGenerateDescription(): string {
  return [
    "- Converts text into speech audio using configured TTS providers.",
    "- Supports macOS system voices on macOS and Xiaomi MiMo TTS.",
    "- Saves the generated audio to the scratch artifact directory and automatically uploads it to the current chat when possible.",
    "",
    "Usage guidelines:",
    "- Use when the user asks to convert text to speech, generate narration, create voiceover audio, or make spoken audio.",
    "- If the user names a voice or provider, pass it explicitly. Otherwise use settings defaults.",
    "- Do not call attach manually after this tool succeeds; automatic upload is enabled by default."
  ].join("\n");
}

function isSafeFileName(fileName: string): boolean {
  const normalized = fileName.trim().replaceAll("\\", "/");
  return Boolean(normalized) &&
    normalized === basename(normalized) &&
    !normalized.startsWith(".") &&
    normalized !== "..";
}

function routeArtifactPath(inputPath: string, artifactDir?: string): { path: string; routed: boolean } {
  const requested = inputPath.trim();
  const normalizedArtifactDir = artifactDir?.trim();
  if (!normalizedArtifactDir || /^\/|^[A-Za-z]:/.test(requested)) {
    return { path: requested, routed: false };
  }
  return { path: `${normalizedArtifactDir}/${requested}`, routed: true };
}

function resolveProvider(settings: RuntimeSettings["ttsGenerate"], requested?: string): TtsGenerateProvider {
  const provider = String(requested ?? settings.defaultProvider).trim() as TtsGenerateProvider;
  if (provider !== "macos" && provider !== "xiaomi") {
    throw new Error(`Unknown TTS provider '${provider}'.`);
  }
  if (!settings.providers[provider].enabled) {
    throw new Error(`TTS provider '${provider}' is disabled in settings.`);
  }
  return provider;
}

function defaultFormatForProvider(settings: RuntimeSettings["ttsGenerate"], provider: TtsGenerateProvider): TtsGenerateFormat {
  return settings.providers[provider].format as TtsGenerateFormat;
}

function defaultOutputName(provider: TtsGenerateProvider, format: TtsGenerateFormat, now: () => number): string {
  return `tts-${now()}-${provider}.${format}`;
}

export function createTtsGenerateTool(options: {
  getSettings: () => RuntimeSettings;
  cwd: string;
  workspaceDir: string;
  artifactDir?: string;
  uploadFile?: (filePath: string, title?: string, text?: string) => Promise<void>;
  fetch?: typeof fetch;
  platform?: NodeJS.Platform;
  spawn?: typeof nodeSpawn;
  now?: () => number;
}): AgentTool<typeof ttsGenerateSchema> {
  const ensureAllowedPath = createPathGuard(options.cwd, options.workspaceDir);

  return {
    name: "ttsGenerate",
    label: "ttsGenerate",
    description: buildTtsGenerateDescription(),
    parameters: ttsGenerateSchema,
    executionMode: "sequential",
    execute: async (_toolCallId, params, signal): Promise<any> => {
      const currentSettings = options.getSettings();
      if (!currentSettings.ttsGenerate.enabled) {
        throw new Error("TTS generation tool is disabled in settings.");
      }

      const text = String(params.text || "").trim();
      if (!text) {
        throw new Error("Text is required.");
      }

      const provider = resolveProvider(currentSettings.ttsGenerate, params.provider);
      const providerConfig = currentSettings.ttsGenerate.providers[provider];
      const format = String(params.format ?? defaultFormatForProvider(currentSettings.ttsGenerate, provider)).trim() as TtsGenerateFormat;
      const rawFileName = String(params.fileName ?? "").trim() || defaultOutputName(provider, format, options.now ?? Date.now);
      if (!isSafeFileName(rawFileName)) {
        throw new Error("fileName must be a safe file name without directories or path traversal.");
      }
      const fileName = extname(rawFileName) ? rawFileName : `${rawFileName}.${format}`;
      const target = routeArtifactPath(fileName, options.artifactDir);
      const filePath = resolveToolPath(options.cwd, target.path);
      ensureAllowedPath(filePath);

      const adapter = TTS_GENERATE_PROVIDERS[provider];
      const result = await adapter.generate({
        text,
        provider,
        voice: params.voice || providerConfig.voice,
        model: provider === "xiaomi" ? (params.model || currentSettings.ttsGenerate.providers.xiaomi.model) : undefined,
        style: params.style,
        format,
        outputPath: filePath
      }, {
        settings: currentSettings.ttsGenerate,
        fetch: options.fetch ?? globalThis.fetch,
        platform: options.platform ?? process.platform,
        spawn: options.spawn ?? nodeSpawn,
        signal
      });

      if (result.audioBuffer) {
        await fs.mkdir(dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, result.audioBuffer);
      } else if (result.outputPath !== filePath) {
        throw new Error("TTS provider did not return audio data or the expected output path.");
      }

      let uploadError: string | undefined;
      const shouldUpload = params.autoUpload !== false;
      if (shouldUpload && options.uploadFile) {
        try {
          await options.uploadFile(filePath, basename(filePath), `Generated speech audio: ${text.slice(0, 120)}`);
        } catch (error) {
          uploadError = error instanceof Error ? error.message : String(error);
        }
      }
      const uploaded = shouldUpload && Boolean(options.uploadFile) && !uploadError;
      const uploadMessage = uploaded
        ? " (Automatically uploaded and sent to chat channel)"
        : uploadError
          ? " (Generated successfully, but automatic chat upload failed)"
          : "";

      return {
        content: [{
          type: "text",
          text: [
            `Successfully generated speech audio using '${provider}' provider.${uploadMessage}`,
            `Voice: ${result.voice}`,
            result.model ? `Model: ${result.model}` : undefined,
            `Saved file to: ${target.path}`,
            uploadError ? `Upload error: ${uploadError}` : undefined
          ].filter(Boolean).join("\n")
        }],
        details: {
          provider,
          voice: result.voice,
          model: result.model,
          format: result.format,
          mimeType: result.mimeType,
          path: target.path,
          filePath,
          uploaded,
          uploadError
        }
      };
    }
  };
}
```

- [ ] **Step 4: Run tool and provider tests**

Run:

```bash
node --import ./scripts/register-loader.js --import tsx --test src/lib/server/agent/ttsGenerate/providers.test.ts src/lib/server/agent/ttsGenerate/ttsGenerateTool.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/lib/server/agent/ttsGenerate/ttsGenerateTool.ts src/lib/server/agent/ttsGenerate/ttsGenerateTool.test.ts
git commit -m "feat: add tts generate agent tool

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Register `ttsGenerate` as a deferred tool and update prompt routing

**Files:**
- Modify: `src/lib/server/agent/tools/index.ts`
- Modify: `src/lib/server/agent/tools/index.test.ts`
- Modify: `src/lib/server/agent/tools/toolSearch.test.ts`
- Modify: `src/lib/server/agent/prompts/prompt.ts`
- Modify: `src/lib/server/agent/prompts/prompt.test.ts`

- [ ] **Step 1: Write failing deferred and prompt tests**

In `src/lib/server/agent/tools/index.test.ts`, add:

```ts
test("tools index registers ttsGenerate as a deferred tool with concise English discovery keywords", () => {
  assert.match(indexSource, /createTtsGenerateTool/);
  assert.match(indexSource, /name: "ttsGenerate"/);
  assert.match(indexSource, /tool: ttsGenerateRuntimeTool/);
  assert.match(indexSource, /"tts"/);
  assert.match(indexSource, /"speech"/);
  assert.match(indexSource, /"voiceover"/);
  assert.doesNotMatch(indexSource, /"文字转语音"/);
});
```

In `src/lib/server/agent/tools/toolSearch.test.ts`, add a new deferred entry factory and test:

```ts
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
      execute: async () => ({ content: [{ type: "text", text: "ok" }] })
    }
  };
}

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
  assert.match(text, /Loaded deferred tools: ttsGenerate/);
  assert.match(text, /"name":"ttsGenerate"/);
});
```

In `src/lib/server/agent/prompts/prompt.test.ts`, add:

```ts
test("prompt source prioritizes ttsGenerate before skillSearch and bash audio scripts", () => {
  assert.match(promptSource, /"ttsGenerate"/);
  assert.match(promptSource, /function buildAvailableDeferredToolsSection\(\): string \{[\s\S]*"ttsGenerate"[\s\S]*\}/);
  assert.match(promptSource, /Text-to-speech requests in any language/);
  assert.match(promptSource, /infer the intent semantically, call `toolSearch` with `select:ttsGenerate`, then call `ttsGenerate`/);
  assert.match(promptSource, /Do not use `skillSearch`, bash, Python audio scripts, macOS `say`, or create a skill unless `ttsGenerate` is unavailable or fails/);
  assert.match(promptSource, /For text-to-speech, narration, voiceover, or spoken-audio generation, prefer `ttsGenerate`/);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
node --import ./scripts/register-loader.js --import tsx --test src/lib/server/agent/tools/index.test.ts src/lib/server/agent/tools/toolSearch.test.ts src/lib/server/agent/prompts/prompt.test.ts
```

Expected: FAIL because the tool is not registered and prompt routing is missing.

- [ ] **Step 3: Register runtime tool**

In `src/lib/server/agent/tools/index.ts`, add import near image/video imports:

```ts
import { createTtsGenerateTool } from "$lib/server/agent/ttsGenerate/ttsGenerateTool.js";
```

After `videoGenerateRuntimeTool`, add:

```ts
  const ttsGenerateRuntimeTool = wrapSerializedTool(createTtsGenerateTool({
    getSettings: options.getSettings,
    cwd: options.cwd,
    workspaceDir: options.workspaceDir,
    artifactDir,
    uploadFile: options.uploadFile
  }));
```

Add a deferred entry after `videoGenerate`:

```ts
    createDeferredToolEntry({
      name: "ttsGenerate",
      description: "Convert text into speech audio with configured TTS providers, save locally, and automatically send to chat.",
      keywords: [
        "tts",
        "speech",
        "voice",
        "voiceover",
        "narration",
        "audio",
        "speak"
      ],
      tool: ttsGenerateRuntimeTool,
      loadDeferredTools
    })
```

- [ ] **Step 4: Update prompt routing and tool summary**

In `src/lib/server/agent/prompts/prompt.ts`, add a new Step 0 line after video generation:

```ts
    "  c) Text-to-speech requests in any language (for example: convert text to speech, generate narration, create voiceover audio, 合成语音, 文字转语音, 朗读成音频) → infer the intent semantically, call `toolSearch` with `select:ttsGenerate`, then call `ttsGenerate`. Do not search by translated keywords first. Do not use `skillSearch`, bash, Python audio scripts, macOS `say`, or create a skill unless `ttsGenerate` is unavailable or fails.",
```

Renumber the current web-search line from `c)` to `d)`.

Add `ttsGenerate` to `buildAvailableDeferredToolsSection()` after `videoGenerate`:

```ts
    "ttsGenerate"
```

Add this tool-selection preference after the video preference:

```ts
    "- For text-to-speech, narration, voiceover, or spoken-audio generation, prefer `ttsGenerate` over writing custom code, invoking macOS `say` directly, or searching for skills.",
```

Add this tool parameter summary after `videoGenerate(...)`:

```ts
    "- `ttsGenerate(text, provider?, voice?, model?, style?, format?, fileName?, autoUpload?)` — convert text into speech audio, save locally, and automatically send to chat",
```

- [ ] **Step 5: Run deferred and prompt tests**

Run:

```bash
node --import ./scripts/register-loader.js --import tsx --test src/lib/server/agent/tools/index.test.ts src/lib/server/agent/tools/toolSearch.test.ts src/lib/server/agent/prompts/prompt.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/lib/server/agent/tools/index.ts src/lib/server/agent/tools/index.test.ts src/lib/server/agent/tools/toolSearch.test.ts src/lib/server/agent/prompts/prompt.ts src/lib/server/agent/prompts/prompt.test.ts
git commit -m "feat: register tts generate deferred tool

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Add TTS settings APIs

**Files:**
- Modify: `src/routes/api/settings/dynamic/[key]/+server.ts`
- Create: `src/routes/api/settings/tts-generate/test/+server.ts`
- Create: `src/routes/api/settings/tts-generate/voices/+server.ts`

- [ ] **Step 1: Add dynamic key aliases**

In `src/routes/api/settings/dynamic/[key]/+server.ts`, add aliases after video entries:

```ts
  "tts-generate": "ttsGenerate",
  "ttsGenerate": "ttsGenerate",
  "settings_tts_generate": "ttsGenerate",
```

- [ ] **Step 2: Create test endpoint**

Create `src/routes/api/settings/tts-generate/test/+server.ts`:

```ts
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { createTtsGenerateTool } from "$lib/server/agent/ttsGenerate/ttsGenerateTool.js";
import { getRuntime } from "$lib/server/app/runtime";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { sanitizeTtsGenerateSettings } from "$lib/server/settings/sanitize.js";

export const POST: RequestHandler = async ({ request }) => {
  let body: { text?: string; provider?: string; voice?: string; model?: string; style?: string; format?: string; ttsGenerate?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const runtime = getRuntime();
  const baseSettings = runtime.getSettings().ttsGenerate;
  const ttsGenerate = sanitizeTtsGenerateSettings(body.ttsGenerate ?? baseSettings, baseSettings);
  const testRoot = `${storagePaths.dataDir}/settings-tts-tests`;

  try {
    const tool = createTtsGenerateTool({
      getSettings: () => ({
        ...runtime.getSettings(),
        ttsGenerate
      }),
      cwd: testRoot,
      workspaceDir: testRoot,
      artifactDir: "test-audio"
    });
    const result = await tool.execute("settings-tts-test-call", {
      text: body.text || "你好，这是 Molibot 的语音合成测试。",
      provider: body.provider,
      voice: body.voice,
      model: body.model,
      style: body.style,
      format: body.format,
      fileName: `test_tts_${Date.now()}.${body.format || "wav"}`,
      autoUpload: false
    });
    return json({ ok: true, result });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};
```

- [ ] **Step 3: Create voice discovery endpoint**

Create `src/routes/api/settings/tts-generate/voices/+server.ts`:

```ts
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { listMacosSayVoices } from "$lib/server/agent/ttsGenerate/providers.js";
import { XIAOMI_TTS_VOICES } from "$lib/server/agent/ttsGenerate/types.js";

export const GET: RequestHandler = async ({ url }) => {
  const provider = url.searchParams.get("provider") || "macos";

  if (provider === "xiaomi") {
    return json({ ok: true, provider, available: true, voices: XIAOMI_TTS_VOICES });
  }

  if (provider !== "macos") {
    return json({ ok: false, error: `Invalid provider: ${provider}` }, { status: 400 });
  }

  if (process.platform !== "darwin") {
    return json({ ok: true, provider, available: false, voices: [] });
  }

  try {
    const voices = await listMacosSayVoices();
    return json({ ok: true, provider, available: true, voices });
  } catch (error) {
    return json({
      ok: true,
      provider,
      available: true,
      voices: [],
      error: error instanceof Error ? error.message : String(error)
    });
  }
};
```

- [ ] **Step 4: Run API-adjacent tests**

Run:

```bash
node --import ./scripts/register-loader.js --import tsx --test src/lib/server/agent/ttsGenerate/providers.test.ts src/lib/server/agent/ttsGenerate/ttsGenerateTool.test.ts src/lib/server/settings/sanitize.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

```bash
git add src/routes/api/settings/dynamic/[key]/+server.ts src/routes/api/settings/tts-generate/test/+server.ts src/routes/api/settings/tts-generate/voices/+server.ts
git commit -m "feat: add tts settings APIs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Add `/settings/tts` page and navigation

**Files:**
- Create: `src/routes/settings/tts/+page.svelte`
- Modify: `src/routes/settings/+layout.svelte`

- [ ] **Step 1: Add navigation labels and route**

In `src/routes/settings/+layout.svelte`, add copy keys:

```ts
      ttsTools: "语音工具",
```

and:

```ts
      ttsTools: "Speech Tools",
```

Update `findActiveGroup` so `/settings/tts` belongs to the AI group:

```ts
    if (p.startsWith("/settings/ai") || p === "/settings/mcp" || p === "/settings/search" || p === "/settings/image" || p === "/settings/video" || p === "/settings/tts") return "ai";
```

Add the nav entry after video:

```ts
        { href: "/settings/tts", label: t("ttsTools"), exact: true },
```

- [ ] **Step 2: Create the settings page**

Create `src/routes/settings/tts/+page.svelte` with this content:

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { Switch } from "$lib/components/ui/switch";
  import { locale } from "$lib/ui/i18n";

  type ProviderId = "macos" | "xiaomi";
  type AudioFormat = "wav" | "aiff" | "m4a" | "caf";

  interface TtsGenerateSettings {
    enabled: boolean;
    defaultProvider: ProviderId;
    providers: {
      macos: { enabled: boolean; voice: string; format: AudioFormat };
      xiaomi: { enabled: boolean; apiKey: string; baseUrl: string; model: string; voice: string; format: AudioFormat };
    };
  }

  interface VoiceOption {
    id: string;
    locale?: string;
    sample?: string;
  }

  const COPY = {
    "zh-CN": {
      title: "语音合成",
      desc: "配置内置 Agent 文本转语音工具。支持 macOS 系统语音和小米 MiMo TTS。",
      enableTool: "启用内置 ttsGenerate 工具",
      enableToolDesc: "禁用后，语音合成请求会返回配置错误，不会调用本地语音或外部 API。",
      defaultProvider: "默认 Provider",
      macosProvider: "macOS 系统语音",
      xiaomiProvider: "小米 MiMo TTS",
      macosTitle: "macOS 系统语音",
      macosDesc: "使用当前 macOS 系统自带的 say 命令生成音频。非 macOS 系统不可用。",
      xiaomiTitle: "小米 MiMo TTS",
      xiaomiDesc: "通过小米 MiMo speech synthesis API 生成 wav 音频。",
      enabled: "启用",
      unavailable: "当前系统不可用",
      available: "可用",
      voice: "音色",
      model: "模型",
      format: "格式",
      apiKey: "API Key",
      baseUrl: "Base URL",
      noModel: "系统语音无模型选择",
      testTitle: "测试语音合成",
      testText: "测试文本",
      testTextPlaceholder: "输入要合成为语音的文本",
      testProvider: "测试 Provider",
      testButton: "测试生成",
      testingButton: "生成中...",
      testResultTitle: "测试结果",
      saveButton: "保存设置",
      savingButton: "保存中...",
      savedMsg: "语音合成设置已保存。",
      loadError: "加载设置失败",
      saveError: "保存设置失败",
      testError: "语音合成测试失败"
    },
    "en-US": {
      title: "Speech Synthesis",
      desc: "Configure the built-in Agent text-to-speech tool. Supports macOS system voices and Xiaomi MiMo TTS.",
      enableTool: "Enable built-in ttsGenerate tool",
      enableToolDesc: "When disabled, speech generation requests return a settings error instead of calling local speech or external APIs.",
      defaultProvider: "Default Provider",
      macosProvider: "macOS System Voice",
      xiaomiProvider: "Xiaomi MiMo TTS",
      macosTitle: "macOS System Voice",
      macosDesc: "Use the current macOS system say command to generate audio. Unavailable on non-macOS systems.",
      xiaomiTitle: "Xiaomi MiMo TTS",
      xiaomiDesc: "Generate wav audio through the Xiaomi MiMo speech synthesis API.",
      enabled: "Enabled",
      unavailable: "Unavailable on this system",
      available: "Available",
      voice: "Voice",
      model: "Model",
      format: "Format",
      apiKey: "API Key",
      baseUrl: "Base URL",
      noModel: "System voices do not have model selection",
      testTitle: "Test Speech Synthesis",
      testText: "Test text",
      testTextPlaceholder: "Enter text to synthesize",
      testProvider: "Test Provider",
      testButton: "Test Generate",
      testingButton: "Generating...",
      testResultTitle: "Test Result",
      saveButton: "Save settings",
      savingButton: "Saving...",
      savedMsg: "Speech synthesis settings saved.",
      loadError: "Failed to load settings",
      saveError: "Failed to save settings",
      testError: "Speech synthesis test failed"
    }
  };

  function t(key: keyof typeof COPY["en-US"]): string {
    return COPY[$locale]?.[key] ?? COPY["en-US"][key];
  }

  const xiaomiVoices: VoiceOption[] = [
    { id: "mimo_default", sample: "MiMo default voice" },
    { id: "default_zh", locale: "zh_CN", sample: "Chinese female voice" },
    { id: "default_en", locale: "en_US", sample: "English female voice" }
  ];

  let loading = true;
  let saving = false;
  let testing = false;
  let message = "";
  let error = "";
  let testResult: any = null;
  let showApiKey = false;
  let macosAvailable = false;
  let macosVoices: VoiceOption[] = [];
  let testText = "你好，这是 Molibot 的语音合成测试。";
  let testProvider: ProviderId = "xiaomi";

  let ttsGenerate: TtsGenerateSettings = {
    enabled: true,
    defaultProvider: "macos",
    providers: {
      macos: { enabled: true, voice: "", format: "aiff" },
      xiaomi: {
        enabled: false,
        apiKey: "",
        baseUrl: "https://api.xiaomimimo.com/v1",
        model: "mimo-v2-tts",
        voice: "mimo_default",
        format: "wav"
      }
    }
  };

  async function loadSettings(): Promise<void> {
    loading = true;
    message = "";
    error = "";
    try {
      const res = await fetch("/api/settings/dynamic/tts-generate");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || t("loadError"));
      ttsGenerate = { ...ttsGenerate, ...(data.value ?? {}) };
      testProvider = ttsGenerate.defaultProvider;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function loadVoices(): Promise<void> {
    try {
      const res = await fetch("/api/settings/tts-generate/voices?provider=macos");
      const data = await res.json();
      macosAvailable = Boolean(data.available);
      macosVoices = data.voices || [];
    } catch {
      macosAvailable = false;
      macosVoices = [];
    }
  }

  async function saveSettings(): Promise<void> {
    saving = true;
    message = "";
    error = "";
    try {
      const res = await fetch("/api/settings/dynamic/tts-generate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: ttsGenerate })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || t("saveError"));
      ttsGenerate = data.value;
      message = t("savedMsg");
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  async function testSynthesis(): Promise<void> {
    testing = true;
    message = "";
    error = "";
    testResult = null;
    try {
      const providerConfig = ttsGenerate.providers[testProvider];
      const res = await fetch("/api/settings/tts-generate/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: testText,
          provider: testProvider,
          voice: providerConfig.voice,
          model: testProvider === "xiaomi" ? ttsGenerate.providers.xiaomi.model : undefined,
          format: providerConfig.format,
          ttsGenerate
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || t("testError"));
      testResult = data.result;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      testing = false;
    }
  }

  onMount(async () => {
    await Promise.all([loadSettings(), loadVoices()]);
  });
</script>

<svelte:head>
  <title>{t("title")} · Molibot</title>
</svelte:head>

<div class="tts-settings-page">
  <section class="tts-settings-header">
    <div>
      <p class="tts-settings-eyebrow">Agent Tool</p>
      <h1 class="tts-settings-title">{t("title")}</h1>
      <p class="tts-settings-desc">{t("desc")}</p>
    </div>
  </section>

  {#if error}
    <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
  {/if}
  {#if message}
    <Alert><AlertDescription>{message}</AlertDescription></Alert>
  {/if}

  <form id="tts-settings-form" class="tts-settings-form" on:submit|preventDefault={saveSettings}>
    <Card>
      <CardHeader>
        <CardTitle>{t("enableTool")}</CardTitle>
        <CardDescription>{t("enableToolDesc")}</CardDescription>
      </CardHeader>
      <CardContent class="tts-settings-card-content">
        <div class="tts-settings-switch-row">
          <Label for="tts-enabled">{t("enabled")}</Label>
          <Switch id="tts-enabled" bind:checked={ttsGenerate.enabled} />
        </div>
        <div class="tts-settings-field">
          <Label for="default-provider">{t("defaultProvider")}</Label>
          <NativeSelect id="default-provider" bind:value={ttsGenerate.defaultProvider}>
            <NativeSelectOption value="macos">{t("macosProvider")}</NativeSelectOption>
            <NativeSelectOption value="xiaomi">{t("xiaomiProvider")}</NativeSelectOption>
          </NativeSelect>
        </div>
      </CardContent>
    </Card>

    <div class="tts-settings-grid">
      <Card>
        <CardHeader>
          <div class="tts-settings-card-heading">
            <CardTitle>{t("macosTitle")}</CardTitle>
            <Badge variant={macosAvailable ? "default" : "secondary"}>{macosAvailable ? t("available") : t("unavailable")}</Badge>
          </div>
          <CardDescription>{t("macosDesc")}</CardDescription>
        </CardHeader>
        <CardContent class="tts-settings-card-content">
          <div class="tts-settings-switch-row">
            <Label for="macos-enabled">{t("enabled")}</Label>
            <Switch id="macos-enabled" bind:checked={ttsGenerate.providers.macos.enabled} />
          </div>
          <div class="tts-settings-field">
            <Label for="macos-voice">{t("voice")}</Label>
            {#if macosVoices.length > 0}
              <NativeSelect id="macos-voice" bind:value={ttsGenerate.providers.macos.voice}>
                <NativeSelectOption value="">System Default</NativeSelectOption>
                {#each macosVoices as voice}
                  <NativeSelectOption value={voice.id}>{voice.id}{voice.locale ? ` · ${voice.locale}` : ""}</NativeSelectOption>
                {/each}
              </NativeSelect>
            {:else}
              <Input id="macos-voice" bind:value={ttsGenerate.providers.macos.voice} placeholder="Tingting" />
            {/if}
          </div>
          <div class="tts-settings-field">
            <Label for="macos-format">{t("format")}</Label>
            <NativeSelect id="macos-format" bind:value={ttsGenerate.providers.macos.format}>
              <NativeSelectOption value="aiff">AIFF</NativeSelectOption>
              <NativeSelectOption value="m4a">M4A</NativeSelectOption>
              <NativeSelectOption value="caf">CAF</NativeSelectOption>
            </NativeSelect>
          </div>
          <p class="tts-settings-help">{t("noModel")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("xiaomiTitle")}</CardTitle>
          <CardDescription>{t("xiaomiDesc")}</CardDescription>
        </CardHeader>
        <CardContent class="tts-settings-card-content">
          <div class="tts-settings-switch-row">
            <Label for="xiaomi-enabled">{t("enabled")}</Label>
            <Switch id="xiaomi-enabled" bind:checked={ttsGenerate.providers.xiaomi.enabled} />
          </div>
          <div class="tts-settings-field">
            <Label for="xiaomi-api-key">{t("apiKey")}</Label>
            <div class="tts-settings-secret-row">
              <Input id="xiaomi-api-key" type={showApiKey ? "text" : "password"} bind:value={ttsGenerate.providers.xiaomi.apiKey} placeholder="MIMO_API_KEY" />
              <Button type="button" variant="outline" on:click={() => showApiKey = !showApiKey}>{showApiKey ? "Hide" : "Show"}</Button>
            </div>
          </div>
          <div class="tts-settings-field">
            <Label for="xiaomi-base-url">{t("baseUrl")}</Label>
            <Input id="xiaomi-base-url" bind:value={ttsGenerate.providers.xiaomi.baseUrl} placeholder="https://api.xiaomimimo.com/v1" />
          </div>
          <div class="tts-settings-field">
            <Label for="xiaomi-model">{t("model")}</Label>
            <Input id="xiaomi-model" bind:value={ttsGenerate.providers.xiaomi.model} placeholder="mimo-v2-tts" />
          </div>
          <div class="tts-settings-field">
            <Label for="xiaomi-voice">{t("voice")}</Label>
            <NativeSelect id="xiaomi-voice" bind:value={ttsGenerate.providers.xiaomi.voice}>
              {#each xiaomiVoices as voice}
                <NativeSelectOption value={voice.id}>{voice.id}{voice.locale ? ` · ${voice.locale}` : ""}</NativeSelectOption>
              {/each}
            </NativeSelect>
          </div>
          <div class="tts-settings-field">
            <Label for="xiaomi-format">{t("format")}</Label>
            <NativeSelect id="xiaomi-format" bind:value={ttsGenerate.providers.xiaomi.format}>
              <NativeSelectOption value="wav">WAV</NativeSelectOption>
            </NativeSelect>
          </div>
        </CardContent>
      </Card>
    </div>

    <Card>
      <CardHeader>
        <CardTitle>{t("testTitle")}</CardTitle>
        <CardDescription>{t("testTextPlaceholder")}</CardDescription>
      </CardHeader>
      <CardContent class="tts-settings-card-content">
        <div class="tts-settings-field">
          <Label for="test-provider">{t("testProvider")}</Label>
          <NativeSelect id="test-provider" bind:value={testProvider}>
            <NativeSelectOption value="macos">{t("macosProvider")}</NativeSelectOption>
            <NativeSelectOption value="xiaomi">{t("xiaomiProvider")}</NativeSelectOption>
          </NativeSelect>
        </div>
        <div class="tts-settings-field">
          <Label for="test-text">{t("testText")}</Label>
          <Input id="test-text" bind:value={testText} placeholder={t("testTextPlaceholder")} />
        </div>
        <Button type="button" on:click={testSynthesis} disabled={testing || loading}>{testing ? t("testingButton") : t("testButton")}</Button>
        {#if testResult}
          <div class="tts-settings-result">
            <strong>{t("testResultTitle")}</strong>
            <pre>{JSON.stringify(testResult.details ?? testResult, null, 2)}</pre>
          </div>
        {/if}
      </CardContent>
    </Card>
  </form>
</div>

<div class="settings-footbar">
  <div class="settings-footbar-status">
    {#if error}<span class="tts-settings-status-error">{error}</span>{/if}
    {#if message}<span class="tts-settings-status-success">{message}</span>{/if}
  </div>
  <Button form="tts-settings-form" type="submit" disabled={saving || loading}>{saving ? t("savingButton") : t("saveButton")}</Button>
</div>

<style>
  .tts-settings-page {
    max-width: 1200px;
    padding: 2rem 2rem 6rem;
  }

  .tts-settings-header {
    margin-bottom: 1.5rem;
  }

  .tts-settings-eyebrow {
    color: var(--muted-foreground);
    font-size: 0.78rem;
    letter-spacing: 0.08em;
    margin: 0 0 0.35rem;
    text-transform: uppercase;
  }

  .tts-settings-title {
    font-family: var(--font-serif, Georgia, serif);
    font-size: clamp(2rem, 4vw, 3rem);
    line-height: 1.1;
    margin: 0;
  }

  .tts-settings-desc {
    color: var(--muted-foreground);
    margin: 0.75rem 0 0;
    max-width: 780px;
  }

  .tts-settings-form,
  .tts-settings-card-content {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .tts-settings-grid {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .tts-settings-card-heading,
  .tts-settings-switch-row,
  .tts-settings-secret-row {
    align-items: center;
    display: flex;
    gap: 0.75rem;
    justify-content: space-between;
  }

  .tts-settings-field {
    display: grid;
    gap: 0.45rem;
  }

  .tts-settings-help {
    color: var(--muted-foreground);
    font-size: 0.9rem;
    margin: 0;
  }

  .tts-settings-result {
    background: var(--muted);
    border-radius: 0.75rem;
    padding: 1rem;
  }

  .tts-settings-result pre {
    font-family: var(--font-mono, monospace);
    font-size: 0.82rem;
    margin: 0.5rem 0 0;
    overflow: auto;
    white-space: pre-wrap;
  }

  .tts-settings-status-error {
    color: var(--destructive);
  }

  .tts-settings-status-success {
    color: var(--accent-foreground);
  }

  @media (max-width: 900px) {
    .tts-settings-page {
      padding-inline: 1rem;
    }

    .tts-settings-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
```

- [ ] **Step 3: Run build to catch Svelte and TypeScript errors**

Run:

```bash
npm run build
```

Expected: PASS. If the build fails because of component API differences, fix the Svelte page to match the component usage patterns already present in `src/routes/settings/image/+page.svelte` and rerun until PASS.

- [ ] **Step 4: Commit Task 7**

```bash
git add src/routes/settings/+layout.svelte src/routes/settings/tts/+page.svelte
git commit -m "feat: add tts settings page

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Update product documentation

**Files:**
- Modify: `README.md`
- Modify: `features.md`
- Modify: `prd.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update `README.md`**

Add `ttsGenerate` near the built-in image/video tool list:

```md
- `ttsGenerate`: built-in deferred text-to-speech tool. It supports macOS system voices on macOS and Xiaomi MiMo TTS, saves generated audio to the runtime artifact directory, and automatically sends the audio file back to the active chat when upload is available.
```

Add environment variables near image/video generation variables:

```md
| Variable | Description |
| --- | --- |
| `MOLIBOT_TTS_GENERATE_ENABLED` | Enable or disable the built-in TTS generation tool. Defaults to enabled. |
| `MOLIBOT_TTS_GENERATE_DEFAULT_PROVIDER` | Default TTS provider: `macos` or `xiaomi`. |
| `MOLIBOT_TTS_MACOS_ENABLED` | Enable macOS system voice provider. Only works on macOS. |
| `MOLIBOT_TTS_MACOS_VOICE` | Default macOS system voice, such as `Tingting` or `Samantha`. |
| `MOLIBOT_TTS_XIAOMI_ENABLED` | Enable Xiaomi MiMo TTS provider. Defaults to enabled when an API key is configured. |
| `MOLIBOT_TTS_XIAOMI_API_KEY` | Xiaomi MiMo API key. |
| `MOLIBOT_TTS_XIAOMI_BASE_URL` | Xiaomi MiMo base URL. Defaults to `https://api.xiaomimimo.com/v1`. |
| `MOLIBOT_TTS_XIAOMI_MODEL` | Xiaomi TTS model. Defaults to `mimo-v2-tts`. |
| `MOLIBOT_TTS_XIAOMI_VOICE` | Xiaomi TTS voice. Defaults to `mimo_default`; also supports `default_zh` and `default_en`. |
```

- [ ] **Step 2: Update `features.md`**

Add a delivered feature entry dated `2026-06-09`:

```md
### 2026-06-09 — Built-in TTS deferred tool

- Added `ttsGenerate`, a shared Agent-layer deferred tool for text-to-speech generation.
- Added macOS system voice support through the built-in `say` command, available only on macOS.
- Added Xiaomi MiMo TTS support with model and voice selection.
- Added `/settings/tts` for enabling the tool, selecting the default provider, configuring provider credentials, selecting voices, and running test synthesis.
- Generated audio is saved to controlled runtime artifacts and automatically uploaded through the shared runtime upload capability when available.
```

- [ ] **Step 3: Update `prd.md`**

Add or update the relevant built-in tool requirement with this acceptance text:

```md
### Built-in TTS generation tool

Status: Delivered 2026-06-09

Acceptance criteria:

- `ttsGenerate` is available as a deferred Agent-layer tool.
- The tool supports macOS system voices on macOS and Xiaomi MiMo TTS.
- Users can configure default provider, Xiaomi API key, model, voice, and macOS voice from `/settings/tts`.
- Generated audio is saved to a controlled artifact path and sent back to the active chat when upload is available.
- Channel implementations do not contain TTS generation logic.
```

- [ ] **Step 4: Update `CHANGELOG.md`**

Add a high-level item under the current release section:

```md
- Added a built-in deferred `ttsGenerate` tool with a dedicated TTS settings page, macOS system voice support, Xiaomi MiMo TTS support, configurable voices/models, artifact saving, and automatic chat upload.
```

- [ ] **Step 5: Commit Task 8**

```bash
git add README.md features.md prd.md CHANGELOG.md
git commit -m "docs: document tts generate tool

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Final verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run focused test suite**

Run:

```bash
node --import ./scripts/register-loader.js --import tsx --test \
  src/lib/server/settings/sanitize.test.ts \
  src/lib/server/settings/store.test.ts \
  src/lib/server/agent/ttsGenerate/providers.test.ts \
  src/lib/server/agent/ttsGenerate/ttsGenerateTool.test.ts \
  src/lib/server/agent/tools/index.test.ts \
  src/lib/server/agent/tools/toolSearch.test.ts \
  src/lib/server/agent/prompts/prompt.test.ts
```

Expected: PASS with no failing subtests.

- [ ] **Step 2: Run production build**

Run:

```bash
npm run build
```

Expected: PASS with no TypeScript, Vite, or Svelte errors.

- [ ] **Step 3: Inspect git status**

Run:

```bash
git status --short
```

Expected: clean working tree. If files remain modified, inspect each file and either commit a fix with a focused message or revert accidental changes.

- [ ] **Step 4: Record final verification result**

Prepare a final implementation summary containing:

```md
Implemented:
- `ttsGenerate` deferred tool
- macOS and Xiaomi TTS providers
- `/settings/tts` page and settings APIs
- Deferred prompt/toolSearch routing
- Documentation updates

Verified:
- focused node --test suite passed
- npm run build passed
```

If any command fails, include the exact failing command and the relevant output summary instead of claiming success.

---

## Plan self-review

- Spec coverage: Tasks cover Agent-layer tool, provider abstraction, settings schema/defaults/sanitize/store, deferred registration, prompt routing, settings APIs, settings UI, docs, tests, and build verification.
- Placeholder scan: This plan contains concrete file paths, commands, expected outcomes, and code blocks for each implementation step. It does not rely on unspecified implementation steps.
- Type consistency: The plan consistently uses `ttsGenerate`, `TtsGenerateSettings`, `TtsGenerateProviderId`, provider IDs `macos` and `xiaomi`, and tool parameters `text`, `provider`, `voice`, `model`, `style`, `format`, `fileName`, and `autoUpload`.
