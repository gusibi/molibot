# Plugin Manifest

Built-in plugins stay in the source tree and ship with the app.

- Built-in channel plugins: code-owned under `src/lib/server`
- Built-in provider plugins: code-owned under `src/lib/server`
- Built-in feature plugins: code-owned under `src/lib/server`
- External plugins: discovered from `${DATA_DIR}/plugins`

## Directory Layout

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

## `plugin.json`

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

## Current Runtime Behavior

- Built-in plugins are active and loaded by code.
- External plugins are currently discovered, validated, and shown in the plugin catalog UI.
- Missing `plugin.json` or missing `entry` files are surfaced as `error` entries in the catalog.
- External plugin code execution is not yet enabled in runtime startup. This is the next step after catalog/discovery.

Important:

- This manifest flow currently covers external `channel` and `provider` discovery.
- Feature plugins exist today as built-in code-registered runtime plugins, not as executable external manifests.
- For a practical authoring/install guide, see [`docs/guides/plugins/plugin-authoring.md`](../../guides/plugins/plugin-authoring.md).
- **Mini Apps are a separate plugin kind with their own manifest.** They live under
  `~/.molibot/miniapps/apps/<app-id>/manifest.json`, not `plugins/`, and unlike the
  manifests above their server code *is* executed in-process. They contribute Agent
  tools plus a hosted UI over one private data directory. See
  [`docs/guides/miniapps/authoring.md`](../../guides/miniapps/authoring.md).
