# Plugin Development Guide

This document describes how Molibot plugins are organized, what interfaces they implement, how they are discovered, and what is currently supported by runtime.

## Goals

The plugin system separates three concerns:

- Core runtime: shared lifecycle, memory, sessions, routing
- Channel plugins: Telegram, Feishu, future Slack/Lark/WhatsApp
- Provider plugins: model/provider integrations such as DeepSeek or other OpenAI-compatible backends

Built-in plugins live in the repository. External plugins live under `${DATA_DIR}/plugins`.

## Current Status

### Already supported

- Built-in channel plugins live under repository-owned plugin directories.
- Runtime loads built-in channel plugins through a registry.
- Each channel plugin instance can be enabled or disabled through config.
- External plugin manifests are discovered from `${DATA_DIR}/plugins/channels/*/plugin.json` and `${DATA_DIR}/plugins/providers/*/plugin.json`.
- External plugin discovery results are visible in the Plugins settings page and `/api/settings/plugins`.

### Not yet supported

- Runtime does not execute external plugin entry modules yet.
- Provider plugins are cataloged, but external provider execution is not wired into runtime model resolution yet.

That means external plugins are currently "discoverable" rather than "runnable".

## Directory Layout

### Built-in channel plugins

```text
src/lib/server/plugins/
  channels/
    telegram/
      index.ts
      runtime.ts
    feishu/
      index.ts
      runtime.ts
```

### External plugins

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

## Channel Plugin Contract

The core registry uses this interface:

```ts
export interface ChannelManager {
  apply(config: unknown): void;
  stop(): void;
}

export interface ChannelRuntimeDeps {
  getSettings: () => RuntimeSettings;
  updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings;
  sessions: SessionStore;
  memory: MemoryGateway;
}

export interface ChannelPluginInstance<TConfig> {
  id: string;
  config: TConfig;
  workspaceDir: string;
}

export interface ChannelPlugin<TConfig> {
  key: string;
  name: string;
  version: string;
  description?: string;
  listInstances: (settings: RuntimeSettings) => ChannelPluginInstance<TConfig>[];
  createManager: (
    instance: ChannelPluginInstance<TConfig>,
    deps: ChannelRuntimeDeps
  ) => ChannelManager;
}
```

Source of truth:

- [`src/lib/server/channels/registry.ts`](/Users/gusi/Github/molipibot/src/lib/server/channels/registry.ts)

## Built-in Channel Plugin Example

Telegram plugin entry:

- [`src/lib/server/plugins/channels/telegram/index.ts`](/Users/gusi/Github/molipibot/src/lib/server/plugins/channels/telegram/index.ts)

Feishu plugin entry:

- [`src/lib/server/plugins/channels/feishu/index.ts`](/Users/gusi/Github/molipibot/src/lib/server/plugins/channels/feishu/index.ts)

Each built-in plugin does two things:

1. Maps persisted config into runtime instances
2. Creates a channel manager that starts/stops platform-specific behavior

Example shape:

```ts
export const telegramChannelPlugin: ChannelPlugin<TelegramConfig> = {
  key: "telegram",
  name: "Telegram",
  version: "built-in",
  description: "Built-in Telegram channel plugin.",
  listInstances,
  createManager: (instance, deps) =>
    new TelegramManager(deps.getSettings, deps.updateSettings, deps.sessions, {
      instanceId: instance.id,
      workspaceDir: instance.workspaceDir,
      memory: deps.memory
    })
};
```

## Channel Runtime Responsibilities

A channel plugin runtime implementation is responsible for:

- Connecting to the platform API
- Receiving inbound messages
- Normalizing them into shared runtime context
- Calling the shared `MomRunner`
- Sending replies, edits, typing indicators, attachments, and event-triggered outputs
- Stopping cleanly when runtime disables or removes the instance

The platform-specific implementation now lives inside the plugin directory, for example:

- [`src/lib/server/plugins/channels/telegram/runtime.ts`](/Users/gusi/Github/molipibot/src/lib/server/plugins/channels/telegram/runtime.ts)
- [`src/lib/server/plugins/channels/feishu/runtime.ts`](/Users/gusi/Github/molipibot/src/lib/server/plugins/channels/feishu/runtime.ts)

## Shared Runtime Context

Channel plugins should adapt platform updates into the shared mom runtime types:

