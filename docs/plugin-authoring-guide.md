# Plugin Authoring Guide

This guide explains the plugin system as it exists today in Molibot:

- what kinds of plugins exist
- how to write a plugin
- how to install and enable a plugin
- what format and structure a plugin should follow
- a full demo using the built-in Cloudflare HTML publish plugin

Important: this guide describes the current real behavior, not the future ideal state.

## 1. Current support matrix

Molibot currently has three practical plugin directions:

| Type | What it is for | Can it run today? | How it is added today? |
|---|---|---|---|
| Channel plugin | New inbound/outbound chat channels such as Telegram, Feishu, QQ, Weixin | Yes, if built into the codebase | Add code and register it in the built-in channel registry |
| Feature plugin | New product capability for the agent, settings, and prompt, such as HTML publishing | Yes, if built into the codebase | Add code and register it in the built-in feature registry |
| Provider plugin | New model/provider integration | Built-in only | External manifests can be discovered, but external provider execution is not wired into runtime yet |

There is also a separate external plugin manifest scan:

- `${DATA_DIR}/plugins/channels/*/plugin.json`
- `${DATA_DIR}/plugins/providers/*/plugin.json`

That external scan is useful today for discovery and catalog display only.

It does **not** mean arbitrary external plugin code will automatically execute.

## 2. The most important distinction

If someone asks “how do I install a plugin into Molibot?”, there are really two answers:

### 2.1 Truly usable plugin today

If the plugin needs to actually work at runtime today, the safe path is:

1. add plugin code into this repository
2. register it in a built-in registry
3. add any required settings fields
4. expose its settings UI if needed
5. restart the app

This is the path used by the current Cloudflare HTML publish plugin.

### 2.2 External plugin package today

If someone creates a folder under `${DATA_DIR}/plugins/...` with a `plugin.json`, Molibot can currently:

- discover it
- validate the manifest
- show it in `/settings/plugins`

But Molibot will **not** execute that external plugin module yet.

So if the goal is “I want this plugin to really run now”, do not rely on external plugin manifests yet.

## 3. Plugin types in plain English

### 3.1 Channel plugin

A channel plugin connects Molibot to a messaging platform.

Examples:

- Telegram
- Feishu
- QQ
- Weixin

It handles:

- receiving messages
- normalizing them
- sending replies back
- starting and stopping cleanly

### 3.2 Feature plugin

A feature plugin adds a product capability to the runtime itself.

Examples:

- publish HTML to R2
- export generated files somewhere
- post generated content to an internal service
- register a special tool the agent can call

A feature plugin can do any of these:

- expose settings
- inject instructions into the system prompt
- register one or more agent tools
- validate whether it is enabled and configured

This is the best fit for “generate HTML, upload it, then return a URL”.

### 3.3 Provider plugin

A provider plugin would extend model/provider integrations.

Today, built-in providers work. External provider manifests are discoverable, but not executable yet.

## 4. How built-in feature plugins work

Today’s built-in feature plugins are registered in:

- [src/lib/server/plugins/feature-registry.ts](/Users/gusi/Github/molipibot/src/lib/server/plugins/feature-registry.ts)

Each built-in feature plugin currently has four practical parts:

1. identity
2. enabled check
3. settings field declaration
4. prompt guidance
5. tool registration

The effective shape is:

```ts
interface BuiltInFeaturePlugin {
  key: string;
  name: string;
  version?: string;
  description?: string;
  settingsKey: keyof RuntimeSettings["plugins"];
  settingsFields?: PluginSettingField[];
  isEnabled: (settings: RuntimeSettings) => boolean;
  buildPromptSection?: (settings: RuntimeSettings) => string | null;
  createTools?: (context: { getSettings: () => RuntimeSettings }) => AgentTool<any>[];
}
```

In other words:

- `isEnabled` decides whether the plugin is active
- `settingsFields` tells `/settings/plugins` what form controls to render
- `buildPromptSection` tells the agent what this plugin does
- `createTools` gives the agent the actual action surface

## 5. What files you usually need when writing a built-in feature plugin

For a real usable built-in feature plugin, you will usually touch these places:

### 5.1 Plugin runtime registration

- `src/lib/server/plugins/feature-registry.ts`
- `src/lib/server/plugins/<your-plugin>/plugin.ts`

Plugin-specific declaration should live inside the plugin's own subdirectory. The root feature registry should stay as a thin aggregator that imports built-in plugins and exposes the combined catalog/prompt/tool entry points.

### 5.2 Settings schema

- `src/lib/server/settings/schema.ts`

This defines what fields the plugin needs.

### 5.3 Settings defaults

- `src/lib/server/settings/defaults.ts`

This defines default values and optional env fallbacks.

### 5.4 Settings persistence

- `src/lib/server/settings/store.ts`
- `src/lib/server/app/runtime.ts`
- `src/routes/api/settings/+server.ts`

