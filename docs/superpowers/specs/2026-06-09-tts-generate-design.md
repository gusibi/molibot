# TTS Generate Deferred Tool Design

Date: 2026-06-09

## Summary

Add an Agent-layer deferred tool named `ttsGenerate` for text-to-speech audio generation. The first version supports two providers:

- macOS system voices through the built-in `say` command, available only on macOS.
- Xiaomi MiMo TTS through `https://api.xiaomimimo.com/v1/chat/completions`, using the default model `mimo-v2-tts`.

The tool writes generated audio to a controlled artifact directory and, by default, sends the file back to the current chat through the shared runtime `uploadFile` capability. It also adds an independent `/settings/tts` settings page for provider configuration, API keys, default voice/model selection, and live test generation.

This is a shared Agent-layer feature. Channel implementations remain responsible only for message transport and file upload adaptation.

## Goals

- Provide a reusable deferred tool for user requests such as converting text to speech, generating narration, or producing voiceover audio.
- Support provider and voice selection at call time, with sensible defaults from settings.
- Support model selection where the provider has a model concept. Xiaomi uses `mimo-v2-tts`; macOS has no model concept.
- Save generated audio as an artifact and automatically return it to the active chat when possible.
- Keep the implementation parallel to existing `imageGenerate` and `videoGenerate` conventions.
- Add a settings page that works across desktop/mobile, Chinese/English, and light/dark themes.

## Non-goals

- No asynchronous task submission or polling in the first version.
- No streaming audio response in the first version.
- No voice cloning support.
- No Channel-specific TTS logic.
- No direct writes to repository root or arbitrary system paths.
- No hard-coded machine-specific absolute paths in code, docs, UI examples, defaults, or prompts.

## Recommended approach

Use a synchronous generation tool, similar to `imageGenerate`.

This fits both initial providers:

- Xiaomi MiMo TTS exposes synchronous and streaming chat-completion-style synthesis. The first version will use non-streaming synthesis and extract complete base64 audio from the response.
- macOS `say` can generate a local audio file synchronously.

An async task model, like `videoGenerate`, would add unnecessary complexity for the first version. The design keeps room for a future `taskId` mode if a later provider requires long-running async synthesis.

## Architecture

### Agent tool module

Create a new shared Agent-layer module:

```text
src/lib/server/agent/ttsGenerate/
  ttsGenerateTool.ts
  providers.ts
  types.ts
  ttsGenerateTool.test.ts
```

Responsibilities:

- `ttsGenerateTool.ts`
  - Define the `ttsGenerate` TypeBox schema.
  - Resolve provider, voice, model, format, output file name, and default settings.
  - Call the selected provider.
  - Save the generated audio to a controlled artifact path.
  - Attempt shared `uploadFile` when `autoUpload` is true.
  - Return standard `content` and diagnostic `details`.

- `providers.ts`
  - Implement provider-specific synthesis for `macos` and `xiaomi`.
  - Map provider errors into tool-readable errors.
  - Keep provider code independent of Agent routing, prompt logic, Channel uploads, and UI.

- `types.ts`
  - Define provider IDs, provider inputs, provider results, provider context, settings-derived config, and known voice/model metadata.

### Settings integration

Add `ttsGenerate` to the runtime settings model:

- `src/lib/server/settings/schema.ts`
- `src/lib/server/settings/defaults.ts`
- `src/lib/server/settings/sanitize.ts`
- `src/lib/server/settings/store.ts`

The settings block should include:

- Global enable flag.
- Default provider: `macos` or `xiaomi`.
- macOS provider settings:
  - enabled flag
  - default voice
- Xiaomi provider settings:
  - enabled flag
  - API key
  - base URL, default `https://api.xiaomimimo.com/v1`
  - model, default `mimo-v2-tts`
  - default voice, default `mimo_default`
  - output format, default `wav`

Provider-specific defaults are allowed. Xiaomi defaults to `wav`; macOS defaults to the safest format supported directly by `say` on the current system, with the resulting extension and MIME type reported in tool details.

Support environment variable defaults:

- `MOLIBOT_TTS_GENERATE_ENABLED`
- `MOLIBOT_TTS_GENERATE_DEFAULT_PROVIDER`
- `MOLIBOT_TTS_XIAOMI_API_KEY`
- `MOLIBOT_TTS_XIAOMI_BASE_URL`
- `MOLIBOT_TTS_XIAOMI_MODEL`
- `MOLIBOT_TTS_XIAOMI_VOICE`
- `MOLIBOT_TTS_MACOS_VOICE`