```ts
export interface ChannelInboundMessage {
  chatId: string;
  chatType: "private" | "group" | "supergroup" | "channel";
  messageId: number;
  userId: string;
  userName?: string;
  text: string;
  ts: string;
  attachments: FileAttachment[];
  imageContents: ImageContent[];
  isEvent?: boolean;
  sessionId?: string;
}

export interface MomContext {
  channel: string;
  message: ChannelInboundMessage;
  workspaceDir: string;
  chatDir: string;
  respond: (text: string, shouldLog?: boolean) => Promise<void>;
  replaceMessage: (text: string) => Promise<void>;
  respondInThread: (text: string) => Promise<void>;
  setTyping: (isTyping: boolean) => Promise<void>;
  setWorking: (isWorking: boolean) => Promise<void>;
  deleteMessage: () => Promise<void>;
  uploadFile: (filePath: string, title?: string) => Promise<void>;
}
```

Source:

- [`src/lib/server/mom/types.ts`](/Users/gusi/Github/molipibot/src/lib/server/mom/types.ts)

## Persisted Channel Configuration

Internal source of truth:

```ts
channels.<plugin>.instances[]
```

Shape:

```ts
export interface ChannelInstanceSettings {
  id: string;
  name: string;
  enabled: boolean;
  credentials: Record<string, string>;
  allowedChatIds: string[];
}
```

Examples:

```json
{
  "channels": {
    "telegram": {
      "instances": [
        {
          "id": "marketing-bot",
          "name": "Marketing Bot",
          "enabled": true,
          "credentials": {
            "token": "123456:ABC"
          },
          "allowedChatIds": ["123456789"]
        }
      ]
    },
    "feishu": {
      "instances": [
        {
          "id": "ops-feishu",
          "name": "Ops Feishu",
          "enabled": false,
          "credentials": {
            "appId": "cli_xxx",
            "appSecret": "yyy"
          },
          "allowedChatIds": ["ou_xxx"]
        }
      ]
    }
  }
}
```

Behavior:

- `enabled: true`: runtime creates and applies the plugin instance
- `enabled: false`: runtime does not load the plugin instance

## External Plugin Manifest

External discovery uses `plugin.json`:

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

Current discovery rules:

- Missing `plugin.json` -> catalog status `error`
- Invalid manifest -> catalog status `error`
- Missing `entry` file -> catalog status `error`
- Valid manifest + existing entry -> catalog status `discovered`

Related file:

- [`docs/plugin-manifest.md`](/Users/gusi/Github/molipibot/docs/plugin-manifest.md)

## Provider Plugin Shape

Provider plugin scaffolding is currently lightweight:

```ts
export interface ProviderPlugin {
  key: string;
  name: string;
  version?: string;
  description?: string;
}
```

Today, this mainly powers catalog/discovery. A later step will let provider plugins participate in real runtime model resolution and invocation.

## How Runtime Loads Plugins

Current load flow:

1. Runtime loads built-in channel plugins from code-owned registry
2. Runtime scans `${DATA_DIR}/plugins/channels` and `${DATA_DIR}/plugins/providers`
3. Runtime builds a plugin catalog
4. Runtime activates built-in channel plugin instances whose config is enabled
5. Runtime exposes the catalog through `/api/settings/plugins`

Relevant files:

- [`src/lib/server/runtime.ts`](/Users/gusi/Github/molipibot/src/lib/server/runtime.ts)
- [`src/lib/server/plugins/discovery.ts`](/Users/gusi/Github/molipibot/src/lib/server/plugins/discovery.ts)
- [`src/routes/api/settings/plugins/+server.ts`](/Users/gusi/Github/molipibot/src/routes/api/settings/plugins/+server.ts)

## How To Add A New Built-in Channel Plugin

1. Create a directory under `src/lib/server/plugins/channels/<name>/`
2. Implement `runtime.ts` with platform-specific manager/runtime logic
3. Implement `index.ts` exporting a `ChannelPlugin<TConfig>`
4. Add the plugin to `builtInChannelPlugins`
5. Add config mapping for `channels.<name>.instances[]`
6. Add settings UI if the plugin needs manual configuration

## How To Add An External Plugin Today

Today, external plugins can be prepared and discovered, but not executed.

1. Create `${DATA_DIR}/plugins/channels/<name>/plugin.json`
2. Add an `entry` file path in the manifest
3. Open `/settings/plugins`
4. Confirm the plugin appears in the catalog

If it shows as `discovered`, manifest validation passed.

## Recommended Next Step

The next implementation step is enabling safe runtime execution of external plugin entry modules. That work should include:

- explicit async plugin loading
- failure isolation per plugin
- runtime validation of exported plugin contracts
- provider plugin execution integration