These make sure plugin settings can be saved, loaded, validated, and merged safely.

### 5.5 Settings UI

- `src/routes/settings/plugins/+page.svelte`

This is where the operator turns the plugin on and fills in its config.

Important: first-class feature plugins should not require hand-written per-plugin HTML in the settings page. The plugin should declare its own settings fields in the registry metadata, and the settings page should render those fields dynamically.

### 5.6 Agent prompt injection

- `src/lib/server/agent/prompt.ts`

This is where the plugin explains itself to the agent.

### 5.7 Plugin-owned tool implementation

- `src/lib/server/plugins/<your-plugin>/...`
- `src/lib/server/plugins/feature-registry.ts`

The plugin should own its own runtime actions and plugin declaration inside its own subdirectory. The outer agent/runtime layer should load those actions from the root feature registry instead of keeping plugin-specific code under the generic agent tools directory.

## 6. Built-in feature plugin template

This is the smallest realistic template for a new built-in feature plugin.

### 6.1 Registry template

```ts
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { RuntimeSettings } from "../settings/index.js";

interface BuiltInFeaturePlugin {
  key: string;
  name: string;
  version?: string;
  description?: string;
  settingsKey: keyof RuntimeSettings["plugins"];
  settingsFields?: PluginSettingField[];
  isEnabled: (settings: RuntimeSettings) => boolean;
  buildPromptSection?: (settings: RuntimeSettings) => string | null;
  createTools?: (context: { getSettings: () => RuntimeSettings }) => AgentTool<any>[];
}

const exampleFeaturePlugin: BuiltInFeaturePlugin = {
  key: "example-feature",
  name: "Example Feature",
  version: "built-in",
  description: "Short description of what this plugin adds.",
  settingsKey: "exampleFeature",
  settingsFields: [
    { key: "enabled", label: "Enable Example Feature", type: "boolean", defaultValue: false },
    { key: "apiBaseUrl", label: "API base URL", type: "text", required: true, placeholder: "https://example.com" },
    { key: "apiKey", label: "API key", type: "password", required: true }
  ],
  isEnabled: (settings) => settings.plugins.exampleFeature.enabled,
  buildPromptSection: (settings) => {
    if (!settings.plugins.exampleFeature.enabled) return null;
    return [
      "## Installed Feature Plugin: Example Feature",
      "- Explain to the agent when to use it.",
      "- Explain what it can do.",
      "- Explain what it must never fake."
    ].join("\\n");
  },
  createTools: (context) => {
    if (!context.getSettings().plugins.exampleFeature.enabled) return [];
    return [
      // return one or more AgentTool instances here
    ];
  }
};
```

### 6.2 Settings template

Add a new block under `plugins` in your runtime settings schema:

```ts
export interface ExampleFeaturePluginSettings {
  enabled: boolean;
  apiBaseUrl: string;
  apiKey: string;
}

export interface PluginSettings {
  memory: MemoryBackendSettings;
  exampleFeature: ExampleFeaturePluginSettings;
}
```

### 6.3 Prompt template

Good plugin prompt text should always cover:

- when the agent should use the plugin
- what counts as valid input
- what success looks like
- what not to fake
- what to say when it fails

A good pattern:

```text
## Installed Feature Plugin: Example Feature
- When the user asks for X, call `example_tool`.
- Only do this when input includes A and B.
- Success returns C.
- Never invent a result.
- If it fails, say it failed and report the actual error.
```

## 7. How to install a usable plugin today

Today, “installing a plugin” usually means “adding a built-in plugin into this repo”.

### 7.1 Steps

1. Add the plugin runtime code.
2. Register it in the correct built-in registry.
3. Add its config fields to settings schema/defaults/store/runtime validation.
4. Add its UI to `/settings/plugins` if it needs operator config.
5. Restart Molibot.

### 7.2 What “enabled” means

A plugin being visible in the catalog is not enough.

For a feature plugin to really work:

- it must be registered in code
- it must be enabled in settings
- it must be fully configured if it depends on credentials or URLs

## 8. How to enable a built-in feature plugin

For the current first feature plugin:

1. Open `/settings/plugins`
2. Find `Cloudflare HTML Publish`
3. Turn it on
4. Fill in:
   - Public base URL
   - Route prefix
   - Bucket name
   - Account ID
   - Access Key ID
   - Secret Access Key
   - R2 object prefix
5. Save

Once saved:

- the plugin appears as enabled in the feature plugin catalog
- the agent receives plugin guidance in its system prompt
- the `publish_html` tool becomes available when the plugin is fully configured

## 9. External plugin manifest format today

External manifest support exists today only for discovery.

### 9.1 Directory layout

```text
${DATA_DIR}/plugins/
  channels/
    my-channel/
      plugin.json
      index.js
  providers/
    my-provider/
      plugin.json
      index.js
```