Settings sanitizers must handle both startup loading of old settings files and settings-page save/readback paths.

### Settings UI

Add a dedicated settings page:

- `src/routes/settings/tts/+page.svelte`
- `src/routes/api/settings/tts-generate/test/+server.ts`
- `src/routes/api/settings/tts-generate/voices/+server.ts` for macOS voice discovery if needed
- `src/routes/api/settings/dynamic/[key]/+server.ts`
- `src/routes/settings/+layout.svelte`

The page should include:

- Global TTS enable switch.
- Default provider selector.
- macOS provider card:
  - availability status based on the current OS
  - enabled switch
  - default voice selector populated from `say -v ?` when available
  - test text
  - generate test audio button
  - note that macOS has no model selector
- Xiaomi provider card:
  - enabled switch
  - API key input
  - base URL input
  - model selector/input, default `mimo-v2-tts`
  - voice selector with `mimo_default`, `default_zh`, `default_en`
  - output format selector, default `wav`
  - test text
  - generate test audio button
- Fixed `.settings-footbar` save area.

The UI must follow existing settings page patterns, use semantic class names, preserve Chinese/English copy, support light/dark themes, and remain responsive.

### Deferred tool registration

Update shared tool registration and prompt discovery:

- `src/lib/server/agent/tools/index.ts`
  - create the runtime `ttsGenerate` tool
  - wrap it consistently with existing serialized tool patterns
  - register a deferred entry named `ttsGenerate`

- `src/lib/server/agent/prompts/prompt.ts`
  - add `ttsGenerate` to the available deferred tools list
  - add semantic routing guidance: for clear text-to-speech, narration, voiceover, or spoken-audio generation requests, call `toolSearch({ query: "select:ttsGenerate" })`, then call `ttsGenerate`
  - avoid stuffing full schema or long provider instructions into the prompt
  - ensure bash, skill, or browser fallbacks do not take priority for clear TTS intents

- `src/lib/server/agent/tools/toolSearch.test.ts`
  - verify `select:ttsGenerate` loads the full schema

## Tool contract

Tool name: `ttsGenerate`

Parameters:

- `text` required string
  - The text to synthesize.
- `provider` optional enum: `macos`, `xiaomi`
  - Defaults to settings.
- `voice` optional string
  - Provider-specific voice ID. Defaults to provider setting.
- `model` optional string
  - Provider-specific model ID. Used by Xiaomi; ignored or rejected for macOS depending on final implementation fit.
- `style` optional string
  - Xiaomi style instruction. The provider maps this into a leading `<style>...</style>` prefix. macOS does not support style.
- `format` optional enum/string
  - Provider-specific default. Xiaomi defaults to `wav`; macOS uses the safest format supported directly by `say` on the current system and reports the final extension and MIME type in `details`.
- `fileName` optional string
  - Safe basename only. No directory traversal or absolute paths.
- `autoUpload` optional boolean
  - Defaults to `true`.

Return shape:

- `content`
  - Human-readable status for the model and user-facing response.
- `details`
  - `provider`
  - `voice`
  - `model`
  - `format`
  - `path`
  - `mimeType`
  - `uploaded`
  - upload or provider diagnostic summary when relevant

## Provider behavior

### macOS provider

Availability:

- Available only when `process.platform === "darwin"`.
- On non-macOS systems, the settings page shows unavailable status and tool calls fail with a clear provider-unavailable error.

Voice discovery:

- Use `say -v ?` from a backend endpoint to discover installed voices.
- If discovery fails, show a safe degraded UI state and let the user manually enter/select a configured default.

Synthesis:

- Invoke `say` with safe argument arrays, not shell string interpolation.
- Write output directly to the resolved artifact path.
- Respect `AbortSignal` by terminating the child process when aborted.
- Do not call shell fallbacks from the prompt; this provider owns the local process call.

Model support:

- macOS has no model selector. The UI and tool details should make that explicit.

### Xiaomi provider

Endpoint and authentication:

- Base URL default: `https://api.xiaomimimo.com/v1`
- Request path: `/chat/completions`
- Header: `api-key: <configured key>`
- Header: `Content-Type: application/json`

Default request:

```json
{
  "model": "mimo-v2-tts",
  "messages": [
    {
      "role": "assistant",
      "content": "Text to synthesize"
    }
  ],
  "audio": {
    "format": "wav",
    "voice": "mimo_default"
  },
  "stream": false
}
```

Voice options:

- `mimo_default`
- `default_zh`
- `default_en`

