# Plugin-owned Settings and Storage PRD

> Installable plugins own their settings UI, configuration, and data
>
> - **Status**: Partially delivered — shared hosting contract and External Subagent settings migration are shipped; generic enhanced-pi installation and remaining legacy-plugin migrations are open in GitHub Issue [#34](https://github.com/gusibi/molibot/issues/34)
> - **Priority**: P1
> - **First reference migration**: External Subagent
> - **Revision**: v1.3 (2026-08-22)

## Delivery snapshot

Delivered in the first vertical slice: owner-global package/config/data/cache roots; strict manifests; compact Web/Desktop catalogs and dedicated detail views; schema and sandboxed custom settings modes; atomic config and owner-only secrets; declared actions in child-process fault domains; Web/Desktop bridges; and External Subagent's package-owned bilingual UI, configuration, detection, installation, and test actions. The native catalog merges core and contract APIs, so Memory Backend, Daily Materials, Cloudflare HTML, and External Subagent remain visible together. Tauri grants only the two plugin API families and loads custom UI through a fixed `molibot-plugin://` origin that forwards exclusively to the selected plugin's `/ui/` mount. Custom pages receive host theme tokens and report validated content heights instead of owning a fixed inner viewport. External Subagent gates Provider enablement on environment detection and treats package-manager failure as failure; its isolated runtime directory is created before installation. Cold restart verifies that enablement and custom settings both reload from their independent stores. Memory Backend and Daily Materials remain explicitly identified legacy built-ins while their later migration or removal is decided.

Still open: installing arbitrary enhanced pi packages into the Molibot contract catalog, cancellation/progress completion across every host surface, hardened atomic package replacement, the full install/upgrade/uninstall matrix, and migration or removal of remaining legacy built-in configuration such as Cloudflare HTML. The generic host therefore remains an active design authority and this PRD is not archived.

## Problem Statement

Before this slice, Molibot could install and run third-party pi extensions, but plugin configuration was stored in the global `RuntimeSettings` object and rendered inside one shared Plugins page. External Subagent has now moved to the package-owned contract; enhanced pi packages and remaining legacy built-ins still need to complete the same path.

This creates four user-visible problems:

1. Clicking **Edit** expands a large form in the list instead of opening a focused settings page.
2. A plugin cannot bring its own settings experience. Every field, validation rule, test action, and status card eventually requires a Molibot source change.
3. Plugin configuration and credentials are mixed into global Settings even though they belong to the plugin and need an independent lifecycle.
4. Code in a separate package can remain tightly coupled to Core. External Subagent is the current example: its runtime is under `package/`, but its settings schema, persistence, APIs, and special-case UI remain in Molibot Core.

The result is not an Obsidian-like model. Installing a plugin does not install everything needed to configure and operate it.

## Solution

The delivered host introduces a **plugin-owned settings contract** for installable Molibot plugins. Enhanced pi extensions can continue to run through the compatibility installer, but are not yet automatically promoted into this contract catalog.

The Plugins page becomes a compact catalog. Selecting a configurable plugin opens a dedicated route. Molibot owns the route shell, navigation, enablement, installation state, isolation boundary, and lifecycle actions; the plugin package owns the settings UI, configuration schema, validation, runtime actions, and plugin data.

Global `RuntimeSettings` retains only the host-level enabled switch for each plugin. It must not contain plugin-specific credentials, executable paths, provider choices, flags, schedules, form values, or arbitrary configuration blobs.

Plugin files live under the owner-global Molibot data root, not under a Bot, Channel, Session, or Project workspace:

```text
<dataDir>/plugins/
  packages/<plugin-id>/       # replaceable installed code and UI assets
  config/<plugin-id>/         # durable plugin configuration
    settings.json             # non-secret settings
    secrets.json              # secret values, mode 0600
  data/<plugin-id>/           # durable domain/runtime data owned by the plugin
  cache/<plugin-id>/          # disposable generated files and caches
```

`<dataDir>` means the existing owner-global `config.dataDir`. It may be described as the owner workspace, but it is not the per-Bot `workspaceDir`. A plugin installed once is available to every eligible Agent and channel, so its installation and configuration cannot be derived from a conversational workspace.

External Subagent is the first settings migration. Its package now contains its settings UI, schema, and settings runtime actions, while the existing agent feature adapter remains host-integrated. The generic settings catalog and detail pages contain no External Subagent-specific forms, API routes, conditionals, or configuration schema.

## User Stories

1. As a Molibot user, I want the Plugins page to show a compact list, so that I can scan installed plugins without reading configuration forms.
2. As a Molibot user, I want clicking a plugin row or Settings action to open a dedicated page, so that configuration does not expand inside the catalog.
3. As a Molibot user, I want the dedicated page to preserve Molibot navigation and plugin identity, so that I always know which plugin I am configuring.
4. As a Molibot user, I want to see whether a plugin is built in, local, npm-installed, or Git-installed, so that its origin is clear.
5. As a Molibot user, I want to enable or disable a plugin without opening detailed settings, so that common management remains fast.
6. As a Molibot user, I want disabling a plugin enforced at invocation time, so that the switch is not cosmetic.
7. As a Molibot user, I want installing a plugin with a settings page to make that page available automatically, so that no Molibot source change is required.
8. As a Molibot user, I want a plugin without custom settings to show an informative details page, so that navigation remains predictable.
9. As a Molibot user, I want a simple plugin to declare a settings schema that Molibot renders natively, so that it need not ship a frontend for a few fields.
10. As a Molibot user, I want a complex plugin to ship its own UI and actions, so that setup wizards, environment checks, tests, and provider installation are plugin-owned.
11. As a Molibot user, I want plugin configuration to survive Molibot and plugin upgrades, so that code replacement never resets my choices.
12. As a Molibot user, I want plugin domain data retained by normal uninstall, so that reinstall can restore previous state.
13. As a Molibot user, I want deleting retained configuration or data to require a separate confirmation, so that uninstall is not accidentally destructive.
14. As a Molibot user, I want plugin cache removal to be safe, so that disposable data does not accumulate.
15. As a Molibot user, I want plugin secrets stored separately from ordinary settings, so that credentials are absent from catalogs, logs, and browser bootstrap payloads.
16. As a Molibot user, I want secret fields to support replace or explicit clear, so that an empty submission never silently erases a credential.
17. As a Molibot user, I want the same plugin settings page in Desktop and local Web Settings, so that configuration is not tied to one shell.
18. As a Molibot user, I want UI failures contained inside the plugin frame, so that one broken page does not break Settings.
19. As a Molibot user, I want plugin runtime failures outside the Molibot service process, so that a hung third-party action cannot take down every channel.
20. As a Molibot user, I want a failed plugin visible with a useful error, so that it remains diagnosable and uninstallable.
21. As a plugin author, I want one documented manifest contract, so that I do not need private knowledge of Molibot Core.
22. As a pi author, I want a plain pi extension to keep working without Molibot metadata, so that basic ecosystem compatibility remains intact.
23. As a pi author, I want optional Molibot metadata and settings assets, so that the same package gains a Web settings page when hosted by Molibot.
24. As a plugin author, I want a stable scoped configuration directory, so that I never write into global `RuntimeSettings`.
25. As a plugin author, I want a stable scoped data directory, so that operational data cannot collide with another plugin.
26. As a plugin author, I want a disposable cache directory, so that generated artifacts stay outside durable storage.
27. As a plugin author, I want only scoped directory services, so that I do not depend on Molibot's complete settings object.
28. As a plugin author, I want locale, theme, plugin version, and host capabilities from a stable bridge, so that my page integrates without reading host internals.
29. As a plugin author, I want serialized atomic config writes, so that concurrent UI and runtime changes do not corrupt files.
30. As a plugin author, I want invalid config rejected before persistence, so that the previous valid configuration survives.
31. As a plugin author, I want an explicit config schema version, so that incompatible data is detected instead of guessed.
32. As a plugin author, I want unsupported config to stop with a reset/reconfigure state, so that the host never applies an implicit fallback.
33. As a plugin author, I want upgrades to replace only `packages/<plugin-id>`, so that config and data are outside the replacement target.
34. As a maintainer, I want External Subagent's form, detection, installation, and tests removed from Core, so that the extension seam is proven.
35. As a maintainer, I want no plugin-id special cases in the generic page, so that catalog data—not host UI code—drives additions and removals.
36. As a maintainer, I want plugin enablement to survive a fresh Settings store, so that restart cannot reset it.
37. As a maintainer, I want plugin config to survive a fresh Plugin Host, so that restart cannot lose fields.
38. As a maintainer, I want every plugin path derived from the storage registry, so that alternate `DATA_DIR` instances stay isolated.
39. As a maintainer, I want catalog APIs to return opaque identity and status only, so that paths and configuration never leak to the WebView.
40. As a maintainer, I want one acceptance path covering install, configure, restart, upgrade, and uninstall, so that the feature is tested as a product.
41. As a Molibot user, I want a plugin page to use the Agent App's active semantic theme and its real content height, so that it does not look embedded or create a second scrollbar.
42. As a Molibot user, I want a runtime-dependent Provider to stay disabled until detection passes, so that an unavailable executable cannot be presented as enabled.
43. As a Molibot user, I want installation success to mean the runtime was actually installed and detected, so that a failed package-manager result is never reported as success.

## Implementation Decisions

### 1. Product classification

- The catalog contains installable product plugins and pi extensions.
- Memory backends, providers, channels, or schedules are not automatically plugins merely because they are optional; they stay in dedicated Settings unless packaged through this contract.
- Built-in and third-party plugin packages use the same settings contract. `source` changes installation and update behavior, not hosting behavior.
- Plain pi extensions remain supported but do not automatically receive a Web settings page.
- A pi extension becomes Molibot-enhanced by declaring the optional Molibot manifest contribution.

### 2. Host settings boundary

Core runtime settings keep only host lifecycle state:

```text
plugins.entries.<plugin-id>.enabled: boolean
```

- No plugin-specific setting is allowed under global `RuntimeSettings.plugins`.
- No dynamic plugin blobs pass through the global settings sanitizer.
- pi `registerFlag` values are plugin config when surfaced in Molibot; they are not global settings.
- Per-Agent or per-Project activation is not V1. A later implementation must be host policy, not plugin configuration.
- Existing plugin-specific settings blocks are removed as each plugin migrates. Do not retain compatibility fields, fallback reads, or migration layers; the owner reconfigures that plugin once.

### 3. Owner-global directory contract

The fixed root is `<dataDir>/plugins`, derived through the central storage path registry:

```text
plugins/
  packages/<plugin-id>/
  config/<plugin-id>/
  data/<plugin-id>/
  cache/<plugin-id>/
```

- `packages/` is replaceable code; install and upgrade stage and validate before atomically replacing only this directory.
- `config/` is durable user configuration and is never part of code replacement or normal uninstall.
- `data/` is durable operational/domain data with independent retention and deletion semantics.
- `cache/` is disposable; the host may clear it while the plugin is stopped.
- Plugin ids are safe path segments. Symlinks and traversal outside assigned roots are rejected at host-managed boundaries.
- The host passes resolved scoped paths. Channel, UI, and plugin code do not reconstruct global paths.
- Never derive plugin storage from Bot `workspaceDir`, Channel state, Session scratch, or Project root.

### 4. Configuration files

- Non-secrets: `config/<plugin-id>/settings.json`.
- Secrets: `config/<plugin-id>/secrets.json`, owner-only (`0600` on POSIX).
- Each settings document includes `schemaVersion` and the validated plugin id.
- Writes use serialized read-modify-write and atomic replace. Invalid writes leave the previous file intact.
- Secret reads never return values to the browser. UI receives only presence metadata and sends `replace` or explicit `clear`.
- Logs, catalogs, diagnostics, and errors redact secrets and omit absolute config paths.
- The plugin owns field semantics and validation; the host owns atomic persistence, secret semantics, size limits, and directory isolation.
- V1 has no config migration system. Unsupported schema versions produce `configuration_incompatible` with an explicit backup-and-reset/reconfigure action.

### 5. Plugin manifest contract

An installed package declares its Molibot contribution in `package.json#molibot.plugin`, alongside the existing pi package metadata. Do not add a second `molibot.plugin.json` format.

The Molibot contribution contains:

- identity, display metadata, version, icon, and host engine range;
- runtime entry;
- optional settings contribution:
  - `mode: "schema"` with plugin-owned JSON Schema and localized presentation metadata; or
  - `mode: "custom"` with settings UI entry and settings-action runtime entry;
- configuration `schemaVersion`;
- optional capability declarations required by settings actions.

Only one settings mode is active. Custom mode is for flows ordinary fields cannot express well, such as environment detection, executable installation, connectivity tests, OAuth, or multi-step setup.

### 6. Plugins catalog UI

- `/settings/plugins` becomes a compact list, not an accordion.
- Each row shows icon, name, one-line description, source, health, version, and enabled switch.
- Row activation or Settings navigates to `/settings/plugins/<plugin-id>`.
- Search covers name, id, and description. Add source/type filters only when installed count makes them useful.
- Do not duplicate enabled state through redundant badges, labels, and switches.
- Unknown, disabled, failed, and incompatible plugins remain visible.

### 7. Dedicated settings route

- Molibot owns Back, identity, version/source, health, enablement, uninstall, retained-data management, loading, error, and missing-settings states.
- Schema mode uses existing shadcn-svelte Settings components, semantic CSS, fixed `.settings-footbar`, zh/en switching, light/dark themes, and mobile widths.
- Custom mode mounts the plugin settings document in an isolated iframe.
- A plugin without settings shows capabilities and lifecycle actions, not a fake empty form.
- Unsaved-change behavior is visible and owned by the active settings mode.

### 8. Custom UI isolation and bridge

- Never import third-party UI as a Svelte component or execute it in the main Settings document.
- Use an iframe sandbox without `allow-same-origin`, granting only minimum approved behavior.
- Desktop uses the `molibot-plugin://<plugin-id>/<asset>` custom protocol. Its native transport accepts only safe plugin ids and relative asset paths, pins the upstream to the managed loopback service, and forwards only `/plugins/<plugin-id>/ui/*`; Web uses the same host contract without unrestricted loopback APIs.
- Communication uses a versioned `postMessage` bridge. Validate iframe source, plugin id, message type, payload size, and correlation id.
- Minimum bridge surface:
  - bootstrap locale, resolved appearance, semantic theme tokens, plugin version, contract version, and enabled state;
  - validated plugin content height updates so the host owns page scrolling;
  - settings read/write and secret replace/clear;
  - invoke a declared settings action;
  - progress, validation errors, results, and saved confirmation;
  - host confirmation for destructive actions.
- Do not expose general filesystem access, arbitrary host fetch, Tauri IPC, global settings, other plugins, sessions, channels, or credentials.
- External scripts and remote navigation are blocked by host CSP unless a future permission system allows them.

### 9. Settings runtime actions

- Complex actions execute in the plugin fault domain, not Core or browser.
- Dispatch only action names declared by the plugin.
- Each call has deadline, abort, bounded payloads, structured progress, and process-tree cleanup.
- Action context contains only scoped config/data/cache services, approved capabilities, locale, and safe runtime metadata.
- Plugin code still has owner OS permissions unless a future sandbox is added. Process isolation contains faults; it is not a filesystem permission boundary.

### 10. Lifecycle semantics

- **Install**: stage, validate manifest/runtime/UI, create scoped roots, atomically activate code, refresh catalog.
- **Upgrade**: replace only package code; never overwrite config/data.
- **Disable**: reject runtime contributions and settings actions at invocation time; keep details reachable.
- **Uninstall**: stop runtime, remove package and cache, retain config/data by default.
- **Delete retained state**: separate irreversible action; config and data may be deleted independently.
- **Reinstall same id**: reuse supported retained state; otherwise show incompatible configuration.
- **Failure**: retain a safe error entry and lifecycle actions.

### 11. External Subagent reference migration

- Move settings UI into the External Subagent package.
- Move environment detection, runtime installation, and test-run handlers into plugin settings actions.
- Keep each Provider disabled until its matching environment check passes; changing its executable path invalidates the previous check.
- Create the plugin-owned runtime directory before package-manager execution and surface unsuccessful action results as errors.
- Persist provider enablement, permission modes, and optional paths in its config directory.
- Keep only the host enabled switch in RuntimeSettings.
- Remove its dedicated Core endpoints, settings fields, frontend state/copy, conditionals, validators, and sanitizers.
- Install or bundle it through the same manifest/catalog contract as other plugins.
- Removing the package from the catalog must not require editing the generic page.

### 12. Documentation and developer experience

- Publish one authoring contract covering layout, manifest, both settings modes, bridge, actions, secrets, lifecycle, version failures, and tests.
- Provide a minimal schema-mode reference and External Subagent as the custom-mode reference.
- Provide candidate validation without installing.
- Errors identify the plugin and invalid contract field but never expose secrets or host paths.

## Testing Decisions

Good tests assert external behavior through the highest practical seam rather than private helper structure.

Primary acceptance seam:

```text
install package
→ catalog discovers it
→ open dedicated page
→ plugin reads and saves config
→ restart with fresh Runtime and Plugin Host
→ page and runtime action read the same config
→ upgrade code
→ config/data remain unchanged
→ uninstall retains config/data
```

Required groups:

1. **Storage and scope**: temporary `DATA_DIR`; all paths remain inside it; package replacement cannot touch config/data; cache cleanup cannot touch durable roots; traversal, invalid ids, symlinks, and encoded escapes fail before writes.
2. **Host settings round-trip**: save toggle, create fresh Settings store, reload; only enabled state exists; structurally reject plugin-specific global keys.
3. **Plugin config round-trip**: save both modes, create fresh Plugin Host, reload; invalid writes preserve previous values; verify secret replace/clear and absence from responses/logs.
4. **Catalog and routing**: built-in, plain pi, enhanced pi, disabled, failed, and incompatible entries; dynamic route resolution; no plugin id hard-coded.
5. **Iframe bridge**: bootstrap, read/write, action, progress, abort, timeout, invalid source, wrong id, oversize payload, unknown action; structural sandbox/CSP/no-Tauri/no-loopback guards.
6. **Fault isolation**: action exit, hang, rejection, and spawned child are contained and cleaned; failed plugin remains manageable.
7. **Lifecycle**: install, upgrade, disable, restart, uninstall-retain, reinstall, config-only delete, data-only delete, and cache cleanup.
8. **External Subagent**: package-owned UI/actions work; save → fresh host → load works; structural guard rejects its identifiers or fields in generic Settings.
9. **Cold path**: restart → first open → configure → save → switch page → return; interrupt/restore service; Desktop/Web, zh/en, light/dark, keyboard focus, narrow width, and fixed save controls.

## Acceptance Criteria

1. Settings/Edit navigates to a dedicated route; no plugin form expands in the catalog.
2. A newly installed enhanced pi plugin contributes a settings page without any Molibot source change.
3. Plain pi plugins remain manageable without settings UI.
4. RuntimeSettings contains only plugin enabled state.
5. Code, config, durable data, and cache occupy separate owner-global directories under configured `DATA_DIR`.
6. Upgrade replaces code without touching config/data; normal uninstall retains config/data and removes cache.
7. Secrets never appear in catalog/settings GET responses, logs, or browser bootstrap.
8. Custom UI stays outside the main Settings DOM through the restricted bridge.
9. Settings actions run in the plugin fault domain with timeout, cancellation, and process-tree cleanup.
10. External Subagent has no dedicated settings UI, route, schema, sanitizer, or API handler in Core.
11. Settings and plugin round-trip tests use temporary storage and pass after a fresh Runtime.
12. Desktop/Web cold paths pass in zh/en, light/dark, and narrow width.

## Delivery Slices

### Slice 1 — Storage and manifest foundation

- Add canonical plugin paths and bootstrap.
- Lock and validate manifest settings contributions.
- Narrow new-contract host settings to enabled state.
- Add temporary-root persistence and path-safety tests.

### Slice 2 — Catalog and dedicated route

- Replace accordion editing with compact rows.
- Add dynamic details route and schema-mode renderer.
- Keep lifecycle controls in the host shell.

### Slice 3 — Custom UI bridge and actions

- Serve isolated plugin UI assets.
- Implement bridge and settings-action dispatch.
- Add secrets, timeout, cancellation, payload, CSP, and fault guards.
- Verify Desktop and local Web Settings.

### Slice 4 — External Subagent migration

- Move UI, config, detection, install, and test behavior into the package.
- Delete Core special cases and old settings fields.
- Run the full acceptance seam.

### Slice 5 — Authoring contract and references

- Publish author docs and validation commands.
- Add a minimal schema-mode reference.
- Complete adversarial security, lifecycle, and cold-start review.

## Out of Scope

- Public marketplace, ratings, signing, or automatic trust.
- Filesystem permission sandbox for third-party server code.
- Arbitrary remote websites as settings pages.
- Third-party Svelte components inside the Molibot Settings bundle.
- Per-Agent, per-Project, per-Channel, or per-Session plugin config instances.
- Plugin-to-plugin UI or config access.
- Compatibility layers or automatic migration of old Core plugin settings.
- Redesigning Channel, Provider, Memory, Skill, MCP, or Mini App settings unless separately approved.
- Replacing Mini Apps; reuse proven transport/isolation patterns while keeping the concepts distinct.
- Translating pi terminal renderers, shortcuts, dialogs, or widgets into Web components.

## Further Notes

- Owner-global `DATA_DIR` is the correct scope. A Bot `workspaceDir` belongs to one Agent identity and may be switched or removed independently; using it would create duplicate or disappearing plugin state.
- Config and domain data are separate because validation, size, retention, backup, and deletion semantics differ.
- Process isolation is a reliability boundary, not a permission sandbox.
- The custom bridge is intentionally narrow: plugins own setup UX, while Molibot prevents it becoming an unrestricted host entrance.
- External Subagent is the tracer bullet. The contract is accepted only when the real Core special case disappears, not merely when a fixture renders a form.