### 9.2 Manifest shape

```json
{
  "kind": "channel",
  "key": "my-channel",
  "name": "My Channel",
  "version": "0.1.0",
  "description": "Optional description",
  "entry": "./index.js"
}
```

### 9.3 What this gets you today

If the manifest is valid, Molibot can:

- detect it
- list it in `/settings/plugins`
- show manifest or entry-file errors

It does **not** yet execute that external module.

## 10. Cloudflare HTML publish plugin demo

This plugin is the reference demo for the first built-in feature plugin path.

### 10.1 What it does

It lets the agent:

1. receive a complete HTML document
2. upload it to Cloudflare R2
3. generate a random `.html` file name
4. return a public URL

Example final URL shape:

```text
https://example.com/html/ab12cd34ef56gh78ij90.html
```

### 10.2 What it does not do

It does **not**:

- configure your Cloudflare Pages project
- create and deploy your Worker for you automatically
- manage your Cloudflare domain routing for you
- publish partial HTML fragments

It only handles the Molibot side:

- save config
- expose agent instructions
- upload HTML to R2
- return the final public link

This plugin directory now also includes a Worker template you can deploy manually:

- `src/lib/server/plugins/cloudflareHtml/worker/index.js`
- `src/lib/server/plugins/cloudflareHtml/worker/module.ts`
- `src/lib/server/plugins/cloudflareHtml/worker/wrangler.example.toml`

### 10.3 Actual config fields

Current settings are stored under:

```ts
plugins.cloudflareHtml
```

Fields:

```ts
{
  enabled: boolean;
  accessMode: "worker" | "direct";
  workerBaseHost: string;
  publicBaseHost: string;
  routePrefix: string;
  bucketName: string;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  objectPrefix: string;
}
```

### 10.4 Agent tool surface

The plugin currently exposes one tool:

```ts
publish_html({
  html: string,
  title?: string
})
```

Rules:

- `html` must be a complete document
- it must include `<html>`, `<head>`, and `<body>`
- output file name is generated automatically
- on success, the tool returns the final public URL
- on failure, it returns the real upload error
- the public URL can be built either through Worker mode or Direct R2 mode, depending on plugin settings

### 10.5 Demo prompt

This is the kind of user request that should work well with the plugin:

```text
帮我做一个完整的落地页 HTML，主题是极简咖啡品牌，做完后直接发布并把链接给我。
```

Expected flow:

1. agent generates a full HTML document
2. plugin guidance reminds the agent that HTML publishing is available
3. agent calls `publish_html`
4. HTML is uploaded into the configured R2 prefix
5. agent returns the public link

### 10.6 Demo object-path result

If the plugin is configured like this:

```text
accessMode     = worker
workerBaseHost = https://example.com
routePrefix   = /html
objectPrefix  = html/
```

Then a successful publish might become:

```text
R2 object key: html/ab12cd34ef56gh78ij90.html
Public URL:    https://example.com/html/ab12cd34ef56gh78ij90.html
```

Direct R2 mode example:

```text
accessMode     = direct
publicBaseHost = https://pub-xxxxxxxx.r2.dev
objectPrefix   = html/
```

Then a successful publish might become:

```text
R2 object key: html/ab12cd34ef56gh78ij90.html
Public URL:    https://pub-xxxxxxxx.r2.dev/html/ab12cd34ef56gh78ij90.html
```

## 11. Recommended authoring rules

When writing new plugins for Molibot, follow these rules:

### 11.1 Keep the plugin single-purpose

A plugin should do one clear thing well.

Good:

- publish HTML
- export reports
- post to one internal service

Bad:

- upload HTML
- configure DNS
- rewrite the prompt
- create tasks
- deploy infrastructure

all inside one plugin

### 11.2 Be honest with status

Never document a plugin as installable if it is only discoverable.

### 11.3 Put operator config in one place

If a plugin needs setup, put it under `/settings/plugins` unless there is a very strong reason not to.

### 11.4 Tell the agent what not to fake

This matters a lot.

A good plugin prompt always says:

- what success is
- what failure is
- that URLs/results must not be invented

### 11.5 Validate before exposing tools

If a plugin depends on credentials, URLs, or external services, do not expose its runtime tool until configuration is complete.

That is how the current Cloudflare HTML plugin works.

## 12. Short answer: how someone should write a plugin today

If you want a plugin that really works today:

1. write it as a built-in plugin in this repo
2. register it in code
3. add settings + UI
4. add prompt guidance
5. add one or more agent tools

If you only want it to appear in the plugin catalog:

1. create a `plugin.json`
2. place it under `${DATA_DIR}/plugins/channels/...` or `${DATA_DIR}/plugins/providers/...`
3. Molibot will discover it

But that second path is not enough to make it run.