Style:

- If `style` is provided, prepend `<style>${style}</style>` to the synthesized assistant text.
- Do not expose voice cloning because the referenced Xiaomi docs state it is not supported.

Response handling:

- Read `choices[0].message.audio.data`.
- Treat it as base64 audio.
- Decode and write to the artifact file.
- If the response lacks audio data, fail with a response-format error that includes a safe response summary but no secret values.

Streaming:

- Not included in the first version. Streaming requires `pcm16` chunks and a stitching path; this can be added later if needed.

## File output and upload

- Use the same controlled artifact approach as existing generation tools.
- Default files go under the runtime scratch artifact directory.
- Generated names should be stable, readable, and collision-resistant, for example `tts-20260609-153012-xiaomi.wav`.
- If `fileName` is provided, sanitize it as a basename and reject absolute paths or path traversal.
- If audio generation succeeds and upload fails, return success with `uploaded: false` and an upload error summary.
- Do not import Channel-specific modules from the TTS tool.

## Error handling

The tool should return or throw clear errors for:

- TTS tool disabled.
- Provider disabled or unknown.
- Provider unavailable on current OS.
- Missing Xiaomi API key.
- Unsupported voice or model when validation is possible.
- Xiaomi HTTP failure.
- Xiaomi response missing audio data.
- macOS `say` process failure.
- Aborted execution.
- File write failure.
- Upload failure after successful generation.

Error details must not leak API keys or host-specific absolute paths into user-facing text.

## Tests

### Tool tests

Add `src/lib/server/agent/ttsGenerate/ttsGenerateTool.test.ts` covering:

- default provider selection from settings
- explicit provider override
- disabled global tool
- disabled provider
- Xiaomi success with base64 audio saved to file
- Xiaomi missing API key
- Xiaomi malformed response without audio data
- macOS unavailable on non-darwin platforms
- macOS process invocation uses safe arguments rather than shell string construction
- `autoUpload: true` calls shared `uploadFile`
- upload failure after successful generation reports partial success
- abort handling

### Deferred and prompt tests

Update:

- `src/lib/server/agent/tools/index.test.ts`
  - verify `ttsGenerate` is registered as a deferred tool
  - verify deferred entry name and true tool name match
- `src/lib/server/agent/tools/toolSearch.test.ts`
  - verify `select:ttsGenerate` loads the full tool schema
- `src/lib/server/agent/prompts/prompt.test.ts`
  - verify `available-deferred-tools` includes `ttsGenerate`
  - verify clear TTS intent routes through `select:ttsGenerate`
  - verify prompt guidance does not prefer bash, skill, browser, or other fallback for clear TTS requests

### Settings tests

Update `src/lib/server/settings/sanitize.test.ts` or adjacent settings tests covering:

- old settings load with missing `ttsGenerate` gets defaults
- settings save/readback preserves `ttsGenerate` fields
- invalid default provider falls back safely
- Xiaomi base URL, model, voice, and format sanitize correctly
- macOS default voice sanitizes as a string without requiring current OS voice discovery

## Documentation updates

After implementation, update:

- `features.md`
  - Delivered TTS deferred tool, providers, settings page, and file upload behavior.
- `prd.md`
  - Requirement state and acceptance criteria.
- `CHANGELOG.md`
  - High-level release note for built-in TTS generation.
- `README.md`
  - Built-in tool list, settings page note, and environment variables.

Only update `docs/tools/deferred-tool-authoring-guide.md` if implementation reveals a reusable audio-artifact convention worth documenting.

## Acceptance criteria

- `ttsGenerate` exists as a shared Agent-layer deferred tool.
- `toolSearch({ query: "select:ttsGenerate" })` loads its full schema.
- Prompt guidance lists `ttsGenerate` and routes clear TTS requests to it.
- `/settings/tts` allows enabling/disabling TTS, choosing default provider, configuring Xiaomi, selecting voices, and running a test generation.
- macOS provider works on macOS and returns a clear unavailable error elsewhere.
- Xiaomi provider can synthesize audio using configured API key, model, voice, and format.
- Generated audio is written to a controlled artifact path.
- Generated audio is automatically uploaded to the active chat when runtime upload is available and `autoUpload` is true.
- Upload failure after successful generation is reported as partial success, not total generation failure.
- No Channel-specific TTS logic is introduced.
- Required unit tests pass.
- `npm run build` passes.
- `features.md`, `prd.md`, `CHANGELOG.md`, and `README.md` are updated after implementation.
